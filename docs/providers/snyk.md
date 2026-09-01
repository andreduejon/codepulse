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
- Scans run sequentially in detached temporary Git worktrees. Current checkout remains unchanged.

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

Zero counts remain visible in muted color. Unscanned commits show placeholders. Details list findings by severity, dependency, installed version, and fixed version when available.

For multi-project repositories, Codepulse keeps successful project results when
another project fails and labels the result with the failed project count.

Snyk Open Source only scans supported manifests and lockfiles. Unsupported ecosystems or lockfiles produce no usable project result. Add a lockfile Snyk supports, then scan again.

## Cache

Normalized results are stored under:

```text
~/.cache/codepulse/snyk/<repository-hash>/<commit-sha>.json
```

Cache limit can be `10`, `20`, or `50`; default is `20`. It limits commit scan
snapshots per repository. Least-recently-accessed snapshots are removed when the
limit is exceeded. Cached results do not expire by age. Tokens and raw Snyk
output are not stored.

## Security

Scans use detached temporary worktrees, so the active checkout remains
unchanged. This is not a security sandbox. Snyk may invoke package managers or
build tooling that execute repository-controlled code with current user
permissions and environment access. Enable automatic scans only for repositories
whose dependency files, build configuration, and scripts you trust.
