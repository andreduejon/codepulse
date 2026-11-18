/** OpenShift's section of Help → Providers and of `codepulse --help`: its Menu rows explained. */
import type { HelpRow } from "../../keybinds";

export const OPENSHIFT_HELP: readonly HelpRow[] = [
  { kind: "section", label: "OpenShift" },
  {
    kind: "binding",
    key: "Enabled",
    desc: "Allow switching to the OpenShift view in the graph. Data loads once server, token and a namespace are set.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Last refresh",
    desc: "When OpenShift data last loaded successfully.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Server",
    desc: "OpenShift API server URL.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Console",
    desc: "Optional web console URL, so o opens namespaces and resources in the browser.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Token",
    desc: "Environment variable holding an OpenShift API token. Default is OPENSHIFT_TOKEN.",
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
    desc: "How many graph commits are eligible for background build matching. Options: 10, 20, 50. Default 20.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Auto refresh",
    desc: "Poll Builds and ImageStreamTags while the OpenShift view or the Dashboard is shown. Options: off, 2m, 5m, 10m. Default 2m. Live Deploy/DC/Pod use watch, not this timer. Git Auto refresh stays git-only.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "Annotation",
    desc: "Commit SHA key. Labels first, then annotations, on Builds, Deployments, and ImageStreamTags. Default is dev/commit-sha.",
    indent: 1,
  },
  {
    kind: "binding",
    key: "New namespace",
    desc: "Add a namespace to inventory (not one already listed).",
    indent: 1,
  },
  { kind: "spacer" },
];
