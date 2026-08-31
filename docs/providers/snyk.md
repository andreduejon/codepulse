# Snyk

Codepulse can run Snyk Open Source scans for exact commits and display cached vulnerability snapshots in the graph.

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

## Display

Graph shows four severity counts for exact scanned commits:

```text
C0 H2 M0 L4
```

Zero counts remain visible in muted color. Unscanned commits show placeholders. Details list findings by severity, dependency, installed version, and fixed version when available.

For multi-project repositories, Codepulse keeps successful project results when another project fails and labels the result as a **partial scan** with the failed project count. Partial results may under-report vulnerabilities; fix the project error and scan again for a complete snapshot. A later partial scan does not replace a complete cached snapshot.

Snyk Open Source only scans supported manifests and lockfiles. Unsupported ecosystems or lockfiles produce no usable project result. Add a lockfile Snyk supports, then scan again.

## Cache

Normalized results are stored under:

```text
~/.cache/codepulse/snyk/<repository-hash>/<commit-sha>.json
```

Cache count can be `10`, `20`, or `50`; default is `20`. Oldest accessed result is removed after limit is exceeded. Tokens and raw Snyk output are not stored.

## Security

Snyk may invoke package managers or build tooling while resolving dependencies. Scanning untrusted repository content can execute repository-controlled code with current user permissions and environment access. Configure automatic branches only for trusted repositories.
