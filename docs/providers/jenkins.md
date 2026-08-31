# Jenkins provider

Jenkins shows builds matched to graph commits, pipeline stages, and console
logs.

## Configuration

Configure the provider per repository from `:providers`:

- Enable the provider.
- Set Jenkins username for Basic authentication.
- Set the environment variable containing an API token. Default:
  `JENKINS_TOKEN`.
- Add full job or multibranch pipeline URLs.
- Cache count (`10`, `20`, `50`): maximum commit files kept on disk.
- Fetch size (`10`, `20`, `50`): how many graph commits are queried, and how
  many recent builds to inspect per job.
- Auto refresh (`off`, `2m`, `5m`, `10m`): re-query running builds while the
  Jenkins view is focused. Default `2m`. Git Auto refresh stays git-only.

Credentials remain in environment variables and are not written to config.

## Multibranch pipelines

Job URLs are detected through the Jenkins API. Multibranch pipeline URLs load
enabled branch jobs automatically. Discovery is capped at 25 branch jobs across
all configured multibranch parents.

## Matching and refresh

Builds are matched through immutable SCM revision SHAs. Completed runs, jobs,
and stages are stored under
`~/.cache/codepulse/jenkins/<repository-hash>/<commit-sha>.json`. Console logs
are fetched on first open and kept next to that file under `logs/`. Cache
count (`10` / `20` / `50`) caps commit files; logs leave with the SHA.
A build deleted in Jenkins stays in the local cache.
Auto refresh only re-queries SHAs that still show as running.
Scrolling outside fetch size reads disk cache only — it does not query Jenkins.
Details include **Reload commit** (Enter hint: `reload`) to query the selected
SHA.
