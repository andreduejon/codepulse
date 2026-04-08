import { DEFAULT_MAX_COUNT } from "../constants";

/** Print the CLI usage text to stdout. */
export function printHelp() {
  console.log(`
codepulse - A read-only terminal git graph visualizer

USAGE:
  codepulse [options] [path]

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
  ↑/↓  or  j/k           Navigate
  Shift+↑/↓              Jump 10 items
  g / G                  First / last item
  → / ←                  Focus details / return to graph
  Enter                  Activate / confirm
  Esc                    Back (cascading)
  Space                  Toggle ancestry highlighting
  /                      Search mode
  :                      Command mode (try :help for commands)
`);
}
