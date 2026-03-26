#!/usr/bin/env bun
import { render } from "@opentui/solid";
import { isGitRepo } from "./git/repo";
import App from "./app";
import packageJson from "../package.json";
import { DEFAULT_MAX_COUNT } from "./constants";

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let repoPath = process.cwd();
  let branch: string | undefined;
  let all = true;
  let maxCount = DEFAULT_MAX_COUNT;
  let themeName = "catppuccin-mocha";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--branch":
      case "-b":
        branch = args[++i];
        all = false;
        break;
      case "--max-count":
      case "-n":
        maxCount = parseInt(args[++i], 10) || DEFAULT_MAX_COUNT;
        break;
      case "--theme":
        themeName = args[++i];
        break;
      case "--no-all":
        all = false;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      case "--version":
      case "-v":
        console.log(`gittree v${packageJson.version}`);
        process.exit(0);
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown option: ${arg}`);
          printHelp();
          process.exit(1);
        } else {
          repoPath = arg.startsWith("/") ? arg : `${process.cwd()}/${arg}`;
        }
    }
  }

  // Check if the path is a git repo
  const isRepo = await isGitRepo(repoPath);
  if (!isRepo) {
    console.error(`Error: ${repoPath} is not a git repository`);
    process.exit(1);
  }

  // Render the TUI
  await render(() => (
    <App
      repoPath={repoPath}
      branch={branch}
      all={all}
      maxCount={maxCount}
      themeName={themeName}
    />
  ), {
    exitOnCtrlC: true,
    useAlternateScreen: true,
    useMouse: false,
    targetFps: 40,
  });
}

function printHelp() {
  console.log(`
gittree - A read-only terminal git graph visualizer

USAGE:
  gittree [options] [path]

ARGUMENTS:
  path                   Path to git repository (default: current directory)

OPTIONS:
  -b, --branch <name>    Show only a specific branch
  -n, --max-count <n>    Maximum number of commits to show (default: ${DEFAULT_MAX_COUNT})
      --theme <name>     Color theme (use ctrl+t in-app to browse)
      --no-all           Don't show all branches
  -h, --help             Show this help message
  -v, --version          Show version

KEYBOARD SHORTCUTS:
  ↑/↓                    Navigate list
  Shift+↑/↓              Jump 10 entries
  PgUp/PgDn              Jump 20 entries
  g/G                    First / last commit
  Enter                  Focus detail / activate
  →/←                    Focus detail / return to graph
  Esc                    Back (cascade)
  q                      Back, or quit
  /                      Search commits
  f                      Fetch from remote
  R                      Reload data
  m                      Menu
  Ctrl+T                 Change theme
  ?                      Show help
`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
