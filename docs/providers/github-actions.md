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
hint: `reload`) to query the selected SHA; it also refreshes expanded jobs and steps
of runs that were still running.

Entering a commit's **Actions** tab opens its first failed run and puts the
cursor on its first failed job. Cancelled and skipped runs show as a grey chip in
the graph. In the job log, `r` reloads the log (newer output of a running job, or a retry
after a failure; a finished job's cached log does not change) and `o` opens the run in the browser.

Rows are as quiet as the OpenShift and Jenkins trees: names and marks, and the
run's age. A job that passed is one row; a failed or running job lists its steps,
so you see where it went wrong. A legend below the tree explains the marks:
`✓ passed  ● running  ✗ failed  – skipped  ○ cancelled`. Times are in the job
log: its title gives the job's time (`GitHub Actions · CI #812 · test · 5m 17s`)
and the log starts with its steps, each with its mark and time (a skipped step has
none). `←` / `→` move between the run's jobs (`← previous job · → next job`).

The log views `issues only` and `errors only` keep failed tests: `FAILED` at the
end of a line, an error or exception with its message, Bun's `(fail)`, Jest's `✕`,
Vitest's `×`, and `FAIL src/…`.

### Re-runs

After a re-run, the run row says which attempt its jobs are from (`CI #812  attempt 2`).
Its jobs are the latest attempt's; earlier attempts are the last rows of the run,
newest first (`▸ attempt 1` with its status), and expand to their jobs and logs.
`o` on an attempt opens that attempt's page. The jobs of every attempt come from
one REST request (`filter=all`); jobs that GraphQL listed carry no attempt, so the
first expand of such a run asks REST once and caches the answer. The graph chip
keeps showing the latest attempt.

### Annotations

A failed job lists its annotations after its steps, under **Annotations**:
failures (`✗`) and warnings (`!`) with their file and line, and the first line of
the message (`✗ src/auth.test.ts:42  Expected 200, received 401`). Notices are
left out. They are read once per failed job when its run is expanded (one request
per failed job) and cached with the job. Enter opens the job log with the message
searched, so the first hit is where it happened and `n` / `N` find repeats; `o`
opens the job page.

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
Annotations also need Checks read access (a fine-grained token's **Checks: Read**);
without it a failed job simply shows no annotations.
