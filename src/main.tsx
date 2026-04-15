import { existsSync, statSync } from "node:fs";
import { render } from "@opentui/solid";
import App from "./app";
import { parseArgs } from "./cli/parse-args";
import { getKnownRepos, loadConfig, mergeOptions, resolveConfigInfo } from "./config";
import { getRemoteUrl, isGitAvailable, isGitRepo } from "./git/repo";
import { parseGitHubRemote, resolveGhAuthToken } from "./providers/github-actions/api";

/** Startup mode determines which screen the app shows first. */
export type StartupMode =
  | { kind: "graph" }
  | { kind: "setup" }
  | { kind: "selector"; message?: string; messagePath?: string; knownRepos: string[] }
  | { kind: "error"; message: string };

export async function main() {
  const cli = parseArgs(process.argv);

  const configInfo = resolveConfigInfo(cli.repoPath);
  const { config } = loadConfig(cli.repoPath);
  const opts = mergeOptions(cli, config);

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
      knownRepos: getKnownRepos(),
    };
  } else if (!statSync(opts.repoPath).isDirectory()) {
    // Path is a file, not a directory — show project selector with message
    startupMode = {
      kind: "selector",
      message: "That path is a file, not a directory",
      messagePath: opts.repoPath,
      knownRepos: getKnownRepos(),
    };
  } else if (!(await isGitRepo(opts.repoPath))) {
    // Not a git repo — show project selector with message
    startupMode = {
      kind: "selector",
      message: "Doesn't look like a git repo",
      messagePath: opts.repoPath,
      knownRepos: getKnownRepos(),
    };
  } else if (!configInfo.hasRepoOverrides) {
    // Git repo but not yet known — show welcome screen
    startupMode = { kind: "setup" };
  } else {
    // Git repo + known — start graph directly
    startupMode = { kind: "graph" };
  }

  // Pre-warm the gh auth token cache for the detected remote hostname.
  // This is a best-effort async call — failures are silently ignored.
  // The result is cached so getGitHubToken() can use it without blocking.
  try {
    const { config: preConfig } = loadConfig(opts.repoPath);
    const tokenEnvVar = preConfig.providers?.github?.tokenEnvVar ?? "GITHUB_TOKEN";
    const envVal = process.env[tokenEnvVar];
    if (!envVal?.trim()) {
      // Only bother with gh auth if env var isn't already set
      const remoteUrl = await getRemoteUrl(opts.repoPath).catch(() => "");
      const parsed = parseGitHubRemote(remoteUrl);
      if (parsed) {
        await resolveGhAuthToken(parsed.hostname);
      }
    }
  } catch {
    // Ignore — gh auth warm-up is best-effort
  }

  await render(
    () => (
      <App
        repoPath={opts.repoPath}
        branch={opts.branch}
        all={opts.all}
        maxCount={opts.maxCount}
        themeName={opts.themeName}
        autoRefreshInterval={opts.autoRefreshInterval}
        path={opts.path}
        configInfo={configInfo}
        startupMode={startupMode}
        initialGithubConfig={config.providers?.github}
      />
    ),
    {
      exitOnCtrlC: true,
      useAlternateScreen: true,
      useMouse: false,
      targetFps: 40,
    },
  );
}
