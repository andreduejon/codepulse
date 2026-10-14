# GitHub Actions provider

GitHub Actions shows workflow runs for commits in the graph. Expand a run to
inspect jobs, then open a job to browse its log.

See [common provider behavior](README.md) for shared refresh, cache, and
diagnostic conventions.

## Configuration

Configure the provider per repository from `:providers`:

- Enable the provider.
- Set the environment variable containing a personal access token. Default:
  `GITHUB_TOKEN`.
- Allow the detected host when using GitHub Enterprise.
- Cache limit (`10`, `20`, `50`, `100`, `200`, `500`): maximum commit snapshots kept on disk.
- Fetch size (`10`, `20`, `50`): how many graph commits are queried for
  workflow runs.
- Auto refresh (`off`, `2m`, `5m`, `10m`): re-query running workflow SHAs
  while the GitHub view is focused. Default `2m`. Git Auto refresh stays
  git-only.

GitHub.com is supported automatically. GitHub Enterprise repositories require
the detected host to be explicitly trusted. Credentials remain in environment
variables and are not written to config.

## Matching and refresh

Workflow runs are matched to commit SHAs. Completed runs, jobs, and steps are
stored in `~/.cache/codepulse/cache.sqlite` under provider `github-actions`.
Job lists come from GraphQL when the host schema includes `WorkflowRun.jobs`.
Hosts without that field still load runs and fetch jobs on expand via REST.
One informational Debug event records this fallback instead of repeated schema
errors. Job logs are fetched on first open. Completed-run logs are cached as
`log` artifacts in the same database when their commit snapshot exists.
Without that parent snapshot, the fetched log still appears but is not persisted
and does not recreate the snapshot. The cache limit caps commit snapshots.
Deleting or evicting a snapshot cascades to its logs. Snapshot updates preserve
existing logs.
A run deleted on GitHub stays in the local cache. Running runs are refreshed
while the provider view is active. Fetch size is the GraphQL window only.
commits loaded on demand stay in memory. Scrolling outside that window reads
disk cache only — it does not query GitHub. Reload / Auto refresh re-query the
window without dropping other SHAs. Details include **Reload commit** (Enter
hint: `reload`) to query the selected SHA.

## Errors and limits

Expired credentials stop live requests until a valid token is available.
Rate-limit, timeout, job, and log failures preserve other usable provider data
where possible. Short status messages appear in the main view. Request details
are available in the Debug dialog.

GitHub requests use bounded pagination. Extremely large workflow histories or
runs may be incomplete. The Debug dialog records request failures and related
diagnostics.

## Permissions

Token needs repository metadata and Actions read access for private repos.
