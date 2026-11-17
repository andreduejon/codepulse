import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubCache } from "../providers/github-actions/cache";
import { closeProviderCaches } from "../providers/shared/sha-sqlite-cache";
import { SnykCache } from "../providers/snyk/cache";
import { loadAppEvents, loadCommitInfo } from "./load";

/** Tests that make a repository run many Git processes, which start slowly on Windows (seconds on its ARM64 runner). */
const GIT_TIMEOUT = 30_000;

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots) closeProviderCaches(join(root, "cache"));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Dev",
      GIT_AUTHOR_EMAIL: "dev@example.invalid",
      GIT_COMMITTER_NAME: "Dev",
      GIT_COMMITTER_EMAIL: "dev@example.invalid",
    },
  });
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return stdout.trim();
}

async function commit(repo: string, message: string, iso: string): Promise<string> {
  await writeFile(join(repo, `${message.length}-${Date.parse(iso)}.txt`), message);
  await git(repo, "add", "-A");
  const child = Bun.spawn(["git", "commit", "-q", "-m", message], {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Dev",
      GIT_AUTHOR_EMAIL: "dev@example.invalid",
      GIT_COMMITTER_NAME: "Dev",
      GIT_COMMITTER_EMAIL: "dev@example.invalid",
      GIT_AUTHOR_DATE: iso,
      GIT_COMMITTER_DATE: iso,
    },
  });
  if ((await child.exited) !== 0) throw new Error("commit failed");
  return git(repo, "rev-parse", "HEAD");
}

test(
  "an app's events: its main branch's commits since the window starts, and what its provider caches hold",
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "codepulse-dashboard-")));
    roots.push(root);
    const repo = join(root, "shop");
    await Bun.spawn(["git", "init", "-q", "-b", "main", repo]).exited;
    await commit(repo, "old work", "2026-02-01T10:00:00Z");
    const recent = await commit(repo, "feat(api): health", "2026-03-02T09:20:00Z");
    const cacheRoot = join(root, "cache");
    await new GitHubCache({ root: cacheRoot }).write(repo, {
      sha: recent,
      runs: [
        {
          id: 7,
          name: "CI",
          status: "completed",
          conclusion: "failure",
          headSha: recent,
          event: "push",
          runNumber: 812,
          updatedAt: "2026-03-02T10:52:00Z",
        },
      ],
    });
    await new SnykCache({ root: cacheRoot }).write(repo, {
      sha: recent,
      scannedAt: "2026-03-02T10:30:00Z",
      includesDev: true,
      dependencyProjects: [],
      counts: { critical: 0, high: 0, medium: 0, low: 0 },
      findings: [],
    });

    const events = await loadAppEvents(repo, { since: Date.parse("2026-03-01T00:00:00Z"), cacheRoot });
    expect(events.map(event => [event.source, event.text]).sort()).toEqual([
      ["git", "feat(api): health"],
      ["github-actions", "CI #812 failed"],
      ["snyk", "scan · 0 vulnerabilities · 0 critical · 0 high · 0 medium · 0 low"],
    ]);
    // Older than the window: left out.
    expect(await loadAppEvents(repo, { since: Date.parse("2026-03-03T00:00:00Z"), cacheRoot })).toEqual([]);
  },
  GIT_TIMEOUT,
);

test("a folder that is not a repository has no events instead of failing the dashboard", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codepulse-dashboard-")));
  roots.push(root);
  expect(await loadAppEvents(join(root, "missing"), { since: 0, cacheRoot: join(root, "cache") })).toEqual([]);
});

test(
  "a commit's author, date and message for the side panel; a commit the repository lacks has none",
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "codepulse-dashboard-")));
    roots.push(root);
    const repo = join(root, "shop");
    await Bun.spawn(["git", "init", "-q", "-b", "main", repo]).exited;
    const sha = await commit(repo, "feat(api): health", "2026-03-02T09:20:00Z");
    expect(await loadCommitInfo(repo, sha)).toEqual({
      author: "Dev",
      email: "dev@example.invalid",
      date: "2026-03-02T09:20:00Z",
      subject: "feat(api): health",
      body: "",
    });
    expect(await loadCommitInfo(repo, "0".repeat(40))).toBeNull();
    expect(await loadCommitInfo(repo, "--help")).toBeNull();
  },
  GIT_TIMEOUT,
);

