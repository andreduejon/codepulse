import { existsSync, statSync } from "node:fs";
import { render } from "@opentui/solid";
import { closeProviderCaches } from "./adapters/cache/sha-sqlite-cache";
import { readCustomThemesFile } from "./adapters/settings/theme-file";
import { parseArgs } from "./cli/parse-args";
import type { AppPorts } from "./core/app-ports";
import { addDebugEvent, redactDebugValue } from "./core/debug-events";
import { mergeOptions, reportConfigWarnings } from "./core/settings/config";
import { portsFrom } from "./ports";
import { builtInProviders, modulesOf, type ProviderPlugin } from "./providers";
import App from "./tui/app/app";
import type { AppProps, StartupMode } from "./tui/app/app-types";
import { parseCustomThemes } from "./tui/context/custom-themes";
import { setDefaultPorts } from "./tui/context/ports";
import { setDefaultProviderModules } from "./tui/context/provider-modules";

/** Startup mode determines which screen the app shows first. */
/**
 * Everything before the first frame: arguments, config, themes and which screen to show. The demo's headless player
 * (`bun run demo --play`) starts the app through this too, so it boots the way the real app does.
 */
export async function startupProps(
  argv: string[],
  ports: Partial<AppPorts> = {},
  plugins: readonly ProviderPlugin[] = builtInProviders,
): Promise<AppProps> {
  const all = portsFrom(ports, {}, plugins);
  setDefaultPorts(all);
  const providerModules = modulesOf(plugins);
  setDefaultProviderModules(providerModules);
  const { settings, git, cacheStore, providers, system, dashboard } = all;
  const cli = parseArgs(argv);
  try {
    cacheStore.cleanupInactive();
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
    system,
    dashboard,
    providerModules,
    startupMode,
    initialProviderSettings: config.providers,
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
