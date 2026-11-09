/**
 * `bun run demo`: codepulse on a throwaway repository with made-up GitHub Actions, Jenkins, OpenShift and Snyk data,
 * so every row, label and message can be looked at without a real server.
 *
 * Everything lives in a fresh folder under the system temp directory (repository, config, cache), so the real
 * config and cache stay untouched. Nothing goes over the network: see fake-fetch.ts and fake-snyk.ts.
 *
 * Each run gets its own folder and removes it on quit. Commit hashes change with every run (the dates are relative
 * to now), so a second run must never rebuild the repository a first one is still showing.
 */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMMIT_KEY,
  DEMO_STATE_ENV,
  type DemoState,
  JENKINS_ROOT,
  NAMESPACES,
  OPENSHIFT_CONSOLE,
  OPENSHIFT_SERVER,
} from "./scenario";

const root = mkdtempSync(join(realpathSync(tmpdir()), "codepulse-demo-"));
const repo = join(root, "shop");
const home = join(root, "home");
const statePath = join(root, "state.json");
const here = import.meta.dir;

mkdirSync(repo, { recursive: true });
mkdirSync(join(home, ".config", "codepulse"), { recursive: true });

const now = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Git runs without the user's global config (no signing, hooks or credential helpers).
const gitEnv = {
  ...process.env,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Demo Dev",
  GIT_AUTHOR_EMAIL: "dev@demo.invalid",
  GIT_COMMITTER_NAME: "Demo Dev",
  GIT_COMMITTER_EMAIL: "dev@demo.invalid",
};

function git(args: string[], env: Record<string, string> = {}): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: repo, env: { ...gitEnv, ...env } });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

let fileCounter = 0;
function commit(subject: string, agoMs: number, author = "Demo Dev"): string {
  const date = new Date(now - agoMs).toISOString();
  writeFileSync(join(repo, `change-${++fileCounter}.txt`), `${subject}\n`);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", subject], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
    GIT_AUTHOR_NAME: author,
  });
  return git(["rev-parse", "HEAD"]);
}

git(["init", "-q", "-b", "main"]);
git(["remote", "add", "origin", "https://github.com/demo/shop.git"]);

const shas: Record<string, string> = {};
shas.initial = commit("chore: initial commit", 12 * DAY);
shas.cart = commit("feat(cart): add the cart service", 11 * DAY, "Ana Lima");

// Eleven short branches from `cart`: twelve lanes side by side in the graph.
const lanes: string[] = [];
for (let i = 1; i <= 11; i++) {
  const branch = `lane/${String(i).padStart(2, "0")}`;
  git(["checkout", "-q", "-b", branch, shas.cart]);
  shas[`lane${i}`] = commit(`chore(lane ${i}): a parallel branch so the graph needs many lanes`, 10 * DAY - i * HOUR);
  lanes.push(branch);
}
git(["checkout", "-q", "main"]);
shas.rounding = commit("fix(cart): round discounts to cents", 9 * DAY, "Jonas Weber");
shas.payments = commit(
  "feat(payments): retry failed payments with exponential backoff, and a subject long enough to need cutting",
  7 * HOUR,
);
git(["checkout", "-q", "-b", "feature/payments-retry-with-a-really-long-branch-name"]);
shas.retry = commit("wip(payments): retry policy types", 6 * HOUR, "Mei Chen");
git(["checkout", "-q", "main"]);
shas.readme = commit("docs: 更新 README の説明 🚀 and explain the cart flow", HOUR, "山田 太郎");
git(["checkout", "-q", "-b", "dev"]);
shas.health = commit("feat(api): add a health endpoint", 50 * MIN);
shas.metrics = commit("feat(api): export request metrics", 5 * MIN);
git(["checkout", "-q", "main"]);
git(["tag", "v0.42.0", shas.readme]);

writeFileSync(join(repo, "change-1.txt"), "work in progress\n");
git([
  "stash",
  "push",
  "-q",
  "-m",
  "WIP on payments: try a shorter retry delay before giving up on the payment gateway",
]);

const state: DemoState = {
  repoPath: repo,
  shas,
  branches: ["main", "dev", "feature/payments-retry-with-a-really-long-branch-name", ...lanes],
  unseenSha: "c0ffee5e7a1b2c3d4e5f60718293a4b5c6d7e8f9",
};
writeFileSync(statePath, JSON.stringify(state, null, 2));

const providers = {
  github: { enabled: true, tokenEnvVar: "GITHUB_TOKEN" },
  jenkins: { enabled: true, username: "demo", tokenEnvVar: "JENKINS_TOKEN", jobs: [{ url: JENKINS_ROOT }] },
  openshift: {
    enabled: true,
    serverUrl: OPENSHIFT_SERVER,
    consoleUrl: OPENSHIFT_CONSOLE,
    tokenEnvVar: "OPENSHIFT_TOKEN",
    namespaces: [...NAMESPACES],
    commitShaAnnotation: COMMIT_KEY,
  },
  snyk: { enabled: true, tokenEnvVar: "SNYK_TOKEN" },
};
writeFileSync(
  join(home, ".config", "codepulse", "config.json"),
  JSON.stringify({ repos: { [repo]: { appName: "shop", group: "demo", autoFetchSeconds: 0, providers } } }, null, 2),
);

const bin = join(here, "bin");
chmodSync(join(bin, "snyk"), 0o755);

console.log(`codepulse demo: ${root}
  feat(payments) …   GitHub re-run with annotations · Jenkins failed tests · fails in shop-test
  docs: 更新 README … GitHub green · Jenkins parallel stages · live in shop-prod
  export metrics     GitHub running · Jenkins running · rolling out in shop-dev (image pull fails)
  retry policy types GitHub lint failure with a long annotation
  round discounts    Snyk: scan it, then Enter on "parent … not scanned"
Events are forbidden in shop-prod. o opens .invalid addresses: check the address bar.
Requests: ${join(root, "requests.log")}
`);

const app = Bun.spawn(
  [process.execPath, "--preload", join(here, "fake-fetch.ts"), join(here, "..", "..", "src", "index.tsx"), repo],
  {
    stdio: ["inherit", "inherit", "inherit"],
    env: {
      ...gitEnv,
      [DEMO_STATE_ENV]: statePath,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      GITHUB_TOKEN: "demo",
      JENKINS_TOKEN: "demo",
      OPENSHIFT_TOKEN: "demo",
      SNYK_TOKEN: "demo",
    },
  },
);
const exitCode = await app.exited;
rmSync(root, { recursive: true, force: true });
process.exit(exitCode);
