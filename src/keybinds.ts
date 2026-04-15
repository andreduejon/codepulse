/** Help dialog / CLI keybind reference — single source of truth. */

export type HelpTab = "general" | "diff" | "commands" | "providers";

export const HELP_TABS: { id: HelpTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "diff", label: "Diff" },
  { id: "commands", label: "Commands" },
  { id: "providers", label: "Providers" },
];

export const KEYBINDS: Record<HelpTab, [string, string][]> = {
  general: [
    ["↑/↓  or  j/k", "Navigate"],
    ["shift ↑/↓  or  shift j/k", "Jump 10 items"],
    ["g", "First item"],
    ["G", "Last item"],
    ["←  or  h", "Exit details / previous tab"],
    ["→  or  l", "Focus details / next tab"],
    ["tab", "Cycle provider view (git → CI)"],
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
    ["PgUp / PgDn", "Scroll detail panel one page"],
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
    [":providers", "Open menu (providers tab)"],
    [":quit", "Quit the application"],
    [":reload", "Reload data from disk"],
    [":repo", "Open menu (repository tab)"],
    [":search", "Switch to search mode"],
    [":theme", "Open theme dialog"],
  ],
  providers: [
    ["── GitHub Actions ──", ""],
    ["", "Authenticate via the GitHub CLI:"],
    ["  gh auth login", ""],
    ["", "Or export a Personal Access Token:"],
    ["  export GITHUB_TOKEN=<token>", ""],
    ["", ""],
    ["── GitHub Enterprise ──", ""],
    ["", "Point to a GHE token env var via:"],
    ["  tokenEnvVar: MY_GHE_TOKEN", "in the config file"],
    ["", ""],
    ["── Config fields ──", ""],
    ["providers.github.enabled", "Show/hide the GitHub Actions tab"],
    ["providers.github.tokenEnvVar", "Env var holding the PAT"],
  ],
};
