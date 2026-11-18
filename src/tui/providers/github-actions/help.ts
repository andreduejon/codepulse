/** GitHub Actions's section of Help → Providers and of `codepulse --help`: its Menu rows explained. */
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
  { kind: "spacer" },
];
