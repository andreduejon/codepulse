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
- Cache limit (`10`, `20`, `50`): maximum commit snapshots kept on disk.
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
enabled, buildable Workflow jobs automatically. Discovery includes the first 25
valid, unique branch jobs in Jenkins API order. This is one global limit across
all configured multibranch parents, not 25 jobs per parent.

If more jobs are available, existing runs and badges from included jobs remain
visible and Codepulse shows `Jenkins data incomplete. Branch-job limit reached.`
Remaining branch jobs are not queried. The Debug dialog records the affected
parent URL and limit. Truncated discovery is not stored as an authoritative
cache refresh.

## Matching and refresh

Builds are matched through immutable SCM revision SHAs. Completed runs, jobs,
and stages are stored under
`~/.cache/codepulse/jenkins/<repository-hash>/<commit-sha>.json`. Console logs
are fetched on first open and kept next to that file under `logs/`. The cache
limit caps commit snapshots; associated logs leave with the SHA.
A build deleted in Jenkins stays in the local cache.
Auto refresh only re-queries SHAs that still show as running.
Scrolling outside fetch size reads disk cache only — it does not query Jenkins.
Details include **Reload commit** (Enter hint: `reload`) to query the selected
SHA.

Fetch size controls both the graph commit window and recent builds inspected per
job. It is independent from cache retention.
