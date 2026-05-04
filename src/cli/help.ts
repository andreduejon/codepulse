import { HELP_TABS, KEYBINDS } from "../keybinds";

/** Print the CLI usage text to stdout. */
export function printHelp() {
  const KEY_COL = 38;

  const renderTab = (tab: (typeof HELP_TABS)[number], includeHeader = true) => {
    const header = `  ${tab.label.toUpperCase()}`;
    const rows = KEYBINDS[tab.id]
      .map(row => {
        if (row.kind === "section") return `  ${row.label.toUpperCase()}`;
        if (row.kind === "spacer") return "";
        const key = `${"  ".repeat(row.indent ?? 0)}${row.key}`;
        return `  ${key.padEnd(KEY_COL)} ${row.desc}`;
      })
      .join("\n");
    return includeHeader ? `${header}\n${rows}` : rows;
  };

  const keyboardSections = HELP_TABS.filter(tab => tab.cliSection === "keyboard")
    .map(tab => renderTab(tab))
    .join("\n\n");
  const commandSections = HELP_TABS.filter(tab => tab.cliSection === "commands")
    .map(tab => renderTab(tab, false))
    .join("\n\n");
  const providerSections = HELP_TABS.filter(tab => tab.cliSection === "providers")
    .map(tab => renderTab(tab, false))
    .join("\n\n");

  const lines = [
    "codepulse - A terminal git graph visualizer that is read-only by default",
    "",
    "USAGE:",
    "  codepulse [path]",
    "",
    "ARGUMENTS:",
    "  path                   Path to git repository (default: current directory)",
    "",
    "OPTIONS:",
    "  -h, --help             Show help message",
    "  -v, --version          Show version",
    "",
    "KEYBOARD SHORTCUTS:",
    keyboardSections,
    "",
    "COMMANDS:",
    commandSections,
    "",
    "PROVIDERS:",
    providerSections,
  ];

  console.log(lines.join("\n"));
}
