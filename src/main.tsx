import { existsSync, statSync } from "node:fs";
import { render } from "@opentui/solid";
import App from "./app";
import { parseArgs } from "./cli/parse-args";
import { getKnownRepoInfos, type KnownRepoInfo, loadConfig, mergeOptions, resolveConfigInfo } from "./config";
import { loadCustomThemes } from "./context/custom-themes";
import { addDebugEvent, redactDebugValue } from "./debug/events";
import { getRepoRoot, isGitAvailable, isGitRepo } from "./git/repo";
import { cleanupInactiveProviderCaches } from "./providers/shared/cache-management";
import { closeProviderCaches } from "./providers/shared/sha-sqlite-cache";

/** Startup mode determines which screen the app shows first. */
export type StartupMode =
  | { kind: "graph" }
  | { kind: "setup" }
  | { kind: "selector"; message?: string; messagePath?: string; knownRepos: KnownRepoInfo[] }
  | { kind: "error"; message: string };

export async function main() {
  process.once("exit", () => closeProviderCaches());
  const cli = parseArgs(process.argv);
  try {
    cleanupInactiveProviderCaches();
  } catch (error) {
    const message = redactDebugValue(error instanceof Error ? error.message : String(error));
    addDebugEvent({ source: "error", status: "error", message: `Provider cache cleanup: ${message}` });
  }
  const normalizedCli = {
    ...cli,
    repoPath: (await getRepoRoot(cli.repoPath)) ?? cli.repoPath,
  };

  const configInfo = resolveConfigInfo(normalizedCli.repoPath);
  const { config } = loadConfig(normalizedCli.repoPath);
  const opts = mergeOptions(normalizedCli, config);
  const customThemes = loadCustomThemes();

  let startupMode: StartupMode;

  if (!(await isGitAvailable())) {
    // Fatal — can't do anything without git
    startupMode = { kind: "error", message: "Git is not installed or not on PATH." };
  } else if (!existsSync(opts.repoPath)) {
    // Path doesn't exist — show project selector with message
    startupMode = {
      kind: "selector",
      message: "Hmm, that directory doesn't exist",
      messagePath: opts.repoPath,
      knownRepos: getKnownRepoInfos(),
    };
  } else if (!statSync(opts.repoPath).isDirectory()) {
    // Path is a file, not a directory — show project selector with message
    startupMode = {
      kind: "selector",
      message: "That path is a file, not a directory",
      messagePath: opts.repoPath,
      knownRepos: getKnownRepoInfos(),
    };
  } else if (!(await isGitRepo(opts.repoPath))) {
    // Not a git repo — show project selector with message
    startupMode = {
      kind: "selector",
      message: "Doesn't look like a git repo",
      messagePath: opts.repoPath,
      knownRepos: getKnownRepoInfos(),
    };
  } else if (!configInfo.hasRepoOverrides) {
    // Git repo but not yet known — show welcome screen
    startupMode = { kind: "setup" };
  } else {
    // Git repo + known — start graph directly
    startupMode = { kind: "graph" };
  }

  await render(
    () => (
      <App
        repoPath={opts.repoPath}
        branch={opts.branch}
        all={opts.all}
        maxCount={opts.maxCount}
        themeName={opts.themeName}
        customThemes={customThemes}
        autoRefreshInterval={opts.autoRefreshInterval}
        autoFetchInterval={opts.autoFetchInterval}
        configInfo={configInfo}
        startupMode={startupMode}
        initialGithubConfig={config.providers?.github}
        initialJenkinsConfig={config.providers?.jenkins}
        initialOpenShiftConfig={config.providers?.openshift}
        initialSnykConfig={config.providers?.snyk}
      />
    ),
    {
      exitOnCtrlC: true,
      useMouse: true,
      enableMouseMovement: true,
      targetFps: 60,
    },
  );
}
