import { render } from "@opentui/solid";
import App from "./app";
import { parseArgs } from "./cli/parse-args";
import { loadConfig, mergeOptions } from "./config";
import { isGitRepo } from "./git/repo";

export async function main() {
  const cli = parseArgs(process.argv);

  // Check if the path is a git repo
  const isRepo = await isGitRepo(cli.repoPath);
  if (!isRepo) {
    console.error(`Error: ${cli.repoPath} is not a git repository`);
    process.exit(1);
  }

  // Load config file and merge with CLI args (CLI wins)
  const config = loadConfig(cli.repoPath);
  const opts = mergeOptions(cli, config);

  // Render the TUI
  await render(
    () => (
      <App
        repoPath={opts.repoPath}
        branch={opts.branch}
        all={opts.all}
        maxCount={opts.maxCount}
        themeName={opts.themeName}
        autoRefreshInterval={opts.autoRefreshInterval}
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
