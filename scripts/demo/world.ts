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
import { importHistory } from "./history";
import { type DemoOptions, PROVIDERS, providerError } from "./options";
import { FEATURE_BRANCH, LANE_BRANCHES, SHOP_README, shopHistory, webHistory } from "./repositories";
import {
  BROWSER_COMMANDS,
  CLIPBOARD_COMMANDS,
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

/**
 * Variables of the user's that the app does not get: what points Git, a provider, a package manager, ssh, Kubernetes
 * or a proxy elsewhere, the folders the demo sets inside itself, and OpenTUI's debug switches (`OTUI_STDIN_LOG` and
 * others write files wherever they point).
 */
const LEFT_OUT_ENV =
  /^(GIT_|SNYK_|GITHUB_|GH_|JENKINS_|OPENSHIFT_|KUBE|NPM_CONFIG_|PNPM_|SSH_|XDG_|CODEPULSE_|OTUI_)|^((HTTPS?|ALL|NO|FTP)_PROXY|BUN_RUNTIME_TRANSPILER_CACHE_PATH)$/i;

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
  return (cwd: string, args: string[], extra: Record<string, string> = {}, stdin?: string | Uint8Array): string => {
    const result = Bun.spawnSync(["git", ...args], {
      cwd,
      env: { ...env, ...extra },
      stdin: stdin === undefined ? "ignore" : typeof stdin === "string" ? new TextEncoder().encode(stdin) : stdin,
    });
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

  // The app's environment: the user's, minus anything that points Git, a provider, a package manager, ssh,
  // Kubernetes or a proxy at real data or credentials, and minus folders and caches the demo sets inside itself.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || LEFT_OUT_ENV.test(key)) continue;
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
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
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
  installFakeCli(bin, [...cliNames, ...BROWSER_COMMANDS, ...CLIPBOARD_COMMANDS]);

  const git = gitRunner(env);
  // ── shop: the repository the demo opens (its history: repositories.ts) ──
  for (const repo of GITHUB_REPOS)
    git(remotes, ["init", "-q", "--bare", "-b", "main", `${repo.owner}/${repo.repo}.git`]);
  git(shop, ["init", "-q", "-b", "main"]);
  git(shop, ["remote", "add", "origin", "git@github.com:demo/shop.git"]);
  const shas = importHistory(shop, shopHistory(), now, git);
  // On origin: the shared branches, the remote-only dashboard branch, and the commit phase 2 lands on origin/dev.
  git(shop, [
    "push",
    "-q",
    "origin",
    "main",
    "dev",
    FEATURE_BRANCH,
    "release/1.x",
    "gh-pages",
    "feature/metrics-dashboard",
    "refs/demo/next-dev",
    "--tags",
  ]);
  git(shop, ["update-ref", "-d", "refs/demo/next-dev"]);
  git(shop, ["branch", "-q", "-D", "feature/metrics-dashboard"]);
  git(shop, ["fetch", "-q", "origin"]);
  for (const branch of ["main", "dev", FEATURE_BRANCH, "release/1.x", "gh-pages"])
    git(shop, ["branch", "-q", "-u", `origin/${branch}`, branch]);
  // release/1.x is one commit behind origin: someone else pushed the 1.4.2 release.
  git(shop, ["branch", "-q", "-f", "release/1.x", shas.rel141]);

  writeFileSync(join(shop, "README.md"), `${SHOP_README}\nTODO: say how long the retry waits before giving up.\n`);
  const stashDate = new Date(now - 2 * 60_000).toISOString();
  git(
    shop,
    ["stash", "push", "-q", "-m", "WIP on payments: try a shorter retry delay before giving up on the payment gateway"],
    {
      GIT_AUTHOR_NAME: "Demo Dev",
      GIT_AUTHOR_EMAIL: "demo.dev@demo.invalid",
      GIT_COMMITTER_NAME: "Demo Dev",
      GIT_COMMITTER_EMAIL: "demo.dev@demo.invalid",
      GIT_AUTHOR_DATE: stashDate,
      GIT_COMMITTER_DATE: stashDate,
    },
  );

  // ── shop-web: a second repository in the group, for the project switcher ──
  git(web, ["init", "-q", "-b", "main"]);
  git(web, ["remote", "add", "origin", "git@github.com:demo/shop-web.git"]);
  const webShas = importHistory(web, webHistory(), now, git);
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
    // The branches Jenkins has jobs for (with OLD_BRANCHES, more than it reads).
    branches: ["main", "dev", FEATURE_BRANCH, ...LANE_BRANCHES],
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
