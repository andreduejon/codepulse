# Jenkins provider

Jenkins shows builds matched to graph commits, pipeline stages, and console
logs.

See [common provider behavior](README.md) for shared refresh, cache, and
diagnostic conventions.

## Configuration

Configure the provider per repository from `:providers`:

- Enable the provider.
- Set Jenkins username for Basic authentication.
- Set the environment variable containing an API token. Default:
  `JENKINS_TOKEN`.
- Add HTTPS job or multibranch pipeline URLs without embedded credentials.
- Cache limit (`10`, `20`, `50`, `100`, `200`, `500`): maximum commit snapshots kept on disk.
- Fetch size (`10`, `20`, `50`): how many graph commits are queried, and how
  many recent builds to inspect per job.
- Auto refresh (`off`, `2m`, `5m`, `10m`): re-query running builds while the
  Jenkins view is focused. Default `2m`. Git Auto refresh stays git-only.

Credentials remain in environment variables and are not written to config.
Jenkins sends the username and token using Basic authentication. Missing
credentials, login redirects, and HTML login responses are reported as setup or
authentication errors instead of build failures.

## Multibranch pipelines

Job URLs are detected through the Jenkins API. Multibranch pipeline URLs load
enabled, buildable Workflow jobs automatically. Discovery includes 25 valid,
unique branch jobs: first the branches in the graph (local branches, and remote
ones without the remote's name), then the most recently built, then Jenkins API
order. This is one global limit across all configured multibranch parents, not 25
jobs per parent.

If more jobs are available, existing runs and badges from included jobs remain
visible and a notice under the Jenkins tab gives the counts:
`Jenkins reads 25 of 61 branch jobs: branches in the graph first.`
Remaining branch jobs are not queried. The Debug dialog records the affected
parent URL and limit. Truncated discovery is not stored as an authoritative
cache refresh.

## Matching and refresh

Builds are matched through immutable SCM revision SHAs. Completed runs, jobs,
and stages are stored in `~/.cache/codepulse/cache.sqlite` under provider `jenkins`.
Console logs are fetched on first open. Completed-build logs are cached as
`log` artifacts in the same database when their commit snapshot exists.
Without that parent snapshot, the fetched log still appears but is not persisted
and does not recreate the snapshot. The cache limit caps commit snapshots.
Deleting or evicting a snapshot cascades to its logs. Snapshot updates preserve
existing logs.
A build deleted in Jenkins stays in the local cache.
Auto refresh only re-queries SHAs that still show as running; Reload and Fetch
(`:reload`, `f`) re-query the whole graph window, so new builds on finished
commits appear. Scrolling outside fetch size reads disk cache only — it does not
query Jenkins. Details include **Reload commit** (Enter hint: `reload`) to query
the selected SHA; a failed reload shows its error in the banner.

Aborted builds show as cancelled (`○`, a grey chip in the graph) like aborted
stages, and not-built builds as skipped. Entering a commit's **Jenkins** tab opens
its first failed build. In the console log, `r` reloads it (a finished build's cached log does not change).

Stages are rows the cursor stops on. Enter on a stage opens only its part of the
console log (from `[Pipeline] { (Stage)` to the end of that block), and `←` / `→`
move to the previous and next stage. It is cut from the same console log, so it
needs no extra requests and works for cached builds. Enter on **Pipeline** still
opens the whole console; a stage the log does not mark shows the whole log too.

Fetch size controls both the graph commit window and recent builds inspected per
job. It is independent from cache retention.

## Tests

A finished build with a JUnit test report shows a **Tests** row beside its
Pipeline, with the counts after the name (`Tests  3 failed · 1,204 passed · 12
skipped`) and each failed test under it (`PaymentServiceTest › refundsTwice`, up
to 50). The report is read once the build has finished, together with its stages,
and cached with the build. Enter on a failed test opens its error and stack trace
in the log viewer (search, wrap), and `←` / `→` move between the failed tests;
`o` opens the build's test report. A build without a report has no Tests row.
