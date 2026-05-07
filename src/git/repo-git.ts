import { addDebugEvent, redactDebugValue } from "../debug/events";

/** Shared helper to run a git command and capture its output. */
export async function runGit(
  repoPath: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const started = Date.now();
  const command = redactDebugValue(`git ${args.join(" ")}`);
  // Bail out before spawning if already cancelled
  if (signal?.aborted) {
    addDebugEvent({ source: "Git", message: command, status: "aborted", durationMs: 0 });
    return { stdout: "", stderr: "aborted", exitCode: 1 };
  }

  const proc = Bun.spawn(["git", ...args], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  // If the caller aborts, kill the subprocess immediately
  if (signal) {
    const onAbort = () => {
      try {
        proc.kill();
      } catch {}
    };
    signal.addEventListener("abort", onAbort, { once: true });
    proc.exited.then(() => signal.removeEventListener("abort", onAbort)).catch(() => {});
  }

  try {
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    const exitCode = proc.exitCode ?? 1;
    addDebugEvent({ source: "Git", message: command, status: exitCode === 0 ? "ok" : `exit ${exitCode}`, durationMs: Date.now() - started });
    return { stdout, stderr, exitCode };
  } catch {
    // Process was killed — pipes may throw
    addDebugEvent({ source: "Git", message: command, status: "aborted", durationMs: Date.now() - started });
    return { stdout: "", stderr: "aborted", exitCode: 1 };
  }
}
