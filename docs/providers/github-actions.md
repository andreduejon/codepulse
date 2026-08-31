# GitHub Actions provider

GitHub Actions shows workflow runs for commits in the graph. Expand a run to
inspect jobs, then open a job to browse its log.

## Configuration

Configure the provider per repository from `:providers`:

- Enable the provider.
- Set the environment variable containing a personal access token. Default:
  `GITHUB_TOKEN`.
- Allow the detected host when using GitHub Enterprise.
- Cache count (`10`, `20`, `50`): maximum commit files kept on disk.
- Fetch size (`10`, `20`, `50`): how many graph commits are queried for
  workflow runs.
- Auto refresh (`off`, `2m`, `5m`, `10m`): re-query running workflow SHAs
  while the GitHub view is focused. Default `2m`. Git Auto refresh stays
  git-only.

Credentials remain in environment variables and are not written to config.

## Matching and refresh

Workflow runs are matched to commit SHAs. Completed runs, jobs, and steps are
stored under `~/.cache/codepulse/github-actions/<repository-hash>/<commit-sha>.json`.
Job logs are fetched on first open and kept next to that file under `logs/`.
Cache count (`10` / `20` / `50`) caps commit files; logs leave with the SHA.
A run deleted on GitHub stays in the local cache. Running runs are refreshed
while the provider view is active.

## Permissions

Token needs repository metadata and Actions read access for private repos.
