/**
 * Builds the demo's folder: two repositories with a local stand-in for GitHub, the config, the fake command line
 * tools, and the environment the app runs in. Everything the app reads or writes stays inside the folder, on every
 * OS: home, config, cache and temp files all point into it.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { storageRoot } from "../../src/utils/storage-path";
import { type DemoOptions, PROVIDERS, providerError } from "./options";
import { ADMIN_MANIFEST, lockfile, type Manifest, SHOP_MANIFESTS } from "./packages";
import {
  COMMIT_KEY,
  DEMO_STATE_ENV,
  type DemoState,
  GITHUB_REPOS,
  JENKINS_ROOT,
  NAMESPACES,
  OPENSHIFT_CONSOLE,
  OPENSHIFT_SERVER,
  REMOTES_ENV,
} from "./scenario";

const here = import.meta.dir;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const TOKEN_ENV = {
  github: "GITHUB_TOKEN",
  jenkins: "JENKINS_TOKEN",
  openshift: "OPENSHIFT_TOKEN",
  snyk: "SNYK_TOKEN",
} as const;

export interface DemoWorld {
  root: string;
  /** The repository the demo opens. */
  repoPath: string;
  statePath: string;
  /** The app's environment. */
  env: Record<string, string>;
}

/** Sets a variable, dropping other spellings first: Windows names are case-insensitive (`Path` is `PATH`). */
function setEnv(env: Record<string, string>, key: string, value: string | undefined) {
  if (process.platform === "win32") {
    for (const name of Object.keys(env)) if (name.toUpperCase() === key.toUpperCase()) delete env[name];
  } else {
    delete env[key];
  }
  if (value !== undefined) env[key] = value;
}

/** Git with the demo's environment, in `cwd`. */
function gitRunner(env: Record<string, string>) {
  return (cwd: string, args: string[], extra: Record<string, string> = {}): string => {
    const result = Bun.spawnSync(["git", ...args], { cwd, env: { ...env, ...extra } });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
    return result.stdout.toString().trim();
  };
}

const COMPILE_FLAGS = ["--no-compile-autoload-bunfig", "--no-compile-autoload-dotenv"];

/** The fake CLIs as one Windows executable: Windows runs neither shell scripts nor unknown `.cmd` shims for Snyk. */
function compiledFakeCli(): string {
  const hash = createHash("sha256");
  for (const name of readdirSync(here).sort()) if (name.endsWith(".ts")) hash.update(readFileSync(join(here, name)));
  hash.update(Bun.version);
  hash.update(COMPILE_FLAGS.join(" "));
  const directory = join(here, "..", "..", "node_modules", ".cache", "codepulse-demo", hash.digest("hex").slice(0, 16));
  const executable = join(directory, process.platform === "win32" ? "fake-cli.exe" : "fake-cli");
  if (!existsSync(executable)) {
    mkdirSync(directory, { recursive: true });
    // It runs inside other folders (a scan's worktree, this repository): their bunfig.toml and .env are not its own.
    const build = Bun.spawnSync([
      process.execPath,
      "build",
      "--compile",
      ...COMPILE_FLAGS,
      join(here, "fake-cli.ts"),
      "--outfile",
      executable,
    ]);
    if (build.exitCode !== 0) throw new Error(`Building the demo's fake CLIs failed: ${build.stderr.toString()}`);
  }
  return executable;
}

/** Puts the fake `snyk`, `npm` and `pnpm` in `bin`: shell scripts on macOS and Linux, a compiled one on Windows. */
export function installFakeCli(bin: string, names: readonly string[], compiled = process.platform === "win32") {
  if (compiled) {
    const executable = compiledFakeCli();
    const extension = process.platform === "win32" ? ".exe" : "";
    for (const name of names) {
      const target = join(bin, `${name}${extension}`);
      try {
        linkSync(executable, target);
      } catch {
        copyFileSync(executable, target);
      }
      chmodSync(target, 0o755);
    }
    return;
  }
  for (const name of names) {
    const target = join(bin, name);
    writeFileSync(target, `#!/bin/sh\nexec "${process.execPath}" "${join(here, "fake-cli.ts")}" ${name} "$@"\n`);
    chmodSync(target, 0o755);
  }
}

