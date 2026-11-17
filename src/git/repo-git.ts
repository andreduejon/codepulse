import { existsSync } from "node:fs";
import { addDebugEvent, redactDebugValue } from "../debug/events";
import { monotonicNow } from "../utils/monotonic";

function spawnGit(repoPath: string, args: string[]) {
  return Bun.spawn(["git", "-c", "core.quotePath=false", ...args], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });
}

/** Read a stream as text, stopping (and calling `onLimit`) once it exceeds `maxBytes`. */
async function readCapped(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number | undefined,
  onLimit: () => void,
): Promise<{ text: string; truncated: boolean }> {
  if (maxBytes === undefined) return { text: await new Response(stream).text(), truncated: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    size += chunk.byteLength;
    if (size > maxBytes) {
      onLimit();
      return { text: new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes)), truncated: true };
    }
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), truncated: false };
}

/**
 * Shared helper to run a git command and capture its output.
 * With `maxStdoutBytes`, git is stopped once stdout exceeds the cap and `truncated` is set
 * (exitCode then reflects the kill, so callers must check `truncated` first).
 */
export async function runGit(
  repoPath: string,
  args: string[],
  signal?: AbortSignal,
  maxStdoutBytes?: number,
): Promise<{ stdout: string; stderr: string; exitCode: number; truncated?: boolean }> {
  const started = monotonicNow();
  const command = redactDebugValue(`git ${args.join(" ")}`);
  // Bail out before spawning if already cancelled
  if (signal?.aborted) {
    addDebugEvent({ source: "Git", message: command, status: "aborted", durationMs: 0 });
    return { stdout: "", stderr: "aborted", exitCode: 1 };
  }

  // quotePath=false: print non-ASCII paths as UTF-8 instead of quoted octal escapes.
  let proc: ReturnType<typeof spawnGit>;
  try {
    proc = spawnGit(repoPath, args);
  } catch (error) {
    // Git never started: the folder is gone (`codepulse xyz` without xyz) or Git is not installed. Callers get a
    // failed command, like Git's own errors, so the startup can say which.
    const stderr = existsSync(repoPath)
      ? `git could not start: ${error instanceof Error ? error.message : String(error)}`
      : `cannot change to '${repoPath}': No such file or directory`;
    addDebugEvent({ source: "Git", message: command, status: "error", durationMs: monotonicNow() - started });
    return { stdout: "", stderr, exitCode: existsSync(repoPath) ? 127 : 128 };
  }

  let treeCleanup: Promise<unknown> | undefined;
  // Git can spawn credential/network helpers; stop descendants on Windows too.
  if (signal) {
    const onAbort = () => {
      try {
        if (process.platform === "win32") {
          treeCleanup = Bun.spawn(["taskkill.exe", "/PID", String(proc.pid), "/T", "/F"], {
            stdout: "ignore",
            stderr: "ignore",
          }).exited;
        } else proc.kill();
      } catch {}
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    proc.exited.then(() => signal.removeEventListener("abort", onAbort)).catch(() => {});
  }

  try {
    const [out, stderr] = await Promise.all([
      readCapped(proc.stdout, maxStdoutBytes, () => proc.kill()),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    const exitCode = proc.exitCode ?? 1;
    addDebugEvent({
      source: "Git",
      message: command,
      status: out.truncated ? "truncated" : exitCode === 0 ? "ok" : `exit ${exitCode}`,
      durationMs: monotonicNow() - started,
    });
    return { stdout: out.text, stderr, exitCode, truncated: out.truncated };
  } catch {
    // Process was killed — pipes may throw
    addDebugEvent({ source: "Git", message: command, status: "aborted", durationMs: monotonicNow() - started });
    return { stdout: "", stderr: "aborted", exitCode: 1 };
  } finally {
    await treeCleanup;
  }
}
