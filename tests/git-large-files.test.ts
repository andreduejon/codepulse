import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFileContent, getFileDiff } from "../src/git/repo-diff";
import { runGit } from "../src/git/repo-git";

test("file views stop reading at the byte cap for committed and untracked files", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepulse-git-large-file-"));
  const git = async (...args: string[]) => {
    const result = await runGit(root, args);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  // One short line, then a single line far past the 8 MiB cap: only the short line may load.
  const huge = `short\n${"x".repeat(9 * 1024 * 1024)}\n`;
  try {
    await git("init");
    await writeFile(join(root, "big.txt"), huge);
    await git("add", "big.txt");
    await git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "big");
    await writeFile(join(root, "untracked.txt"), huge);
    const head = await git("rev-parse", "HEAD");

    expect(await getFileContent(root, head, "big.txt", "commit")).toEqual({
      filePath: "big.txt",
      lines: ["short"],
      isBinary: false,
      truncated: true,
    });
    expect(await getFileContent(root, head, "untracked.txt", "untracked")).toEqual({
      filePath: "untracked.txt",
      lines: ["short"],
      isBinary: false,
      truncated: true,
    });
    const diff = await getFileDiff(root, head, "untracked.txt", "untracked");
    expect(diff.truncated).toBe(true);
    expect(diff.hunks[0]?.lines.map(line => line.content)).toEqual(["short"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
