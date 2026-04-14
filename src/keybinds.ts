/** Help dialog / CLI keybind reference — single source of truth. */

export type HelpTab = "general" | "diff" | "commands";

export const HELP_TABS: { id: HelpTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "diff", label: "Diff" },
  { id: "commands", label: "Commands" },
];

export const KEYBINDS: Record<HelpTab, [string, string][]> = {
  general: [
    ["↑/↓  or  j/k", "Navigate"],
    ["shift ↑/↓  or  shift j/k", "Jump 10 items"],
    ["g", "First item"],
    ["G", "Last item"],
    ["←  or  h", "Exit details / previous tab"],
    ["→  or  l", "Focus details / next tab"],
    ["enter", "Activate / confirm"],
    ["esc", "Back (cascading)"],
    ["a", "Enter ancestry mode"],
    ["f", "Fetch from remote"],
    ["m", "Open menu dialog"],
    ["q", "Quit"],
    ["?", "Open help dialog"],
    [":", "Command mode"],
    ["/", "Search mode"],
    ["shift  ←/→", "Switch mode"],
  ],
  diff: [
    ["←  or  h", "Previous file"],
    ["→  or  l", "Next file"],
    ["b", "Toggle blame"],
    ["c", "Cycle view mode"],
    ["w", "Toggle line wrap"],
    ["esc", "Close diff dialog"],
  ],
  commands: [
    [":ancestry", "Enter ancestry mode"],
    [":fetch", "Fetch from remote"],
    [":help", "Open help dialog"],
    [":menu", "Open menu dialog"],
    [":path", "Switch to path mode"],
    [":quit", "Quit the application"],
    [":reload", "Reload data from disk"],
    [":search", "Switch to search mode"],
    [":theme", "Open theme dialog"],
  ],
};
