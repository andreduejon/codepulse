import { existsSync, statSync } from "node:fs";
import { render } from "@opentui/solid";
import App from "./app";
import type { AppProps } from "./app-types";
import { parseArgs } from "./cli/parse-args";
import { parseCustomThemes } from "./context/custom-themes";
import { setDefaultPorts } from "./context/ports";
import type { AppPorts } from "./core/app-ports";
import { addDebugEvent, redactDebugValue } from "./core/debug-events";
import { type KnownRepoInfo, mergeOptions, reportConfigWarnings } from "./core/settings/config";
import { portsFrom } from "./ports";
import { cleanupInactiveProviderCaches } from "./providers/shared/cache-management";
import { closeProviderCaches } from "./providers/shared/sha-sqlite-cache";
import { readCustomThemesFile } from "./theme-file";

/** Startup mode determines which screen the app shows first. */
export type StartupMode =
  | { kind: "graph" }
  | { kind: "setup" }
  | { kind: "selector"; message?: string; messagePath?: string; knownRepos: KnownRepoInfo[] }
  | { kind: "error"; message: string };

/**
 * Everything before the first frame: arguments, config, themes and which screen to show. The demo's headless player
 * (`bun run demo --play`) starts the app through this too, so it boots the way the real app does.
 */
export async function startupProps(argv: string[], ports: Partial<AppPorts> = {}): Promise<AppProps> {
  const all = portsFrom(ports);
  setDefaultPorts(all);
  const { settings, git, cacheStore, providers } = all;
  const cli = parseArgs(argv);
  try {
    cleanupInactiveProviderCaches();
  } catch (error) {
    const message = redactDebugValue(error instanceof Error ? error.message : String(error));
    addDebugEvent({ source: "error", status: "error", message: `Provider cache cleanup: ${message}` });
  }
  const normalizedCli = {
    ...cli,
    repoPath: (await git.getRepoRoot(cli.repoPath)) ?? cli.repoPath,
  };

  const configInfo = settings.info(normalizedCli.repoPath);
  const { config, warnings } = settings.load(normalizedCli.repoPath);
  reportConfigWarnings(warnings);
  const opts = mergeOptions(normalizedCli, config);
  const customThemes = parseCustomThemes(readCustomThemesFile());

  let startupMode: StartupMode;

  if (!(await git.isGitAvailable())) {
    // Fatal — can't do anything without git
    startupMode = { kind: "error", message: "Git is not installed or not on PATH." };
  } else if (!existsSync(opts.repoPath)) {
    // Path doesn't exist — show project selector with message
    startupMode = {
      kind: "selector",
      message: "Hmm, that directory doesn't exist",
      messagePath: opts.repoPath,
      knownRepos: settings.knownRepos(),
    };
  } else if (!statSync(opts.repoPath).isDirectory()) {
    // Path is a file, not a directory — show project selector with message
    startupMode = {
      kind: "selector",
      message: "That path is a file, not a directory",
      messagePath: opts.repoPath,
      knownRepos: settings.knownRepos(),
    };
  } else if (!(await git.isGitRepo(opts.repoPath))) {
    // Not a git repo — show project selector with message
    startupMode = {
      kind: "selector",
      message: "Doesn't look like a git repo",
      messagePath: opts.repoPath,
      knownRepos: settings.knownRepos(),
    };
  } else if (!configInfo.hasRepoOverrides) {
    // Git repo but not yet known — show welcome screen
    startupMode = { kind: "setup" };
  } else {
    // Git repo + known — start graph directly
    startupMode = { kind: "graph" };
  }

  return {
    repoPath: opts.repoPath,
    branch: opts.branch,
    all: opts.all,
    maxCount: opts.maxCount,
    themeName: opts.themeName,
    customThemes,
    autoRefreshInterval: opts.autoRefreshInterval,
    autoFetchInterval: opts.autoFetchInterval,
    configInfo,
    settings,
    git,
    cacheStore,
    providers,
    startupMode,
    initialGithubConfig: config.providers?.github,
    initialJenkinsConfig: config.providers?.jenkins,
    initialOpenShiftConfig: config.providers?.openshift,
    initialSnykConfig: config.providers?.snyk,
  };
}

export async function main() {
  process.once("exit", () => closeProviderCaches());
  const props = await startupProps(process.argv);
  await render(() => <App {...props} />, {
    exitOnCtrlC: true,
    useMouse: true,
    enableMouseMovement: true,
    targetFps: 60,
  });
}
