/**
 * GitHub Actions's section of Help → Providers and of `codepulse --help`: its Menu rows explained, then its pull
 * requests in the graph, the details and the Dashboard.
 */
import type { HelpRow } from "../../keybinds";

export const GITHUB_HELP: readonly HelpRow[] = [
  { kind: "section", label: "GitHub" },
  {
    kind: "binding",
    key: "Enabled",
    desc: "Allow switching to the GitHub view in the graph. Data loads once the token is set and the host is allowed.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Last refresh",
    desc: "When GitHub data last loaded successfully.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Token",
    desc: "Environment variable holding a GitHub token. Default is GITHUB_TOKEN.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Host",
    desc: "Host of the repository's remote.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Allow host",
    desc: "Trust a GitHub Enterprise host. github.com is always allowed.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Cache count",
    desc: "Maximum cached commit run snapshots per repository. Options: 10, 20, 50, 100, 200, 500. Default 20.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Fetch size",
    desc: "How many graph commits are queried for workflow runs. Options: 10, 20, 50. Default 20.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Auto refresh",
    desc: "Re-query running workflows and the newest commits while the GitHub view or the Dashboard is shown. Options: off, 2m, 5m, 10m. Default 2m. Git Auto refresh stays git-only.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "PR #123",
    desc: "Chip on the commit an open pull request's branch points at. Muted for a draft and for one merged or closed recently. Never shortened: a tight row folds it into +N.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Pull requests",
    desc: "Tab on such a commit: ◀ open, ◀ muted draft, ✓ merged, ○ closed. Enter opens an open one on its files (read by Git since its branch left the target, its commits fetched when missing), Enter on a file its diff, o opens it on GitHub.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "◀──╮",
    desc: "While the tab is open: where the pull request under the mouse or the cursor would merge, from its branch's commit to its target's.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Dashboard",
    desc: "Pull requests opened, merged and closed, each at its time. Enter shows one in the GitHub view on its row.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Permissions",
    desc: "Actions, Checks, Contents and Pull requests: read. Without Pull requests no chip, tab or event shows.",
    indent: 1,
  },
  { kind: "spacer" },
];