test(
  "each event names its branch: GitHub's own, else the remote branch that holds its commit, else a local one",
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "codepulse-dashboard-")));
    roots.push(root);
    const origin = join(root, "origin.git");
    const seed = join(root, "seed");
    const repo = join(root, "shop");
    await git(root, "init", "-q", "--bare", "-b", "main", origin);
    await git(root, "init", "-q", "-b", "main", seed);
    const base = await commit(seed, "feat(api): health", "2026-03-02T09:00:00Z");
    await git(seed, "remote", "add", "origin", origin);
    await git(seed, "push", "-q", "origin", "main");
    // A branch at main's tip: the commit is still main's.
    await git(seed, "push", "-q", "origin", "main:hotfix");
    // Git flow: develop is merged into main, then moves on. Its commit is reachable from main only through the merge.
    await git(seed, "checkout", "-q", "-b", "develop");
    const developed = await commit(seed, "feat(cart): totals", "2026-03-02T09:10:00Z");
    await git(seed, "checkout", "-q", "main");
    await git(seed, "merge", "-q", "--no-ff", "-m", "Merge develop", "develop");
    await git(seed, "checkout", "-q", "develop");
    await commit(seed, "feat(cart): rounding", "2026-03-02T09:20:00Z");
    await git(seed, "push", "-q", "origin", "main", "develop");
    await git(seed, "checkout", "-q", "-b", "feature/login");
    const feature = await commit(seed, "feat(login): form", "2026-03-02T09:30:00Z");
    await git(seed, "push", "-q", "origin", "feature/login");
    await git(root, "clone", "-q", origin, repo);
    await git(repo, "checkout", "-q", "-b", "wip");
    const local = await commit(repo, "wip: not pushed", "2026-03-02T09:40:00Z");

    const cacheRoot = join(root, "cache");
    const run = (id: number, sha: string, headBranch?: string) => ({
      id,
      name: "CI",
      status: "completed",
      conclusion: "success",
      headSha: sha,
      event: "push",
      runNumber: id,
      updatedAt: "2026-03-02T10:00:00Z",
      ...(headBranch ? { headBranch } : {}),
    });
    await new GitHubCache({ root: cacheRoot }).write(repo, { sha: feature, runs: [run(1, feature)] });
    await new GitHubCache({ root: cacheRoot }).write(repo, { sha: base, runs: [run(2, base, "release/1.x")] });
    const scan = (sha: string) => ({
      sha,
      scannedAt: "2026-03-02T10:30:00Z",
      includesDev: true as const,
      dependencyProjects: [],
      counts: { critical: 0, high: 0, medium: 0, low: 0 },
      findings: [],
    });
    await new SnykCache({ root: cacheRoot }).write(repo, scan(local));
    await new SnykCache({ root: cacheRoot }).write(repo, scan(base));
    await new SnykCache({ root: cacheRoot }).write(repo, scan(developed));
    await new SnykCache({ root: cacheRoot }).write(repo, scan("0".repeat(40)));

    const events = await loadAppEvents(repo, { since: Date.parse("2026-03-01T00:00:00Z"), cacheRoot });
    const branchOf = (source: string, sha: string) =>
      events.find(event => event.source === source && event.sha === sha)?.branch;
    expect(branchOf("git", base)).toBe("main");
    expect(branchOf("github-actions", feature)).toBe("feature/login");
    // GitHub knows which branch it ran for.
    expect(branchOf("github-actions", base)).toBe("release/1.x");
    expect(branchOf("snyk", local)).toBe("wip");
    // On the main branch's own line, every event of that commit says main, like its commit row.
    expect(branchOf("snyk", base)).toBe("main");
    // Made on develop and merged into main: develop's, not main's.
    expect(branchOf("snyk", developed)).toBe("develop");
    expect(branchOf("snyk", "0".repeat(40))).toBeUndefined();
  },
  GIT_TIMEOUT,
);