/**
 * The PATH the app gets: the fake CLIs first, then Git and the system's own tools. Nothing else, so a real `snyk`,
 * `npm` or `pnpm` installed next to Git can never answer instead of a fake (or reach the network).
 */
function demoPath(bin: string): string {
  const git = Bun.which("git");
  if (!git) throw new Error("The demo needs Git on PATH.");
  if (process.platform === "win32") {
    const system = process.env.SystemRoot ?? "C:\\Windows";
    return [bin, dirname(git), join(system, "System32"), system, join(system, "System32", "Wbem")].join(delimiter);
  }
  symlinkSync(realpathSync(git), join(bin, "git"));
  return [bin, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(delimiter);
}

function writeManifest(directory: string, manifest: Manifest) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(directory, "package-lock.json"), lockfile(manifest));
}

/**
 * Builds the folder. `now` dates the commits: the real time for the interactive demo, a fixed one for `--play`, so
 * commit hashes and dates come out the same every run.
 */
export function buildWorld(options: DemoOptions, now: number): DemoWorld {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "codepulse-demo-"));
  try {
    return fillWorld(root, options, now);
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function fillWorld(root: string, options: DemoOptions, now: number): DemoWorld {
  const home = join(root, "home");
  const code = join(home, "code");
  const shop = join(code, "shop");
  const web = join(code, "shop-web");
  const remotes = join(root, "remotes");
  const bin = join(root, "bin");
  const temp = join(root, "tmp");
  const statePath = join(root, "state.json");
  for (const directory of [shop, web, remotes, bin, temp]) mkdirSync(directory, { recursive: true });

  // The app's environment: the user's, minus anything that points Git or a provider at real data.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || /^(GIT_|SNYK_|GITHUB_|JENKINS_|OPENSHIFT_|NPM_CONFIG_|PNPM_)/i.test(key)) continue;
    env[key] = value;
  }
  const appData = join(home, "AppData");
  const settings: Record<string, string | undefined> = {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(appData, "Roaming"),
    LOCALAPPDATA: join(appData, "Local"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
    TMPDIR: temp,
    TEMP: temp,
    TMP: temp,
    PATH: demoPath(bin),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_TERMINAL_PROMPT: "0",
    // `git fetch` from git@github.com:demo/… reaches the local remotes instead (scripts/demo/fake-ssh.ts).
    GIT_SSH_VARIANT: "simple",
    GIT_SSH_COMMAND: `"${process.execPath.replaceAll("\\", "/")}" "${join(here, "fake-ssh.ts").replaceAll("\\", "/")}"`,
    [REMOTES_ENV]: remotes,
    [DEMO_STATE_ENV]: statePath,
  };
  // Headless output must not depend on the machine: one time zone and language for dates.
  if (options.play !== null) {
    settings.TZ = "UTC";
    settings.LANG = "en_US.UTF-8";
    settings.LC_ALL = undefined;
    settings.LC_TIME = undefined;
  }
  for (const provider of PROVIDERS)
    settings[TOKEN_ENV[provider]] = providerError(options, provider) === "no-token" ? undefined : "demo";
  for (const [key, value] of Object.entries(settings)) setEnv(env, key, value);
  for (const directory of [settings.APPDATA, settings.LOCALAPPDATA, settings.XDG_CONFIG_HOME]) {
    if (directory) mkdirSync(directory, { recursive: true });
  }
  writeFileSync(join(home, ".gitconfig"), "");

  const cliNames = providerError(options, "snyk") === "no-cli" ? ["npm", "pnpm"] : ["snyk", "npm", "pnpm"];
  installFakeCli(bin, cliNames);

  const git = gitRunner(env);
  const author = (name: string) => ({
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: `${name.toLowerCase().replace(/\W+/g, ".")}@demo.invalid`,
    GIT_COMMITTER_NAME: "Demo Dev",
    GIT_COMMITTER_EMAIL: "dev@demo.invalid",
  });

  // ── shop: the repository the demo opens ───────────────────────────────────
  for (const [owner, repo] of GITHUB_REPOS.map(r => [r.owner, r.repo]))
    git(remotes, ["init", "-q", "--bare", "-b", "main", `${owner}/${repo}.git`]);

  let changeCounter = 0;
  const commitIn =
    (repoPath: string) =>
    (subject: string, agoMs: number, name = "Demo Dev", write?: () => void): string => {
      if (write) write();
      else writeFileSync(join(repoPath, `change-${++changeCounter}.txt`), `${subject}\n`);
      const date = new Date(now - agoMs).toISOString();
      git(repoPath, ["add", "-A"]);
      git(repoPath, ["commit", "-q", "-m", subject], {
        ...author(name),
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      });
      return git(repoPath, ["rev-parse", "HEAD"]);
    };

  git(shop, ["init", "-q", "-b", "main"]);
  git(shop, ["remote", "add", "origin", "git@github.com:demo/shop.git"]);
  const commit = commitIn(shop);
  const shas: Record<string, string> = {};
  shas.initial = commit("chore: initial commit", 12 * DAY, "Demo Dev", () => {
    writeManifest(shop, SHOP_MANIFESTS.initial);
    writeFileSync(join(shop, "README.md"), "# shop\n");
  });
  shas.cart = commit("feat(cart): add the cart service", 11 * DAY, "Ana Lima", () => {
    writeManifest(shop, SHOP_MANIFESTS.cart);
    writeManifest(join(shop, "admin"), ADMIN_MANIFEST);
  });

  // Eleven short branches from `cart`: twelve lanes side by side in the graph. They stay local (never pushed).
  const lanes: string[] = [];
  for (let i = 1; i <= 11; i++) {
    const branch = `lane/${String(i).padStart(2, "0")}`;
    git(shop, ["checkout", "-q", "-b", branch, shas.cart]);
    shas[`lane${i}`] = commit(`chore(lane ${i}): a parallel branch so the graph needs many lanes`, 10 * DAY - i * HOUR);
    lanes.push(branch);
  }
  git(shop, ["checkout", "-q", "main"]);
  shas.rounding = commit("fix(cart): round discounts to cents", 9 * DAY, "Jonas Weber", () =>
    writeManifest(shop, SHOP_MANIFESTS.rounding),
  );
  shas.payments = commit(
    "feat(payments): retry failed payments with exponential backoff, and a subject long enough to need cutting",
    7 * HOUR,
    "Demo Dev",
    () => writeManifest(shop, SHOP_MANIFESTS.payments),
  );
  const feature = "feature/payments-retry-with-a-really-long-branch-name";
  git(shop, ["checkout", "-q", "-b", feature]);
  shas.retry = commit("wip(payments): retry policy types", 6 * HOUR, "Mei Chen");
  git(shop, ["checkout", "-q", "main"]);
  shas.readme = commit("docs: 更新 README の説明 🚀 and explain the cart flow", HOUR, "山田 太郎", () =>
    writeFileSync(join(shop, "README.md"), "# shop\n\nThe cart flow: add, discount, pay.\n"),
  );
  git(shop, ["checkout", "-q", "-b", "dev"]);
  shas.health = commit("feat(api): add a health endpoint", 50 * MIN);
  shas.metrics = commit("feat(api): export request metrics", 5 * MIN);
  // The commit `--live` and `advance` push to origin/dev later: in the remote already, under a ref fetch skips.
  shas.next = commit("fix(api): pin the metrics exporter version", 0);
  git(shop, ["push", "-q", "origin", "HEAD:refs/demo/next-dev"]);
  git(shop, ["reset", "-q", "--hard", shas.metrics]);
  git(shop, ["checkout", "-q", "main"]);
  git(shop, ["tag", "v0.42.0", shas.readme]);
  git(shop, ["push", "-q", "origin", "main", "dev", feature, "v0.42.0"]);
  git(shop, ["fetch", "-q", "origin"]);
  for (const branch of ["main", "dev", feature]) git(shop, ["branch", "-q", "-u", `origin/${branch}`, branch]);

  writeFileSync(join(shop, "README.md"), "# shop\n\nThe cart flow: add, discount, pay. Work in progress.\n");
  const stashDate = new Date(now - 2 * MIN).toISOString();
  git(
    shop,
    ["stash", "push", "-q", "-m", "WIP on payments: try a shorter retry delay before giving up on the payment gateway"],
    { ...author("Demo Dev"), GIT_AUTHOR_DATE: stashDate, GIT_COMMITTER_DATE: stashDate },
  );

  // ── shop-web: a second repository in the group, for the project switcher ──
  git(web, ["init", "-q", "-b", "main"]);
  git(web, ["remote", "add", "origin", "git@github.com:demo/shop-web.git"]);
  const commitWeb = commitIn(web);
  const webShas: Record<string, string> = {};
  webShas.initial = commitWeb("chore: initial commit", 3 * DAY, "Ana Lima");
  webShas.gallery = commitWeb("feat(web): product page with an image gallery", 2 * DAY, "Ana Lima");
  webShas.prices = commitWeb("fix(web): show prices with two decimals", 3 * HOUR, "Jonas Weber");
  git(web, ["push", "-q", "origin", "main"]);
  git(web, ["fetch", "-q", "origin"]);
  git(web, ["branch", "-q", "-u", "origin/main", "main"]);

  const state: DemoState = {
    root,
    repoPath: shop,
    webRepoPath: web,
    remotes,
    shas,
    webShas,
    branches: ["main", "dev", feature, ...lanes],
    unseenSha: "c0ffee5e7a1b2c3d4e5f60718293a4b5c6d7e8f9",
    providers: options.providers,
    latency: options.latency,
    live: options.live,
    headless: options.play !== null,
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  // ── config ─────────────────────────────────────────────────────────────────
  const enabled = (provider: (typeof PROVIDERS)[number]) => options.providers[provider] !== "off";
  const autoFetchSeconds = options.live !== null ? 30 : 0;
  const shopProviders = {
    github: { enabled: enabled("github"), tokenEnvVar: TOKEN_ENV.github },
    jenkins: {
      enabled: enabled("jenkins"),
      username: "demo",
      tokenEnvVar: TOKEN_ENV.jenkins,
      jobs: [{ url: JENKINS_ROOT }],
    },
    openshift: {
      enabled: enabled("openshift"),
      serverUrl: OPENSHIFT_SERVER,
      consoleUrl: OPENSHIFT_CONSOLE,
      tokenEnvVar: TOKEN_ENV.openshift,
      namespaces: [...NAMESPACES],
      commitShaAnnotation: COMMIT_KEY,
    },
    // Branch tips scan by themselves when the Snyk view opens; other commits wait for Scan commit.
    snyk: { enabled: enabled("snyk"), tokenEnvVar: TOKEN_ENV.snyk, autoScanBranches: ["main", "dev"] },
  };
  const common = { group: "demo", autoFetchSeconds, ...(options.theme ? { theme: options.theme } : {}) };
  const repos: Record<string, unknown> = {
    [web]: {
      appName: "shop-web",
      ...common,
      providers: { github: shopProviders.github, snyk: { ...shopProviders.snyk, autoScanBranches: ["main"] } },
    },
  };
  // --setup: the config knows shop-web only, so shop opens on the welcome screen.
  if (!options.setup) repos[shop] = { appName: "shop", ...common, providers: shopProviders };
  const configDir = storageRoot("config", process.platform, home, env);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), `${JSON.stringify({ repos }, null, 2)}\n`);

  return { root, repoPath: shop, statePath, env };
}
