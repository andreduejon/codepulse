/** Jenkins's section of Help → Providers and of `codepulse --help`: its Menu rows explained. */
import type { HelpRow } from "../../keybinds";

export const JENKINS_HELP: readonly HelpRow[] = [
  { kind: "section", label: "Jenkins" },
  {
    kind: "binding",
    key: "Enabled",
    desc: "Allow switching to the Jenkins view in the graph. Data loads once username, token and a job are set.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Last refresh",
    desc: "When Jenkins data last loaded successfully.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Username",
    desc: "Jenkins username for Basic auth.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Token",
    desc: "Environment variable holding a Jenkins API token. Default is JENKINS_TOKEN.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Cache count",
    desc: "Maximum cached commit build snapshots per repository. Options: 10, 20, 50, 100, 200, 500. Default 20.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Fetch size",
    desc: "How many graph commits are queried, and how many recent builds to inspect per job. Options: 10, 20, 50. Default 20.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Auto refresh",
    desc: "Re-query running builds and look for new ones while the Jenkins view or the Dashboard is shown. Options: off, 2m, 5m, 10m. Default 2m. Git Auto refresh stays git-only.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "New job",
    desc: "Add a job or multibranch pipeline URL (not one already listed). Type is detected automatically. Up to 25 enabled branches load across all parents.",
    indent: 1,
  },
  { kind: "spacer" },
];
