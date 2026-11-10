# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- `o` opens the selected row in the browser from the detail panel: a GitHub run or job, a Jenkins build, an
  OpenShift namespace or resource, or a Snyk finding (its security.snyk.io page). The footer offers `o` only on
  rows that have a page.
- OpenShift **Console** setting (optional): the web console URL that `o` uses for namespaces and resources, in the
  detail panel and the resource dialog. It cannot be worked out from the API server URL.
- OpenShift resource dialog: an events view. `c` cycles log, JSON and events for Pods, Builds, Deployments and
  DeploymentConfigs. It starts with what the status says is wrong (a container waiting on `CrashLoopBackOff`, its
  last run's exit code and restarts, failing conditions with their messages), which stays after OpenShift deletes the events
  and where they are forbidden. Then the events, newest first (`LAST SEEN  TYPE  REASON  COUNT  MESSAGE`),
  warnings in the warning colour, searchable, and `r` refetches them. The dialog title counts the warnings. It
  needs `list` on `events`; without it the view says so.
- OpenShift view: each namespace that runs a commit shows as a badge next to its refs, also below the fetch size.
  The badge only names the namespace; the Live counts and the details show whether it is ready, rolling out or
  failing, and a legend below the tree explains the row marks. A namespace running a commit the graph does not
  show is named at the end of the graph.

- GitHub Actions: a failed job lists its annotations after its steps (failures and warnings, with file and line).
  Enter opens the job log with the message searched; they are read once per failed job and cached.

- GitHub Actions re-runs: the run row names its attempt (`attempt 2`), and earlier attempts are folded rows at the
  end of the run that expand to their jobs and logs.

- Jenkins stages are selectable: Enter opens only that stage's part of the console log, titled with the stage and
  its time, and `←` / `→` move between stages. `←` from the first stage shows the full log: a summary (each stage
  with its mark and time, the test counts), then the whole console. It is cut from the cached console log, so no
  extra requests.
- Jenkins: a finished build with a JUnit report shows a **Tests** row with its failed tests. Enter opens a
  failure's error and stack trace in the log viewer, titled with the test, `←` / `→` move between failed tests.
- Jenkins: a legend below the tree explains the marks (`✓ passed  ● running  ✗ failed  – skipped  ○ aborted`).
- GitHub Actions: the job log's title gives the job's time, and the log starts with its steps (marks and times).
  A legend below the tree explains the marks (`✓ passed  ● running  ✗ failed  – skipped  ○ cancelled`).

- Snyk Vulnerabilities compare with an earlier scan: folded NEW and FIXED trees at the end, their muted headings
  naming the scan (`vs parent 4c5d6e7`, or `vs 1a2b3c4, 3 commits back` when the parent has no scan and the
  nearest scanned commit stands in). Added findings also keep a muted `new` under their severity. `new` and
  `fixed` work as filter words.

### Changed

- Jenkins rows are as quiet as the OpenShift tree: a build lists its stages straight under it (no **Pipeline**
  row) with their marks only. Times and test counts moved to the log viewer, so the build's age no longer shifts
  when its stages load. A build without stages has one **Console** row.
- GitHub Actions rows are as quiet as the Jenkins and OpenShift trees: names, marks and the run's age, without
  step counts, times or the annotation count. A job that passed is one row; a failed or running job lists its
  steps.
- Jenkins logs show `[Pipeline] { (Unit tests)` as the heading `▸ Unit tests` and mute the rest of the Pipeline
  markup, a parallel branch's opening too.
- Log and diff footers say where the arrows go, without abbreviations: `← previous stage · → next stage`,
  `← full log`, `→ first stage`, `previous test`, `previous job`, `previous file`. The arrow that goes nowhere is
  left out of a log footer. Search reads `n/N next/previous`.
- Jenkins multibranch: over the 25 branch-job limit, the branches in the graph are read first, then the most
  recently built. The notice gives the counts and what they mean (`Branch jobs · 25 of 61 read`, then
  `Builds on the other 36 do not show.`).
- Graph ref badges take only their own width, so short names (`main`, `dev`) are no longer folded into `+N` for
  the room a long name would need.
- A selected Snyk severity, NEW or FIXED heading keeps its colour on the arrow too. The row shade marks the
  cursor.

### Fixed

- OpenShift: when the cluster lists but does not allow watching, the **Watch denied** notice no longer disappears
  as soon as the next build list arrives. The data can go stale while the watches are stopped, so the notice stays
  until a Reload.
- Log views `issues only` and `errors only` keep test failures: a line ending in `FAILED`, an error or exception
  with its message (`AssertionFailedError: expected …`), Bun's `(fail)`, Jest's `✕`, Vitest's `×` and `FAIL src/…`.
  `0 failed` is not an error.
- A GitHub run no longer shows its first job's time as the run's time (`CI #812` read `2m 17s` while `test` took
  `5m 17s`), and a skipped step no longer shows `0s`. Times are in the job log now, each job's and step's own.
- OpenShift `(cached)` marks only a Build the cluster no longer lists. A Build it still lists is fresh, also once
  it is saved.
- A Deployment scaled to 0 no longer marks its commit as running in a namespace. Details list it with
  `0 replicas`.
- OpenShift Live counts show for every running commit at once. When the live list came before the Build list,
  a commit only got them once selected.
- A long OpenShift resource name no longer pushes its status mark out of a narrow detail panel.
- Log search with wrap off: a hit past the right edge moves the lines sideways (they start with `…`) so it shows.
- A followed OpenShift log that drops its oldest lines keeps the selected search hit (`2/2` stays `2/2`).
- A narrow footer leaves out whole key hints, least needed first, instead of cutting the last one mid-word.
- Graph subjects that do not fit end in `…` (opentui cut them in the middle with `...`), counted in terminal
  columns so wide characters (CJK, emoji) no longer shift columns; ref badges too. Run tree, OpenShift group and
  stash rows end in `…` the same way.
- A selected Snyk package row (Vulnerabilities grouped by dependency) shows its full coordinate and scrolls.
- The footer's `tab` hint says `Actions` for the GitHub view, like its detail tab.

## [0.16.0] - 2026-11-09

### Added

- Search CI job logs and OpenShift resource logs and JSON with `/`; `n` / `N` move
  between hits, Esc clears the search before a second Esc closes the dialog. While
  typing, the search bar is highlighted from `/` to its hit count, and the current
  hit's line number is shown in the hit color across the number column.
- `r` reloads a CI job log (newer output of a running job, or a retry after a
  failure; a finished job's log comes from the cache). In the OpenShift dialog `r`
  refreshes what is shown: the log, or the object in JSON view.
- Failure first: entering a commit's Actions or Jenkins tab opens its first failed
  run and puts the cursor on its first failed job.
- The footer names every provider's work, including auto refresh: `GitHub Actions
  fetching`, `Jenkins fetching`, `OpenShift fetching`, `Snyk scanning`.
- Graph chips show cancelled, skipped, and unknown CI runs as a grey chip; a partial
  Snyk scan adds a warning `?` after its scan time, and a commit being scanned says
  `scanning...`.
- Compact details show why a provider cannot work, since the banner is behind the
  dialog.
- A notice at the end of the graph when an older page of history fails to load.
- Snyk's menu shows **Last scan**.

### Changed

- One busy vocabulary: `fetching` (network), `reading` (local Git), `scanning`
  (Snyk). Standalone busy text ends in `...`; truncation uses `…`.
- Providers share their detail rows: OpenShift says **Load commit** / **Reload
  commit** like the CI tabs; an unavailable provider's action row (Reload or Scan) is
  muted and skipped by the cursor, also after its banner is closed.
- After an expired token (401), automatic requests stop for every provider until
  **Reload commit**, `:reload`, or `f` retries; auth banners end in *Reload to retry*.
- CI and OpenShift log dialogs share loading, empty, and error states (with the real
  reason), scrolling keys, and footer words (`search · view · wrap · refresh`). The
  line number column is as wide as the largest number on screen, so it starts at the
  text inset instead of leaving room for the last line of a long log.
- Provider graph columns widen to fit their counts without squeezing out the
  subject, dim with search, path, and ancestry, and bold the selected row. In tight
  rows ref badges shorten and collapse into `+N` (the checked-out branch keeps its
  badge), and counts go compact before the ones that do not fit give way to `…`.
- Every provider's **Token** row asks for a variable name, rejects invalid names, and
  falls back to its default. Duplicate namespaces and job URLs are rejected while
  typing. Jenkins job rows read **Job #1**.
- Help merges the CI and OpenShift log sections, lists the missing keys, and uses the
  menu's names; `shift ↑/↓` jumps 10 rows everywhere and the theme list takes `j/k`.
  `f` and `:fetch` read "Fetch Git and the open provider", which is what they do.
- Theme Details mark a changed color with `old → new` and normal text instead of an
  asterisk, and only colors that differ from the base (one changed graph color no
  longer marks them all). In a very small terminal they are cut off instead of
  drawing over the footer.
- Dialogs leave one empty row around the footer hints, like the title (was two).
- Long selected names scroll in Files, CI, and OpenShift rows; a commit body taller
  than the panel scrolls with `↑/↓` before the cursor moves past it.
- The cache card uses the 1+4 inset, keeps the repository switcher's height (16
  rows, the rest scrolls), and tells same-named repositories apart. Every reset and
  eviction asks first in a message box above it (errors show there too), a reset
  keeps the list where it was scrolled, and `a` resets all timers (was `shift+r`).

### Fixed

- GitHub Actions, Jenkins, and OpenShift showed cached commits only within the fetch
  size, so with a larger cache limit older cached commits stayed empty (OpenShift
  showed builds the cluster had removed nowhere). They now show every cached commit
  from disk, without extra requests. Showing a cached commit or Snyk scan no longer
  counts as a use, so eviction still removes the least recently used first.
- Typing `q` in a menu field quit Codepulse; `f` on Fetch remote did nothing.
- Closing compact details with the mouse left keyboard focus on the hidden panel.
- Jenkins Reload and Fetch missed new builds on finished commits, per-commit reloads
  hid their errors, and aborted builds showed as unknown.
- OpenShift: a failed live list emptied the workloads, live updates re-expanded
  namespaces and moved the cursor, a recovered list kept its old warning, and empty
  namespaces left invisible cursor stops.
- Reload and auto refresh left expanded jobs and steps of running runs stale, and a
  job or step still running when its run finished stayed running from the cache.
- Wrapped CI logs could not scroll to the bottom; CI log failures showed as empty
  logs.
- View-entry provider refreshes were cancelled by their own results, which hid a
  failed GitHub refresh. A request made while a fetch ran lost what it asked for (its
  commits, status, retry) and counted as done before it had run, and leaving a view
  during its first fetch left it loading.
- The uncommitted node in provider views showed file counts but no files; Info lost
  the commit body in provider views.
- A failed history page retried in a loop, and a page still loading during a branch
  switch merged the old branch's commits into the new graph.
- Future dates showed as "just now"; the Branches menu said "all branches" when it
  was not; the commit count included the working-tree node.
- A custom theme `accent` had no effect in the Git view.

## [0.15.0] - 2026-11-07

### Added

- Mark Snyk dependencies that an override forces with a muted `override` keyword
  in Dependencies: pnpm's from `pnpm-lock.yaml`, npm `overrides`, Yarn
  `resolutions`, and both for Bun, from `package.json`. The dependency filter also
  matches the keyword, so `override` lists them with their paths.
- Flag overrides that could go with a muted `removable` keyword: every parent's own
  range (from `pnpm view` or `npm view`, cached per repository) would already resolve
  to a version the override allows.
- Mark Maven dependencies that `<dependencyManagement>` pins with a muted `managed`
  keyword, following in-repo parent POMs, imported in-repo BOMs and `${property}`
  versions. Only packages pulled in through another dependency are marked.
- The dependency filter word `pinned` lists `override` and `managed` packages
  together.
- The footer shows **Snyk scanning** (instead of `loading`) while Snyk scans run, in
  every view; scans keep running in other views, and one that fails there shows its
  error in the banner.

### Changed

- Status banners show a bold headline, their source, and muted detail lines
  (`Partial scan · Snyk`, then `Kept last complete snapshot.`).
- Cache screen confirmations, errors and results use the same layout inside their
  card: a bold headline in the message colour with muted detail below.
- Results that work but are incomplete show as a notice pinned under the detail
  tabs instead of the banner over the graph, which now only reports problems that
  stop a provider. Snyk projects without a dependency graph list each path with its
  reason under **Dependencies**; partial scans name their failed projects under
  **Vulnerabilities**. Close a notice with its `✕` or `:clear`.
- Failed Snyk projects show the reason Snyk printed (for example an out-of-sync
  lockfile or an unresolvable parent POM) instead of a generic "no dependency
  graph". A missing `node_modules` folder explains that the project needs a
  lockfile, since scans run on a clean checkout.
- Snyk snapshots from v0.14.0 stay valid; rescan a commit to get the new markers
  and Snyk's failure reasons.
- When Snyk could not resolve any project, the banner names each manifest with
  Snyk's reason instead of a generic "Snyk scan failed."
- The footer names Git's work instead of `loading`: **Git fetching** (`f`, from the
  remote) and **Git reading log** (local: start, reload, repository switch, branch
  views, more history while scrolling). Reading a commit's details only shows the
  spinner.

### Fixed

- Override transitive Seroval to 1.6.11 for CVE-2026-116582 and CVE-2026-116583,
  found by scanning Codepulse with its own Snyk provider.
- Snyk legends wrap whole entries in narrow panels instead of clipping the first
  marker.

## [0.14.0] - 2026-10-25

### Added

- Capture normalized Snyk dependency graphs for Bun, npm, pnpm, Yarn (1–4), and
  Maven projects alongside findings, with per-project failures and safe Bun-to-Yarn conversion
  in temporary worktrees. Every tracked `pom.xml` is its own project; Maven `test`
  dependencies are dev, `compile`/`provided`/`runtime`/`system` are prod. Maven projects
  need Java plus `mvn` on PATH or a committed Maven Wrapper (`mvnw`).
- Add the Snyk **Dependencies** browser for scanned supported projects, with
  bold project headers showing package counts, expandable dependency groups,
  short Maven names (full name on the selected row), copyable leaves, muted dev labels,
  muted `repeated`/`circular` markers, a **Scope** `[all]`/`[prod]`/`[dev]` switch,
  and persistent failed/skipped-project reasons.
- Add live filters to both Snyk detail trees (`name@version` matches that package
  exactly, anything else is a substring), including collapsed/repeated dependency paths; large dependency results open one level with per-row match
  counts, and opening past 1,000 rows closes other branches. Add **Group by**
  `[tree]`/`[package]` and **Copy dependencies as JSON** (with each package's own
  worst severity and CVE IDs) to Dependencies. Both Snyk tabs keep their view while
  switching tabs for the same scan.
- Mark vulnerable packages in Dependencies with a `▲` in their worst severity
  colour (pinned legend); **v** opens Vulnerabilities filtered to that package.
- Highlight filter hits in both Snyk tabs in the Snyk colour; mute filter counts.
- Show a CVSS score, mature-exploit marker, and fix dot (upgrade, override, no fix)
  on every vulnerability, with a pinned legend; expand to title, package, `via`
  dependency, manifest, exploit maturity, and fix line, each copyable.
- Add **Group by** `[severity]` / `[dependency]` to Vulnerabilities: the dependency
  view groups findings under the direct dependency and package to change.
- Add **Copy scan as JSON** for handing parsed findings to agent tools; it respects
  the active filter.
- Status banners have a clickable `✕` to dismiss them.

### Changed

- Rename the Snyk detail tab to **Vulnerabilities**, size detail tabs by label
  length, and show Stashes only in Git view.
- Take direct-dependency scopes from `package.json` for npm, Yarn, pnpm, and Bun
  graphs (Snyk marks shared runtime packages as dev), and let rows inherit their
  direct dependency's scope. Rescan to correct older snapshots.
- Include development dependencies in Snyk scans and discard older snapshots
  without dependency coverage metadata. Retain findings when graph capture fails;
  missing or incomplete dependency graphs show as a yellow warning banner (one
  summary for all affected projects), and scan failures stay red.
- List one vulnerability per CVE, manifest, and package (graph chips count the
  same unit), and pick the lowest fixed version above the installed one.
- Hide Snyk license-policy issues. Previously scanned commits need a rescan after
  updating.
- Count projects Snyk could not resolve as failed, even when its JSON findings omit
  them (Snyk only reports them on stderr): such scans are now partial and name the
  failed manifests.
- **Rescan commit** stores a partial result over a complete snapshot, so its failed
  projects stay visible instead of a "Kept last complete snapshot" error.
- **Show all branches** lists local and remote branches, tags, and HEAD instead of every
  ref, so commits behind tool-private refs (T3 checkpoints, `git maintenance` prefetches)
  no longer appear in the graph.

### Fixed

- Ignore Snyk upgrade paths that keep every installed version (seen with pnpm), which
  showed as "Upgrade X 1.0 → 1.0"; these findings now show their override or no fix.
  Existing snapshots are corrected without a rescan.
- Apply each repository's saved theme when switching repositories; the previous
  repository's theme stayed and was saved into the new one on the next settings change.
  An unknown theme falls back to the default, as at startup.

## [0.13.0] - 2026-10-14

### Added

- **Custom themes** — load `themes.json` beside global configuration, inherit
  from a predefined theme or define a standalone palette, and inspect effective
  colors and explicit overrides. Invalid entries are skipped independently.
- **Theme inspector** — preview themes, save without closing, and browse
  scrollable HEX colors with pinned theme metadata and override markers.
- **Global cache management** — use `:cache` to inspect grouped repository cache
  sizes, copy the database path, reset inactivity timers, and evict repository
  data. Provider activity pauses while the screen is open.

### Changed

- Store provider snapshots and logs in one shared SQLite database with bounded
  retention and inactivity cleanup. Configuration and themes remain JSON.
- Write configuration atomically and preserve unreadable existing files rather
  than replacing them. Share terminal provider snapshot persistence.

### Fixed

- Preserve non-ASCII and exact untracked paths, list root-commit files and staged
  renames, and compare merge-commit file diffs against the first parent.
- Load HEAD beyond the first history page and cancel Git work on loader cleanup.
- Bound file-content, diff, and blame reads at 8 MiB.
- Strip terminal escape sequences from CI and pod logs.
- Keep credentialed Jenkins build and cached-run requests on the configured
  origin, and surface GitHub job/check-suite page-limit truncation.
- Clean up Snyk scan worktrees orphaned by killed processes.

## [0.12.1] - 2026-10-13

### Fixed

- Replace fragile Windows installer startup architecture detection with a native
  processor query compatible with Windows PowerShell 5.1 and PowerShell 7.
- Register the installation folder in user PATH and the current PowerShell
  session, preserving existing entries and the registry value type. Repeated
  installation does not add duplicate entries. System PATH remains unchanged.
- Expand Windows installer regressions to cover both available PowerShell
  runtimes, architecture detection failures, and canonical command-discovery paths.

## [0.12.0] - 2026-10-12

### Added

- **Native Windows distribution** — standalone x64/ARM64 executables, ZIP
  archives, and a checksum-verifying PowerShell installer. Windows binaries
  are unsigned; SmartScreen reputation warnings remain possible.
- **Platform validation** — Linux/macOS/Windows CI and six native release
  targets, with shared executable PTY smoke and offline installer regressions.
  Manual build runs provide test archives without publishing a release.

### Changed

- Upgrade Bun to 1.4.3, OpenTUI Core/Solid to 0.6.1, Biome to 2.5.15, and
  Bun types to 1.4.3. Migrate graph layout and asynchronous renderer teardown.
- Store Windows configuration in roaming AppData and provider caches in local
  AppData; preserve existing macOS/Linux storage locations.
- Make the full configuration path copyable through Menu mouse/keyboard actions.
- Include build/validation scripts in formatting, lint, and type checks.

### Fixed

- Apply minimum-terminal-size handling to startup repository/error screens and
  restore their normal content after resizing.
- Await terminal restoration before repository re-exec and preserve child exit
  status; handle absolute linked-worktree Git paths on Windows.
- Resolve standard Windows Snyk npm shims without shell interpolation, normalize
  PATH casing, and terminate scan process trees before worktree cleanup.
- Open browser URLs on Windows without interpreting URL text as shell commands.
- Stage Unix installer updates before replacing existing binaries so failed
  extraction, copying, or signing preserves the previous installation.
- Override transitive Seroval to 1.6.9 to address known critical/high advisories
  while retaining OpenTUI's required Solid version.

## [0.11.0] - 2026-10-10

### Added

- **Mouse navigation** — select whole graph commit blocks, scroll history without
  changing selection, and load the next page near the viewport bottom.
- **Clickable detail views** — tabs, copyable metadata, parent/child jumps,
  files, directories, stashes, and GitHub Actions, Jenkins, OpenShift, and Snyk
  detail actions work in both the sidebar and compact dialog.
- **Dialog and footer controls** — mouse support for menus, repository switching,
  theme preview/confirmation, help tabs, diff/blame, job logs, resource views,
  welcome/error actions, and confirm/cancel/back controls.
- **Olive Garden theme** — a metallic olive accent and muted, alternating graph
  and provider colors, selectable as `olive-garden`.

### Changed

- Arrange the command bar into two rows on wide graph panels and three rows on
  narrow panels. Show all enabled providers with quiet selected/hover styling.
- Click project badges to switch repositories; click hidden-project counts to
  browse the three-project window without switching. Keyboard Shift+Left/Right
  continues to switch repositories directly.
- Search and path editing now use a temporary inline input. Enter applies the
  draft; Escape cancels without clearing the applied filter. Mode badges show
  focus and abbreviated applied terms; typing no longer filters live.
- Change keyboard focus only on clicks or keyboard navigation, not hover or
  wheel scrolling. Dialogs block background mouse input. Action hints use
  text-only hover and do not select characters when clicked.
- Keep Git's theme color independent of the active provider accent. Existing
  themes retain their original Git colors.
- Move the Help version label to the footer and label parent/child activation
  as `jump` rather than `navigate`.
- Remove unused command-bar/debug helpers and redundant tests; add native
  renderer regressions for mouse, focus, resize, and input behavior.

### Fixed

- Consume expected repository-switch aborts without error logging and share one
  graph resize listener instead of subscribing once per row.
- Preserve the Info tab during mouse parent/child navigation; reanchor active
  ancestry only when clicking a commit outside the current chain.
- Prevent generic detail navigation from overwriting Jenkins, OpenShift, and
  Snyk navigation refs and contextual action hints.
- Preserve provider input drafts and restore the intended selection when saving
  entries rebuilds menu rows.
- Keep keyboard log scrolling aligned with wheel scrolling and make wrapping
  update existing log rows immediately.
- Return from job logs to the Details dialog in compact mode.

## [0.10.0] - 2026-09-01

### Added

- **GitHub Actions and Jenkins disk caches** — persist completed runs, jobs,
  stages, and logs per repository and commit, with configurable limits of 10,
  20, or 50 SHA snapshots.
- **Provider fetch size** — configure the graph commit window queried by GitHub
  Actions and Jenkins independently from cache retention.
- **OpenShift list pagination** — follow Kubernetes continuation tokens across
  inventory pages while preserving selectors and the final resource version
  used to start watches.

### Changed

- Load GitHub Actions jobs and Jenkins stages on run expansion instead of graph
  scrolling. GitHub GraphQL responses pre-populate jobs when supported and fall
  back to REST for older GitHub Enterprise schemas.
- Hydrate and persist provider caches in parallel. Scrolling outside the fetch
  window reads disk cache without starting remote requests.
- Reduce Jenkins traffic by reusing discovered job URLs, polling known running
  builds directly, and skipping jobs whose `lastBuild` number is unchanged.
- Stop repeated requests after GitHub Actions or Jenkins credentials expire and
  apply bounded backoff after provider errors.
- Isolate provider state by repository. Switching repositories aborts active
  provider work and clears badges, status, details, and refresh timestamps before
  loading the next repository.

### Fixed

- Failed GitHub Actions job and Jenkins stage requests no longer remain stuck
  loading. Details show a muted `Unavailable` row; technical errors remain in
  the Debug dialog, cancellation stays silent, and Reload retries failed runs.
- Provider views no longer treat Snyk, Jenkins, or OpenShift as working-tree file
  tabs on the synthetic uncommitted-changes node. The view now explains that
  provider data is unavailable until changes are committed.
- OpenShift keeps successfully fetched pages when a later page fails and reports
  partial inventory for repeated continuation tokens or safety limits of 100
  pages and 50,000 items per list.
- Jenkins reports when multibranch discovery exceeds 25 enabled, valid, unique
  branch jobs. Partial badges and runs remain visible, while truncated discovery
  is not recorded as an authoritative cache refresh.
- Improve GitHub terminal-run detection and Jenkins `lastBuild` typing.

## [0.9.0] - 2026-08-31

### Added

- **OpenShift build cache** — keep terminal Builds and their logs per commit
  (`10` / `20` / `50` SHAs) under `~/.cache/codepulse/openshift/`.
- **OpenShift fetch size** — match the nearest graph commits (`10` / `20` /
  `50`, same scale as Jenkins).
- **OpenShift Auto refresh** — poll Builds and ImageStreamTags while the
  OpenShift view is focused (`off` / `2m` / `5m` / `10m`, default `2m`).
- **OpenShift live watch** — list then watch Deployments, DeploymentConfigs,
  and Pods in configured namespaces. `live` only while a watch is connected.
  403 watch shows `OpenShift watch denied. Resource data might be stale. Reload to refresh.`
- **OpenShift logs** — follow running Build and Pod logs (`?follow=true`, last
  1000 lines). Title shows `log ended` when the stream closes. Terminal Build
  logs persist; `c` cycles log / JSON.
- Expired OpenShift tokens (401) stop further lists. Banner: `OpenShift token
  expired. Live data unavailable.` Last Live/Cache data stays visible; Reload
  is disabled. Cached Build JSON and logs still open.
- **OpenShift labels** — read `dev/commit-sha` from labels first, then
  annotations. Query Builds and Deployments with `labelSelector`; list Pods
  via the Deployment selector. Fall back to a full list and digest matching
  when nothing is labeled.
- **OpenShift Live / Cache columns** — graph splits resources: Cache =
  terminal Builds; Live = workloads, ImageStreamTags, and running Builds.
  Details append `(cached)` to terminal Build names. Running chips use the
  info color.
- OpenShift reads ImageStreamTag commit SHAs from `tag.annotations`
  (`oc annotate istag`). Terminal Build JSON is cached with the snapshot;
  other kinds still load JSON on demand.

### Changed

- Git Auto refresh / Auto fetch no longer refresh OpenShift.
- Snyk branch-tip auto-scan runs only while the Snyk view is focused.
- `c` cycles view mode in Diff, CI log, and OpenShift resource dialogs.

### Fixed

- Clear OpenShift Deploy/Pod chips when a SHA leaves live inventory.
- Drop overwritten ImageStreamTags from older commits; terminal Builds stay.
- Expired OpenShift tokens hid cached Builds and details.
- Live inventory no longer overwrites cached Builds when OpenShift prunes
  history; merge by Build id, evict only at the SHA cache limit.

## [0.8.0] - 2026-08-24

### Added

- **Snyk provider** — run Snyk Open Source scans for exact commits in detached
  Git worktrees and display cached vulnerability snapshots in the graph.
- **Snyk graph and details** — show severity counts, scan time, CVEs, dependency
  type, installed versions, and available remediation for each finding.
- **Automatic branch-tip scans** — scan configured local branch tips when no
  cached result exists for their exact commit.
- **Snyk scan cache** — retain normalized commit results with configurable
  limits of 10, 20, or 50 entries per repository.

### Fixed

- Preserve successful project findings from partial multi-project scans and
  visibly report failed project counts without presenting partial zero results
  as clean scans.
- Keep the graph and detail cursor in view during fast keyboard repeat.
- Show short Git, GitHub, Jenkins, and OpenShift banners; keep request dumps in
  the debug log.
- Count unique Snyk IDs in the graph and details; keep duplicate dependency
  paths in finding metadata.
- Map git fetch connection timeouts to a short banner.

## [0.7.0] - 2026-08-21

### Changed

- Distribute Codepulse as standalone macOS and Linux executables through GitHub
  Releases. Bun, Node.js, and npm are no longer required at runtime.
- Replace npm publishing with native arm64/x64 release builds for macOS and
  glibc Linux.
- Add a checksum-verifying installer that installs the `codepulse` command to a
  configurable directory on `PATH`.

### Fixed

- Embed OpenTUI native libraries, parser worker, tree-sitter WASM, and query
  assets in each executable and smoke-test them on their target platform.
- Re-execute the standalone binary correctly when switching repositories.

## [0.6.4] - 2026-08-21

### Fixed

- Run `@opentui/solid/preload` from `dist/cli.js` before loading the bundle.
  Bun.build had moved that import to the end of `dist/index.js`, so a global
  install (no repo `bunfig.toml`) called `render()` without the plugin.

## [0.6.3] - 2026-08-21

### Fixed

- Remove a duplicate `#!/usr/bin/env bun` in the published `dist/index.js`
  (Bun already preserves the source shebang; the extra banner was a syntax error).

## [0.6.2] - 2026-08-21

### Fixed

- Publish a Bun-built `dist/` instead of raw TSX. OpenTUI 0.5.6 skips Solid
  JSX transform for files under `node_modules`, so a global install still
  resolved `react/jsx-dev-runtime` even with `tsconfig.json` in the tarball.

## [0.6.1] - 2026-08-21

### Fixed

- Include `tsconfig.json` and `bunfig.toml` in the npm package so a global
  `bun` install uses Solid/OpenTUI JSX instead of looking for React.

## [0.6.0] - 2026-08-21

### Added

- **OpenShift provider** — match annotated Builds and ImageStreamTags, immutable
  image digests, Pods, and owner-resolved workloads to commits; inspect cached
  resource API objects as formatted JSON.
- **OpenShift graph columns** — show resource totals and conservative aggregate
  status for each matching commit.
- **Jenkins multibranch discovery** — configured job URLs are auto-detected;
  multibranch pipelines load up to 25 enabled branch jobs.

### Changed

- Provider detail tabs and status handling now support source, CI, and runtime
  providers consistently.
- Remote providers are disabled by default for new repository configurations.
- Updated OpenTUI, SolidJS, Biome, Bun types, and TypeScript dependencies.

### Fixed

- Partial OpenShift API failures preserve successful data and report failed
  requests through provider status and debug events.
- OpenShift workload matching uses immutable image digests to avoid stale tag
  associations and UID owner chains to resolve Deployments and
  DeploymentConfigs.
- OpenShift health mapping distinguishes progressing, failed, completed, and
  unknown resource states; terminating Pods are excluded.
- OpenShift configuration changes cancel stale requests and reload current
  cluster data.
- Jenkins commit matching supports SCM revision actions and refreshes cached
  commit data correctly.
- Aborted provider requests no longer appear as request failures.
- Jenkins job URLs must be HTTPS without embedded credentials.
- GitHub Actions fetches extra check-suite and job pages instead of truncating.
- Background CI fetches queue new graph commits instead of dropping them when a
  request is already in flight.
- Cancelled Jenkins job/build batches stop starting further HTTP calls.

## [0.5.0] - 2026-05-08

### Added

- **Grouped project switching** — repos can define `group` and `appName` metadata
  and switch related projects with `shift + ←/→`.
- **Warm repo session cache** — in-process project switches preserve graph data,
  cursor, scroll position, branch state, provider view, and graph badges when
  returning to a repo.
- **Grouped project selector** — `:switch` shows repos by group, includes the
  current repo in context, supports scrolling, and disambiguates duplicate repo
  names with right-aligned path details.
- **Debug dialog** — `:debug` shows recent git commands, provider HTTP requests,
  statuses, durations, and redacted errors.
- **Repo label editing** — Repository menu exposes editable `Group` and `App name`
  fields with config-load hardening for oversized values.

### Changed

- Command row now shows provider, mode, compact project badges, and right-aligned
  branch badges instead of noisy repo path/version text.
- Help dialog title now includes the app version.
- `shift + ←/→` no longer cycles modes; mode entry is explicit via `:`, `/`, `a`,
  and `p`.
- Project switching no longer wraps at group ends, matching visible carousel
  affordances.
- Providers menu shows `Last refresh` as a muted info row rather than overloading
  section headers.
- OpenCode Original theme colors were refreshed for stronger badge/readability
  contrast.

### Fixed

- Jenkins job URL copy no longer includes a leading bullet marker.
- Jenkins builds attach to the built head SHA instead of every commit in the
  `changeSet`, avoiding misleading badges on included-but-not-built commits.
- Project switcher navigation no longer jumps between visual groups because rows
  now use one linear row model.
- Group strip/project badge refreshes immediately after label edits.

### Refactored

- Replaced re-exec based project switches with in-process active-repo state.
- Converted data/detail/path loaders to active repo accessors with stale-result
  guards.
- Removed unused group strip component after integrating project badges into the
  command row.

## [0.4.0] - 2026-05-06

### Added

- **Jenkins provider** — configure Jenkins jobs from the Providers menu and
  switch to Jenkins from the graph view with `tab`.
- **Jenkins graph badges** — recent Jenkins builds are matched to visible commits
  by exact Git SHA from `changeSets`, with guarded fallback handling for
  multi-SCM builds.
- **Jenkins detail tab** — selected commits show matching Jenkins workflow runs
  in the shared provider detail tree.
- **Lazy Jenkins stage loading** — expanding a Jenkins run loads real pipeline
  stages from `wfapi/describe` only when needed.
- **Jenkins build logs** — pressing Enter on the build row opens the shared job
  log dialog using Jenkins `consoleText` output.
- **Provider run opener** — `o` in the log dialog opens the GitHub Actions run or
  Jenkins build URL in the system browser.
- **Raw log view** — the log dialog now cycles `all → issues → errors → raw`,
  allowing unclassified output when tests intentionally print error text.
- **Per-provider freshness display** — Providers menu headers show the last
  successful refresh time for GitHub and Jenkins separately.
- **Jenkins configuration** — Providers menu supports username, token env var,
  fetch size per job (`10` / `20` / `50`), and editable job URLs.
- **Jenkins tests** — API tests cover URL normalization, label derivation, SHA
  extraction, graph badge aggregation, auth headers, and SSO redirect detection.

### Changed

- GitHub Actions and Jenkins detail tabs now share a single provider run tree
  component for consistent navigation, status icons, durations, and placeholders.
- GitHub Actions and Jenkins logs now share one log dialog with provider-neutral
  run/job navigation and parsing.
- Log readability improved: normal log lines use foreground text, Jenkins
  timestamps are stripped, and Jenkins pipeline stage markers are highlighted.
- Provider labels are harmonized as `Git`, `GitHub`, and `Jenkins` in visible UI
  while internal provider IDs remain lowercase.
- Jenkins run rows hide duplicate run duration; the build row shows exact
  `wfapi` duration and stage rows show stage durations.
- Provider refreshes now refresh the active provider as well as repository data.
- Completed Jenkins jobs and logs are cached for the session; running Jenkins
  runs remain refreshable.
- GitHub and Jenkins HTTP fetches now share timeout/retry helpers.
- OpenTUI dependencies updated from `0.2.2` to `0.2.3`.

### Fixed

- Jenkins authentication failures now detect SSO redirects and HTML login pages
  instead of silently showing empty results.
- Jenkins tab availability now stays visible in Jenkins provider mode, including
  loading and empty states.
- Detail cursor clamping no longer blocks Jenkins tab navigation.
- Jenkins shallow graph preload includes `changeSets` / `changeSet` data for more
  reliable SHA matching.
- Ambiguous multi-SCM Jenkins builds no longer attach the same run to multiple
  commits.
- Jenkins `wfapi` timing now drives build/stage durations, avoiding mismatched
  build vs stage time after expansion.
- Failed or empty log loads are cached in the dialog to avoid repeated fetch
  loops.
- Type-check issues in provider menu config and Jenkins fetch mocks were fixed.

### Refactored

- Extracted shared provider run tree UI used by GitHub Actions and Jenkins.
- Extracted shared provider status and HTTP retry/timeout utilities.
- Removed unused provider foundation interfaces and unused GitHub log fetch prop
  plumbing.
- Kept Jenkins auth tokens as environment variable references only; raw tokens
  are never stored in config.

## [0.3.0] - 2026-05-03

### Added

- **GitHub Actions provider** — browse workflow runs, jobs, and logs from
  selected commits
- **Providers configuration** — menu + help dialog now document setup, token
  environment var, and enterprise trust flow
- **Provider mode switching** —  `tab` cycles git and provider views with
  contextual setup guidance when unavailable
- **GitHub graph columns** — graph view can show CI status and last run
  details for commits
- **GitHub detail tree** — run/job layout, inline jobs, log dialog, loading
  states, and keyboard navigation for CI detail views
- **Provider status lane** — non-fatal integration errors now show above
  command bar
- **`:clear` command** — dismisses current status message

### Changed

- Remote CI fetch stays manual by default; local repo refresh remains separate
- GitHub host trust is per-repo and remembers only current enterprise host
- Startup repo switching now reuses canonical git root paths
- Dialog layout and error surfaces unified across repo selector, dialogs, and startup
- CLI help and branch-push CI now include explicit TypeScript checks

### Removed

- Startup CLI flags beyond positional repo path, `--help`, and `--version`
- `gh auth` token fallback for GitHub authentication; provider now uses configured
  environment variable
- Automatic remote fetch on startup; remote fetching is manual by default
- Explicit "Save to config" action; settings now persist automatically

### Fixed

- Cross-branch and selected-commit CI loading now resolves data for
  detached, or older SHA values more reliably
- GitHub request handling now covers timeouts, transient retries, and clearer
  rate-limit messaging
- GitHub job log retries no longer loop forever on empty/failing responses
- Missing jobs and failed job fetches now surface distinct errors instead of
  empty-state confusion
- Background CI errors no longer block normal navigation
- Provider view, setup, and refresh flows avoid stale loading races and preserve
  graph scroll better
- Diff/blame and dialog workflows surface load failures more consistently
- `:help` now lists `:clear` for status dismissal

### Refactored

- Provider status moved to typed helpers with shared API result shapes and SHA
  selection helpers
- Repo selector and dialog UIs now reuse shared message-box and indexed scroll helpers

## [0.2.0] - 2026-04-15

### Added

- **Command bar** — `:` opens command mode; supports `:quit`, `:menu`, `:help`,
  `:theme`, `:fetch`, `:reload`, `:search`, `:path`, `:ancestry`, `:repo`
- **Ancestry highlighting** — `a` or `:ancestry` highlights the first-parent
  chain through the selected commit with dimming of non-ancestor rows
- **Path filter** — `:path <path>` highlights commits that touched files
  matching the given path, dimming the rest
- **Unified highlighting** — search, ancestry, and path are mutually exclusive
  modes; `↑/↓` skip dimmed rows when any is active
- **Diff line wrapping** — `w` toggles line wrap in the diff dialog
- **Mode cycling** — `shift + ←/→` cycles through idle → command →
  search → path → ancestry
- **Setup screen** — first-launch welcome screen with logo banner shown when a
  repo has no config entry yet
- **Project selector** — switch between repos from the menu or at startup;
  shown when launched from a non-git directory
- **`:repo` command** — opens the menu dialog pre-focused on the Repository tab
- **Proximity preload** — lazy-loads next page when highlight navigation
  approaches the boundary

### Changed

- Help dialog rewritten as 3-tab layout (General / Diff / Commands)
- Keybinds extracted to shared `keybinds.ts` module, reused in help dialog and
  CLI `--help`
- Badge component unified — replaces old `detail-badge.tsx` with a single
  `Badge` component
- `ctrl + t` theme shortcut removed; use `:theme` command instead
- Footer hints are now context-aware

### Fixed

- Shell injection in `project-selector.tsx` — replaced `execSync` shell substring
  with `spawnSync` array args
- Renderer freeze when toggling command bar input mount/unmount
- Dialog rendering bugs — command bar execute order and TDZ in diff dialog
- Ancestry highlighting edge cases — junction replacement, fan-out vertical,
  intermediate row brightening
- Stale `ctrl + t` hotkey label in menu dialog (displayed but non-functional)

### Refactored

- Extracted pure utilities with new tests: `keyboard-nav-utils.ts`,
  `command-bar-utils.ts`, `data-loader-utils.ts`
- Extracted `useDetailCursor` hook from `detail.tsx`
- Extracted `useAncestry`, `usePathFilter` hooks and `DetailDialog` from `app.tsx`
- Extracted per-mode keyboard handlers from `useKeyboardNavigation`:
  `handle-command-bar-keys.ts`, `handle-detail-keys.ts`, `handle-graph-keys.ts`,
  `handle-cascade-close.ts`
- Extracted `DiffLineRow` component and `diff-utils` pure helpers with new tests
- Extracted `CommandBar`, `FileListView`, `LogoBanner` components
- Extracted ancestry highlight logic into testable pure functions (`graph-highlight.ts`)

## [0.1.0] - 2026-04-07

### Added

- **Config file support** — `~/.config/codepulse/config.json` with save/reset
  from the menu dialog and CLI override precedence
- **Regex search** — `/pattern/` syntax in the search input; invalid regex
  falls back to substring match
- **Lazy commit loading** — cursor-triggered pagination replaces the hard
  commit cap; page size configurable via menu
- **Adaptive compact mode** — detail panel switches to a dialog overlay on
  narrow terminals; too-small terminal guard prevents rendering artifacts
- **In-TUI error screen** — friendly startup error display with dual-tone
  logo, wrapped messages, and resolution hints
- **Upstream ahead/behind** — `↑N ↓M` shown inline in the branch section
  and menu dialog
- **Banner scroll** — long graph commit descriptions scroll horizontally when highlighted
- **Live debounced search** — results update as you type with cursor position
  preserved on filter clear

### Changed

- Menu label renamed from "Max commits" to "Page size"
- Dialogs harmonized to width 72 and H-8 height cap
- Version display moved to footer left section
- Process title set to `codepulse` on startup for consistent terminal tab names

### Fixed

- Detail dialog focus, padding, footer label, and left-arrow behavior
- Diff-blame dialog opens correctly from detail dialog in compact mode
- Continuous bottom border on tab bar
- Banner width accuracy across resize
- Compact footer label for "show details"
- Race condition in data loading with concurrent page fetches
- Stale ref labels after branch switches
- `dimChars` mutation on shared commit objects
- `rowRefs` array truncation on graph rebuild
- Silent wrong-file fallback in diff target resolution
- Unhandled promise rejection in stash state hook

### Refactored

- Split `graph.ts` into `graph-build.ts`, `graph-render.ts`, `graph-viewport.ts`
- Split `repo.ts` into `repo-git.ts`, `repo-diff.ts`, `repo-status.ts`
- Decomposed `buildGraph` main loop into `assignNodeColumn`,
  `buildBaseConnectors`, `buildFanOutRows`, `resolveParentLanes`,
  `buildRelationEntries`
- Extracted hooks: `useDataLoader`, `useDetailLoader`, `useClipboard`,
  `useFileTree`, `useStashState`, `useMenuItems`, `useBannerScroll`, `useT`
- Extracted components: `KeyHint`, `FileTreeEntry`, `StashEntry`,
  `TotalLinesChangedRow`, `DetailPanel`, `CopyableRow`
- Extracted utilities: `scrollElementIntoView`, `buildDiffTarget`,
  `isUncommittedHash`, `detail-cursor` helpers
- Extracted CLI parsing into `src/cli/` module
- Removed deprecated `computeViewportOffsets`
- Removed dead code: unused exports, stale signals, redundant destructures
- Eliminated cross-file duplication (~400 lines removed across clipboard,
  file-tree, scroll, theme access, and key-hint patterns)

## [0.0.2] - 2026-04-03

### Fixed

- Global installs now preload the Solid OpenTUI runtime plugin correctly at startup

### Changed

- CI workflows now use clearer step names and Node 24 consistently
- Updated README with vision section and roadmap overview

## [0.0.1] - 2026-04-02

### Added

- **Diff + blame dialog** — open a full-screen diff viewer for any file by
  pressing Enter on a file row; cycle through diff / blame / new-only views with
  `b` and `n`
- **Diff stats line** — shows file status badge, `+additions −deletions`,
  and a `truncated` indicator for very large diffs
- **Structured diff title bar** — width-aware path display with truncation,
  view mode label, and file navigation counter
- **Windowed diff rendering** — only visible lines + a small buffer are
  rendered, keeping the dialog fast on large diffs
- **PgUp/PgDn** half-page scroll in the diff dialog
- **Diff truncation** — diffs exceeding 5000 lines are capped; a `truncated`
  flag is shown in the stats line
- **Alternating hunk background tints** for visual separation between hunks
- **File navigation in diff dialog** — `[`/`]` moves between files while
  keeping the dialog open; detail panel cursor stays in sync
- **Copyable detail fields** — hash, author, date, subject etc. can be copied
  with Enter; shows a `✓ copied` badge
- **Tab bar** in the detail panel — Files / Stashes / Details tabs for
  committed commits; Staged / Unstaged / Untracked for the uncommitted node
- **File tree** — modified files shown as a collapsible tree with directory
  grouping and path compaction
- **Stash entries** in the git graph with expandable file trees
- **Uncommitted changes node** at the top of the graph showing staged and unstaged changes
- **Branch perspective** — pressing Enter on a branch ref filters the graph to
  that branch's history
- **Fetch UI** — `f` triggers `git fetch`; last-fetch timestamp shown in the
  Menu dialog
- **Menu dialog** (`m`) — Repository tab with copyable origin/path, fetch
  action, and preferences
- **Help dialog** (`?`) — comprehensive keybindings reference including all
  diff dialog keys
- **Theme dialog** (`t`) — live preview of 11 color themes: Catppuccin Mocha
  (default), Dracula, Nord, Gruvbox Dark, Solarized Dark, Tokyo Night, One Dark,
  and more
- **Context-aware footer hints** — footer updates based on focused panel and
  active dialog
- **`--branch`** CLI flag to start in a specific branch perspective
- **`--no-all`** CLI flag to show only the current branch (equivalent to
  omitting `--all` from `git log`)
- **`--theme`** CLI flag to set the color theme from the command line
- **GitHub Actions CI** — runs Biome check and tests on every push/PR to `main`

### Changed

- Renamed from **gittree** to **codepulse**
- Scoped npm package to `@andreduejon/codepulse`
- Simplified keybindings — removed Vim aliases, `tab`, and `ctrl` combos; `m`
  opens menu, `q` cascades close/back/quit
- Detail panel now defaults to Files tab; auto-switches away from empty tabs
- Diff hunk separators unified to single-row horizontal rules with `·` separators
- Gutter columns sized to actual max line number width (not a fixed minimum)
- Author names normalized to NFC before truncation to avoid display artifacts
- `git log` field separator changed from `|` to ASCII RS (`\x1e`) to avoid conflicts

### Fixed

- Blame reactivity and human-readable hunk header rendering
- Cursor reset on tab switch and child/parent jump navigation
- Content-aware dialog height — shrinks to fit short diffs, caps at 90% of
  terminal height
- Horizontal rule spanning full width including the blame column
- Hunk header alignment with line numbers and content
- Cross-platform clipboard support
- Git argument sanitization to prevent injection
