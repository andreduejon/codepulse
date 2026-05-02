import { HELP_TABS, KEYBINDS } from "../keybinds";

/** Print the CLI usage text to stdout. */
export function printHelp() {
  const KEY_COL = 30;

  const sections = HELP_TABS.map(tab => {
    const header = `${tab.label.toUpperCase()}:`;
    const rows = KEYBINDS[tab.id].map(([key, desc]) => `  ${key.padEnd(KEY_COL)}${desc}`).join("\n");
    return `${header}\n${rows}`;
  }).join("\n\n");

  console.log(`
codepulse - A read-only terminal git graph visualizer

USAGE:
  codepulse [path]

ARGUMENTS:
  path                   Path to git repository (default: current directory)

OPTIONS:
  -h, --help             Show this help message
  -v, --version          Show version

KEYBOARD SHORTCUTS:
${sections}
`);
}
