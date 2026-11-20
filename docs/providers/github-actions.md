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
- Auto refresh (`off`, `2m`, `5m`, `10m`): re-query running workflows and the
  newest commits (Fetch size), so a workflow that starts later on a commit
  shows, while the GitHub view or the Dashboard is shown. Default `2m`. Git
  Auto refresh stays git-only.

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
A run deleted on GitHub stays in the local cache. Running runs and the newest
commits are refreshed while the provider view or the Dashboard is shown. Fetch size is the GraphQL window only.
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
log: its title gives the job's time (`GitHub · CI #812 · test · 5m 17s`)
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

## Pull requests

GitHub's view marks each commit an open pull request's branch points at with a chip
after its refs, in GitHub's colour: `PR #123`, muted for a draft. Only the branch's
tip gets one; a commit with two open pull requests (one branch into `main` and into
`release/1.x`) gets two.

Such a commit has a **Pull requests** tab after **Actions**, labelled with how many
(`Pull requests (2)`), as Stashes is; other commits don't show it. It lists each
pull request with its title, its branch and the one it would merge into, its author,
`draft` for a draft, and when it was last updated. `o` opens it on GitHub; Reload
commit reads the runs and the pull requests again.

Enter opens a pull request on the files it changed, as a tree like **Files**, each with
its status and `+`/`-` lines: what its branch changed since it left the target branch
(Git's merge base of the two), as GitHub's **Files changed** shows it, not what the
target did since. Git reads them, so both branches' commits must be fetched: the target
as GitHub names it, else `origin/<target>`. When they aren't, the row says so and `f`
fetches them. Enter on a file opens the diff dialog on that change
(`3447db9..bf08113` in its title), and `←`/`→` move between the pull request's files.
Files open from the graph's details; the Dashboard's details list them only.

While the tab is open, the graph previews the selected pull request's merge (the one under
the cursor, on it or its files, else the first): a muted line from its branch's commit
to the one its target branch points at, with `◀` at the target, as the merge would join
them.

```
█◀──╮   3447db9  main  docs: rewrite the README
│   │
│ █─╯   6adc455  feature/payments-retry  wip(payments): retry policy types
```

When the target is below (it hasn't moved since the branch left it), the arrow is at the
bottom. The line runs in the first column right of both that no line uses between them,
so the graph's lanes don't move; only when every column is taken does the graph get one
more. Where it crosses a lane, the lane shows `┼` in its own colour. It shows when the graph has both commits loaded (the target as GitHub names it,
else `origin/<target>`); it goes when the tab closes.

The open pull requests are one request (`pulls?state=open`, up to 500) on the first
fetch, on each refresh and on a Reload. One that fails keeps the last list and is
only recorded in the Debug dialog.

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
without it a failed job simply shows no annotations. Pull requests need **Pull
requests: Read**; without it no commit shows a chip or the tab.
