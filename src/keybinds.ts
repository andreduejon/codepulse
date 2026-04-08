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
    ["space", "Toggle ancestry highlighting"],
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
    [":q or :quit", "Quit the application"],
    [":m or :menu", "Open menu dialog"],
    [":f or :fetch", "Fetch from remote"],
    [":r or :reload", "Reload data from disk"],
    [":p or :path", "Switch to path mode"],
    [":search", "Switch to search mode"],
    [":a or :ancestry", "Toggle ancestry highlighting"],
    [":theme", "Open theme dialog"],
    [":help", "Open help dialog"],
  ],
};
