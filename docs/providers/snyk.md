# Snyk

Codepulse runs Snyk Open Source against exact commits and displays normalized
vulnerability snapshots in the graph. Raw Snyk output is not stored in the
Codepulse cache.

See [common provider behavior](README.md) for shared cache and diagnostic
conventions.

## Requirements

- Snyk CLI available on `PATH`
- Auth token in `SNYK_TOKEN`, or another configured environment variable
- Supported dependency manifests in the repository

Enable Snyk in **Menu → Providers**. Configure concrete local branch names for automatic branch-tip scans. Patterns and remote branch names are not supported.

## Scanning

- Select a commit, press **Enter** to open details, select **Scan commit**, then press **Enter**.
- Run **Rescan commit** to replace an existing result with a fresh scan.
- Configured local branch tips scan automatically when the Snyk view is focused
  and their exact commit has no cached result. Other views read cache only.
  Manual **Scan commit** / **Rescan commit** still run from details.
- Scans include development dependencies (`--dev`) and run sequentially in
  detached temporary Git worktrees. Current checkout remains unchanged.
- For Bun, Codepulse needs a local Bun executable. It runs
  `bun install --yarn --frozen-lockfile --ignore-scripts` in the temporary
  project directory, then scans the generated Yarn lockfile. It verifies that
  the committed `bun.lock` was not changed. Missing Bun or failed conversion
  must not be reported as a clean scan based on an npm fallback.

Each result is a snapshot of that commit against Snyk vulnerability data at displayed scan time. Cached results do not expire automatically.

## Scan outcomes

- **Complete scan** — all supported discovered projects produced a result.
- **Partial scan** — some projects produced results while others failed. The
  result can under-report vulnerabilities.
- **No supported project** — Snyk found no supported dependency project. This
  is not a clean result.
- **Failed scan** — authentication, dependency resolution, repository setup, or
  Snyk execution failed.

A partial scan does not replace an existing complete snapshot. Fix the project
or environment problem, then scan again. Technical details appear in Debug.

## Display

Graph shows four severity counts for exact scanned commits:

```text
C0 H2 M0 L4
```

Zero counts remain visible in muted color. Unscanned commits show placeholders. The **Vulnerabilities** tab lists findings by severity, dependency, installed version, and fixed version when available. Stashes appear only in the Git view.

For multi-project repositories, Codepulse keeps successful project results when
another project fails and labels the result with the failed project count.

Snyk Open Source only scans supported manifests and lockfiles. Unsupported ecosystems or lockfiles produce no usable project result. Add a lockfile Snyk supports, then scan again.

### Dependency graph capture

Scans also capture dependency graphs for committed `bun.lock`, `pnpm-lock.yaml`,
and Yarn v1 `yarn.lock` projects. Codepulse runs a separate
`snyk test --print-graph --all-projects --dev` after findings collection, in the
same worktree. Yarn v2–4 and other package managers retain vulnerability scanning
but are not part of dependency graph support yet. Local pnpm/Yarn executables
are not invoked for these lockfile scans.

Graphs, scopes, and per-project failures are cached with findings. A graph
failure does not discard usable vulnerability results. Returned graphs from an
incomplete graph command are marked incomplete, not a successful empty tree.

### Dependencies browser

**Dependencies** is always available beside **Vulnerabilities** and **Info** in
the Snyk view, including before the first scan. Use **Scan commit** in either tab.
Missing tools, unsupported dependency projects, and graph failures appear in the
existing message overlay; usable findings are retained.

- Scanned files/projects are bold root headers (like severity headers), with
  direct dependencies visible and a right-aligned package count: `N`, or
  `matches/total` while filtering; the filter row shows the overall count the same
  way. Single-graph projects show their own name muted, one space before the
  count (module rows name multi-graph projects). Headers with nothing to open (no matches, failed/skipped) stay listed, muted
  with `·`, and are not cursor stops. Module groups appear only when a lockfile
  produces multiple graphs. Use **Up/Down** to select a row, **Enter** or a left
  click to expand/collapse; closing a node closes everything below it. On a leaf,
  **Enter** copies its full `name@version`. **Left/Right** switches tabs.
