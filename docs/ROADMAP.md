# Roadmap

Planned scope, not shipped functionality. Release scope may change after
feasibility checks. Current Windows support remains unclaimed until validated.

## v0.12.0 — Windows support and runtime migration

### Bun and OpenTUI migration

- Standardize local development and all CI/release builds on Bun 1.4.3.
- Upgrade the OpenTUI Core/Solid pair together; migrate removed layout APIs.
- Await terminal restoration (`renderer.closed`) before repository re-exec.
- Migrate renderer test cleanup to awaited disposal.
- Review peer dependency warnings and retain compatible Solid/compiler versions.
- Validate tests, types, lint, embedded assets, and compiled executables on all
  six targets. Recheck scrolling, resizing, input, highlighting, and clean exit
  interactively; source tests alone are not release proof.

Custom themes and HEX/override dialog improvements are deferred to v0.13.0.

### Native Windows support

Target Windows 11 x64 and ARM64 with Windows Terminal. Validate each architecture
before claiming support; legacy consoles are not promised. Ship standalone
`codepulse.exe` binaries, without requiring Bun or Node.js. A user-provided
Windows machine is available for interactive testing; confirm its native
architecture and arrange native coverage for the other architecture.

Implementation order:

1. **Prove runtime feasibility first.** On native Windows x64 and ARM64, test the pinned Bun
   and OpenTUI versions with a minimal compiled TUI. Verify rendering,
   keyboard/mouse input, resize, exit/terminal restoration, and embedded
   Tree-sitter assets. Published Windows native packages are not runtime proof.
   Stop and resolve upstream blockers if this fails; WSL is not native support.
2. **Add the Windows build target.** Update `scripts/build.ts` target validation,
   executable naming, and platform-specific permission handling. Verify native
   asset bundling and compiled executable startup on a Windows runner.
3. **Audit platform behavior.** Test Git discovery, subprocess execution,
   paths containing spaces, repository switching, clipboard, browser opening,
   and Snyk process-tree cancellation. Remove POSIX-only assumptions and adapt
   shell-dependent tests.
4. **Choose platform-aware paths.** Update configuration and provider cache
   defaults consistently. Keep user configuration separate from disposable
   cache data; document Windows locations.
5. **Add Windows CI and release coverage.** Add native build/tests and a
   Windows-compatible executable smoke test; the current Bash/Expect smoke
   cannot be treated as Windows validation. Verify the full app manually in
   Windows Terminal as well as in automation.
6. **Ship installation and update support.** Publish a Windows archive and
   PowerShell installer with checksum verification, a per-user installation
   directory, and clear PATH instructions. Verify installation and upgrade
   from published assets.
7. **Document the support contract.** Update README/Help with installation,
   Git prerequisites, supported Windows/terminal versions, and known limits.

Acceptance: graph, details, dialogs, logs, keyboard, mouse, resize, clean exit,
installation, and update work on the stated native Windows baseline.

Out of scope: shortcuts, Explorer context menus, graphical installers.

## v0.13.0 — Custom themes and SQLite cache

### Custom themes and theme dialog improvements

- Load user theme configuration alongside predefined themes.
- Show a Custom section in the theme dialog with the existing preview,
  confirm, and cancel behavior. Persist selection only on confirmation.
- Validate custom themes independently. Report invalid entries or malformed
  configuration in Debug without breaking predefined themes.
- Fall back to a predefined theme if the selected custom theme disappears.
- Add an optional color-details view for the previewed theme: field names,
  color swatches, and exact effective HEX values, including graph palette
  entries. Values should be selectable/copyable without an external color tool.
- For partial overrides, show which fields are inherited and which are
  overridden, with base and effective HEX values for changed fields.
- Make modified themes recognizable in the picker with a text/icon indicator,
  or list derived variants separately in Custom while preserving the original.
  Do not rely on color alone to communicate override status.
- Document the configuration format and examples in README; update Help.

Before implementation, decide the configuration filename and merge rules:
complete definitions or partial overrides of a predefined base. Recommended:
reserve predefined IDs and give custom themes distinct IDs. Decide whether
overrides produce a separate custom variant or modify a marked existing entry;
do not silently replace an unmarked predefined theme. A duplicate/export-as-
custom action is an optional follow-up, not required for loading variants.

### SQLite cache

Use Bun's built-in `bun:sqlite` for provider caching. Keep editable configuration
and custom themes in JSON. SQLite does not itself solve Windows path support.

### Schema-design phase

- Inventory existing provider snapshots, logs, keys, validation, and retention.
- Define indexed identity/timestamp columns with provider-specific JSON payloads
  where appropriate; decide whether large logs need separate storage/retention.
- Include repository, provider, server/configuration identity, and resource or
  commit identity in cache keys where relevant. Never store credentials in keys.
- Define schema versioning (`PRAGMA user_version`), transactions, concurrent
  application access, bounded retention, and cache failure recovery.
- Verify SQLite in standalone binaries across every supported release target.

Proposed database locations, to finalize during design:

| Platform | Location |
|----------|----------|
| Linux | `${XDG_CACHE_HOME:-~/.cache}/codepulse/cache.db` |
| macOS | `~/Library/Caches/codepulse/cache.db` |
| Windows | `%LOCALAPPDATA%\codepulse\Cache\cache.db` |

### Migration

- Import valid existing JSON cache entries transactionally; retain old files
  until migration succeeds.
- Skip invalid entries with diagnostics rather than failing app startup.
- Make migration safe to retry and test partial/interrupted migration.
- Preserve provider isolation and existing cache behavior during cutover.
- Deleting cache must not delete user configuration.

## v0.14.0 — Dependencies provider

Provider name: **Dependencies**; compact tab label: **Deps**.

Show a commit-scoped dependency tree: read project files from the selected
commit, not the current checkout. Leave the user's working tree untouched.

- Start with Maven and one explicitly chosen JavaScript lockfile format.
- Prefer committed dependency records where sufficient; otherwise offer
  tool-assisted resolution in an isolated temporary checkout.
- Maven resolution respects exclusions, scopes, profiles, and version conflicts.
- Show provenance: commit, source, resolver/version, profiles, scope, resolution
  time, and relevant platform context. Label a graph resolved today as such;
  do not claim it reproduces an earlier build exactly.
- Require explicit consent before executing project tooling. A temporary
  checkout protects working files but is not a security sandbox.
- Cache the graph using commit plus resolution context; keep credentials out
  of stored keys and diagnostics.
- Support tree expansion and inspection; show unresolved or unsupported inputs
  honestly rather than inventing a transitive tree from a manifest alone.

This describes project dependencies, not the contents of the actual deployable.
Runtime resolution and packaging can differ; SNAPSHOTs and dynamic versions
can change after a commit was built.

Out of scope: artifact inspection, deployment comparison, Nexus/Artifactory
integration, and upgrade recommendations.

## Unscheduled ideas

- Parameterized Jenkins triggers with queue/build tracking; an `esa-cicd` job
  to build a selected service commit for an existing stage. Separate cross-repo
  design and deployment authorization are required.
- Dependency upgrade recommendations and Nexus/Artifactory metadata enrichment.
- Published-artifact or SBOM comparison against project dependencies.
