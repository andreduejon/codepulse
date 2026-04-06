/** Shared helper to run a git command and capture its output. */
export async function runGit(
  repoPath: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Bail out before spawning if already cancelled
  if (signal?.aborted) {
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
    return { stdout, stderr, exitCode: proc.exitCode ?? 1 };
  } catch {
    // Process was killed — pipes may throw
    return { stdout: "", stderr: "aborted", exitCode: 1 };
  }
}