- Maven coordinates show as `artifact@version`; the cursor row shows the full
  `group:artifact@version` (banner-scrolling when clipped), which Enter copies.
- Only development dependencies show a muted **dev** flag, aligned right.
  Production and unknown scopes are unmarked; an absent flag does not prove
  production scope. Repeated packages show a muted **repeated** word (Snyk lists
  their dependencies once; they still expand to the same children); a package that
  depends back on an ancestor shows **circular** and stops there.
- A **Scope** row above the filter cycles `[all]` → `[prod]` → `[dev]` (Enter or
  click). It filters direct dependencies (where devDependencies are declared) and
  keeps their whole subtrees; `prod` is everything not flagged dev. Counts and
  filter matches follow the scope.
- A **Group by** row above Scope cycles `[tree]` → `[package]`. The package view
  lists unique `name@version` packages A–Z (versions of one package sit together),
  with muted **direct** (declared directly) and **dev** (reached only through dev
  dependencies) markers; each opens to the direct dependencies that pull it in.
- **Copy dependencies as JSON** (below Rescan) copies commit, scan time, Scope,
  filter, and per project a flat package list (`name`, `version`, `direct`, `dev`,
  `via`), respecting the active Scope and filter. Graphs stay out; they are large.
- Nesting shows each dependency's path. Failed/skipped-project reasons remain
  visible even when their groups collapse.
- **Rescan commit** refreshes findings and graphs together. Existing tree data
  remains inspectable while scanning.

After a commit has a scan result, both tabs show a placeholder-only filter below
the scan action: **Enter vulnerability filter...** or **Enter dependency filter...**.
Unscanned commits do not show a filter. Click the input or select its row with
**Up/Down** to type immediately. **Enter/Esc** stops editing without clearing the
filter; **Esc** again clears it. Leaving and reselecting the row automatically
starts editing again. While editing, Left/Right moves the text caret
instead of switching tabs; app shortcuts are treated as filter text.
The native field stays in place when focus changes, using the repository path
input's subtle hover/focus background, muted placeholder, and accent caret.

Vulnerabilities match package/version, title, CVE, Snyk ID, fix tag (`upgrade`,
`override`, `no fix`), manifest path, and the direct dependency it comes through. Dependencies match
package names case-insensitively, or exact `name@version`; matching paths expand
through collapsed/repeated nodes. Filtering affects detail trees, not the Git
commit graph. No-match results retain failed/skipped-project coverage warnings.
**Copy scan as JSON** (below the scan action, whenever a scan exists) copies the
parsed scan both views are built from: commit, scan time, `counts` (whole scan),
`filteredCounts` (what the filter shows), project status (graphs left out), the
active filter, and the findings it shows — handy as input for agent tools.

A **Group by** row above the filter cycles `[severity]` → `[dependency]` (Enter or
click). Both views follow the same rules: level-1 headers show their entry count
(`current/original` while filtering); headers filtered to zero stay listed, muted
with `·`, and cannot open; level 1 starts open (both levels in the dependency view), CVE details closed; CVE rows look
the same, with plain labels and the score in its severity color; CVEs sort by
severity, score, fix kind, then ID.

The dependency view groups entries under the direct dependency they come through
(the package itself when direct); group order is fixed by the unfiltered scan:
direct fix first, then override-only, then unfixable. Group names are bold, like severity headers. Inside, one row per package to
change — a muted `self` first for the dependency itself (vulnerable directly, or a
Snyk upgrade path), then overrides — with its entry count. CVEs nest under their
package; fix versions are in each CVE's details. Groups and
packages start open (two levels); CVE details closed. Group sizes sum to the total.

Closing any node closes everything below it: reopening shows its children closed.

