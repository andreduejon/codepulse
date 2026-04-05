import { existsSync } from "node:fs";
import { render } from "@opentui/solid";
import App from "./app";
import { parseArgs } from "./cli/parse-args";
import { loadConfig, mergeOptions, resolveConfigInfo } from "./config";
import { isGitAvailable, isGitRepo } from "./git/repo";

export async function main() {
  const cli = parseArgs(process.argv);

  const configInfo = resolveConfigInfo(cli.repoPath);
  const config = loadConfig(cli.repoPath);
  const opts = mergeOptions(cli, config);

  let startupError: string | undefined;
  if (!existsSync(opts.repoPath)) {
    startupError = `Directory does not exist:\n\n${opts.repoPath}`;
  } else if (!(await isGitAvailable())) {
    startupError = `Git is not installed or not on PATH.`;
  } else if (!(await isGitRepo(opts.repoPath))) {
    startupError = `Not a git repository:\n\n${opts.repoPath}`;
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
