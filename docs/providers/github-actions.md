# GitHub Actions provider

GitHub Actions shows workflow runs for commits in the graph. Expand a run to
inspect jobs, then open a job to browse its log.

## Configuration

Configure the provider per repository from `:providers`:

- Enable the provider.
- Set the environment variable containing a personal access token. Default:
  `GITHUB_TOKEN`.
- Allow the detected host when using GitHub Enterprise.

Credentials remain in environment variables and are not written to config.

## Matching and refresh

Workflow runs are matched to commit SHAs. Completed run jobs are cached for the
current session; running runs are refreshed while the provider view is active.

## Permissions

Token needs repository metadata and Actions read access for private repos.
