import { existsSync } from "node:fs";
import { render } from "@opentui/solid";
import App from "./app";
import { parseArgs } from "./cli/parse-args";
import { loadConfig, mergeOptions, resolveConfigInfo } from "./config";
import { isGitAvailable, isGitRepo } from "./git/repo";

export async function main() {
  const cli = parseArgs(process.argv);

  // Load config file and merge with CLI args (CLI wins)
  const configInfo = resolveConfigInfo(cli.repoPath);
  const config = loadConfig(cli.repoPath);
  const opts = mergeOptions(cli, config);

  // Run startup checks — collect error rather than exiting, so we can
  // render a friendly in-TUI error screen instead of a raw stderr message.
  let startupError: string | undefined;

  if (!existsSync(opts.repoPath)) {
    startupError = `Directory does not exist:\n  ${opts.repoPath}\n\nCheck the path and try again:\n  codepulse /path/to/repo`;
  } else if (!(await isGitAvailable())) {
    startupError = `git is not installed or not on PATH\n\nInstall git: https://git-scm.com/downloads`;
  } else if (!(await isGitRepo(opts.repoPath))) {
    startupError = `Not a git repository:\n  ${opts.repoPath}\n\nRun codepulse inside a git repo, or pass the path as an argument:\n  codepulse /path/to/repo`;
  }

  // Render the TUI — App shows the error screen or the normal graph
  await render(
    () => (
      <App
        repoPath={opts.repoPath}
        branch={opts.branch}
        all={opts.all}
        maxCount={opts.maxCount}
        themeName={opts.themeName}
        autoRefreshInterval={opts.autoRefreshInterval}
        configInfo={configInfo}
        startupError={startupError}
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
