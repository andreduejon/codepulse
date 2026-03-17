import type { Commit, Branch, FileChange, CommitDetail, RefInfo } from "./types";

const GIT_LOG_FORMAT = "%H|%h|%P|%D|%s|%an|%ae|%aI";
const FIELD_SEPARATOR = "|";

function parseRefs(refString: string): RefInfo[] {
  if (!refString.trim()) return [];
  return refString.split(",").map((ref) => {
    ref = ref.trim();
    let isCurrent = false;
    if (ref.startsWith("HEAD -> ")) {
      ref = ref.replace("HEAD -> ", "");
      isCurrent = true;
    }
    if (ref === "HEAD") {
      return { name: "HEAD", type: "head" as const, isCurrent: true };
    }
    if (ref.startsWith("tag: ")) {
      return {
        name: ref.replace("tag: ", ""),
        type: "tag" as const,
        isCurrent: false,
      };
    }
    if (ref.includes("/")) {
      const isRemote =
        ref.startsWith("origin/") ||
        ref.startsWith("upstream/") ||
        ref.startsWith("refs/remotes/");
      if (isRemote) {
        return {
          name: ref,
          type: "remote" as const,
          isCurrent: false,
        };
      }
    }
    return { name: ref, type: "branch" as const, isCurrent };
  });
}

function parseCommitLine(line: string): Commit | null {
  const parts = line.split(FIELD_SEPARATOR);
  if (parts.length < 8) return null;

  const [hash, shortHash, parentsStr, refsStr, subject, author, authorEmail, authorDate] = parts;
  const parents = parentsStr.trim() ? parentsStr.trim().split(" ") : [];
  const refs = parseRefs(refsStr);

  return {
    hash,
    shortHash: shortHash.slice(0, 8),
    parents,
    message: subject,
    subject,
    body: "",
    author,
    authorEmail,
    authorDate,
    refs,
  };
}

export async function getCommits(
  repoPath: string,
  options: {
    maxCount?: number;
    branch?: string;
    all?: boolean;
  } = {}
): Promise<Commit[]> {
  const args = [
    "git",
    "log",
    "--topo-order",
    `--format=${GIT_LOG_FORMAT}`,
    `--max-count=${options.maxCount ?? 200}`,
  ];

  if (options.all) {
    args.push("--all");
  } else if (options.branch) {
    args.push(options.branch);
  }

  const proc = Bun.spawn(args, {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error(`git log failed: ${errorOutput}`);
  }

  const commits: Commit[] = [];
  for (const line of output.trim().split("\n")) {
    if (!line.trim()) continue;
    const commit = parseCommitLine(line);
    if (commit) commits.push(commit);
  }

  return commits;
}

export async function getBranches(repoPath: string): Promise<Branch[]> {
  const proc = Bun.spawn(
    ["git", "branch", "-a", "--format=%(HEAD)|%(refname:short)|%(objectname:short)"],
    {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  if (proc.exitCode !== 0) return [];

  return output
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const [head, name, lastCommitHash] = line.split("|");
      return {
        name: name.trim(),
        isCurrent: head.trim() === "*",
        isRemote: name.includes("remotes/") || name.includes("origin/"),
        lastCommitHash: lastCommitHash?.trim() ?? "",
      };
    });
}

export async function getCommitDetail(
  repoPath: string,
  hash: string,
  existingCommit?: Commit
): Promise<CommitDetail | null> {
  // Get full commit message
  const msgProc = Bun.spawn(
    ["git", "log", "-1", "--format=%B", hash],
    { cwd: repoPath, stdout: "pipe", stderr: "pipe" }
  );
  const fullMessage = await new Response(msgProc.stdout).text();
  await msgProc.exited;

  // Get file changes with stats
  const statProc = Bun.spawn(
    ["git", "diff-tree", "--no-commit-id", "-r", "--numstat", hash],
    { cwd: repoPath, stdout: "pipe", stderr: "pipe" }
  );
  const statOutput = await new Response(statProc.stdout).text();
  await statProc.exited;

  const files: FileChange[] = statOutput
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const [additions, deletions, ...pathParts] = line.split("\t");
      return {
        path: pathParts.join("\t"),
        additions: additions === "-" ? 0 : parseInt(additions, 10),
        deletions: deletions === "-" ? 0 : parseInt(deletions, 10),
        status: "M" as const,
      };
    });

  // Get the diff
  const diffProc = Bun.spawn(
    ["git", "diff-tree", "-p", "--no-commit-id", hash],
    { cwd: repoPath, stdout: "pipe", stderr: "pipe" }
  );
  const diff = await new Response(diffProc.stdout).text();
  await diffProc.exited;

  // Use existing commit info if provided (avoids a redundant git log subprocess)
  let commit: Commit;
  if (existingCommit) {
    commit = existingCommit;
  } else {
    const commits = await getCommits(repoPath, { maxCount: 1, branch: hash });
    if (commits.length === 0) return null;
    commit = commits[0];
  }

  const lines = fullMessage.trim().split("\n");

  return {
    ...commit,
    body: lines.slice(1).join("\n").trim(),
    files,
    diff,
  };
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const proc = Bun.spawn(
    ["git", "rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: repoPath, stdout: "pipe", stderr: "pipe" }
  );
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return output.trim();
}

export async function getRepoName(repoPath: string): Promise<string> {
  const proc = Bun.spawn(
    ["git", "rev-parse", "--show-toplevel"],
    { cwd: repoPath, stdout: "pipe", stderr: "pipe" }
  );
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  const fullPath = output.trim();
  return fullPath.split("/").pop() ?? "unknown";
}

export async function isGitRepo(path: string): Promise<boolean> {
  const proc = Bun.spawn(
    ["git", "rev-parse", "--is-inside-work-tree"],
    { cwd: path, stdout: "pipe", stderr: "pipe" }
  );
  await proc.exited;
  return proc.exitCode === 0;
}
