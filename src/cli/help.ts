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
