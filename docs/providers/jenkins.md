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
- Choose how many recent builds to inspect per job: 10, 20, or 50.

Credentials remain in environment variables and are not written to config.

## Multibranch pipelines

Job URLs are detected through the Jenkins API. Multibranch pipeline URLs load
enabled branch jobs automatically. Discovery is capped at 25 branch jobs across
all configured multibranch parents.

## Matching and refresh

Builds are matched through immutable SCM revision SHAs. Completed stages and
non-empty console logs are cached for the current session.
