/** Snyk's section of Help → Providers and of `codepulse --help`: its Menu rows explained. */
import type { HelpRow } from "../../keybinds";

export const SNYK_HELP: readonly HelpRow[] = [
  { kind: "section", label: "Snyk" },
  {
    kind: "binding",
    key: "Enabled",
    desc: "Allow switching to the Snyk view and scanning exact commits with Snyk Open Source. Scans need the token.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Last scan",
    desc: "When a Snyk scan last finished.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Token",
    desc: "Environment variable holding a Snyk API token. Default is SNYK_TOKEN.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Cache count",
    desc: "Maximum cached commit scans per repository. Options: 10, 20, 50, 100, 200, 500. Default 20.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "New branch",
    desc: "Add a concrete local branch. Its tip auto-scans once, from when the repository loads, when it has no cached scan.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Scan / Rescan commit",
    desc: "Open commit details, select Scan commit or Rescan commit, and press Enter. Existing results remain historical snapshots until rescanned.",
    indent: 1,
  },
];
