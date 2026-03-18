#!/usr/bin/env bun
import { render } from "@opentui/solid";
import { isGitRepo } from "./git/repo";
import App from "./app";
import packageJson from "../package.json";

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let repoPath = process.cwd();
  let branch: string | undefined;
  let all = true;
  let maxCount = 200;
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
        maxCount = parseInt(args[++i], 10) || 200;
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
    targetFps: 60,
  });
}

function printHelp() {
  console.log(`
gittree - A beautiful terminal git graph visualizer

USAGE:
  gittree [options] [path]

ARGUMENTS:
  path                   Path to git repository (default: current directory)

OPTIONS:
  -b, --branch <name>    Show only a specific branch
  -n, --max-count <n>    Maximum number of commits to show (default: 200)
      --theme <name>     Color theme (catppuccin-mocha, tokyo-night, dracula, nord)
      --no-all           Don't show all branches
  -h, --help             Show this help message
  -v, --version          Show version

KEYBOARD SHORTCUTS:
  j/k or Up/Down         Navigate commits
  Shift+Up/Down          Jump 10 entries
  g/G                    First/last commit
  /                      Search commits
  b                      Branch picker
  a                      Toggle all branches
  Ctrl+T                 Change theme
  Ctrl+S                 Open settings
  ?                      Show help
  q or Ctrl+C            Quit
`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