Vulnerabilities use compact sections after one blank line: a bold `▾ HIGH` header
per severity with its count right-aligned (`12`, or `3/12` while filtering), and
one entry per vulnerability, manifest and package underneath. Each entry row
shows the CVE (or Snyk ID without a CVE) and, right-aligned, a red `!` for a mature
exploit, the CVSS base score in its severity color, and a fix dot colored like CI status:
green when bumping a dependency you declare fixes it, yellow when only the
transitive package has a fix (override), muted when no fix exists. Graph C/H/M/L
chips count the same unit as the tab: one per vulnerability, manifest and package. A legend
(`● upgrade ● override ● no fix ! mature exploit`) stays pinned below the scrolling
list, one blank row above it, while the Vulnerabilities tab shows findings. The score is CVSS base
severity (shown in the severity color); exploit maturity is separate and not part
of it. Expanding shows title, package, `via` direct dependency,
manifest, path count, exploit maturity, and the fix line (`Upgrade x 1.0 → 1.2`,
`Fixed in 11.0.25` — the lowest fixed version above the installed one). Maven
coordinates show as `artifact@version`; the full `group:artifact@version` appears
when the cursor is on the row and is what Enter copies. Every detail line (title,
package, via, manifest, paths, exploit, fix) is a cursor stop: long text
banner-scrolls and Enter copies.
License-policy issues are not shown. Severities with no (matching) findings are muted with a `·` marker,
aligned and not expandable; while filtering they still show `0/M`. The total
count sits at the right end of the filter row; scans with no vulnerabilities hide
the filter. Expansion choices survive filtering and return when it clears. Active-filter counts read `current/original`
for the total and each severity (for example, `3/12`), with
zero counts muted.
Filtering opens every matching path when the result fits in 200 rows; larger
results open one level, and each closed row shows how many matching packages lie
below it (`N+` when counting stopped early). Opening a row that would exceed
1,000 visible rows closes the other open branches, keeping the path to that row.
The 1,000-row limit and its notice remain for a single row with more children;
the filter still searches the full graph, so narrow it to reach remaining nodes.
Unusually cyclic graphs also have a bounded matching-path search. If that limit
is reached, the view explicitly marks matching paths incomplete; package match
counts still come from the full graph.

Vulnerability annotations in the dependency tree and JSON copy remain separate
increments. Scan timestamps remain in cached snapshots, not the tree display.

### CLI compatibility

The verified baseline is **Snyk CLI 1.1303.2**, with dependency graph schema
**1.3.0**. This is a tested version, not a claim that every earlier or later CLI
release is compatible. Codepulse does not impose an arbitrary maximum CLI
version: it validates graph schema, block framing, and references, and records
unsupported output as a graph failure while retaining valid findings.

`--print-graph` is undocumented, so its framing can change independently of the
graph schema. The upstream schema has been 1.3.0 since November 2022; that history
does not guarantee future CLI compatibility.
See the [schema 1.3.0 change](https://github.com/snyk/dep-graph/commit/b65c2f60613fdb8d6ceab011152df8d132a47d1e)
and [upstream schema reader](https://github.com/snyk/dep-graph/blob/master/src/core/create-from-json.ts).

## Cache

Normalized findings and dependency graphs are stored in the shared SQLite database under provider `snyk`,
isolated from other providers' snapshots and log artifacts:

```text
~/.cache/codepulse/cache.sqlite
```

Cache limit can be `10`, `20`, `50`, `100`, `200`, or `500`. Default is `20`. It limits commit scan
snapshots per repository. Least-recently-accessed snapshots are removed when the
limit is exceeded. Repository-wide 90-day inactivity cleanup also applies.
Snyk stores normalized
snapshots only, not log artifacts. Tokens and raw Snyk output are not stored.
Old snapshots without development-dependency and graph-coverage metadata are
discarded and rescanned; there is no cache migration.

## Security

Scans use detached temporary worktrees, so the active checkout remains
unchanged. This is not a security sandbox. Snyk may invoke package managers or
build tooling that execute repository-controlled code with current user
permissions and environment access. Enable automatic scans only for repositories
whose dependency files, build configuration, and scripts you trust.

On Windows, process-tree cleanup uses `taskkill` and cannot guarantee stopping
descendants after their process leader has already exited. Native validation of
this edge case remains release work.
