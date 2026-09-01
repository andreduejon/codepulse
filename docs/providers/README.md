# Provider behavior

Provider integrations are configured per repository from `:providers` and are
disabled by default. Credentials are read from configured environment variables
and are never written to Codepulse configuration.

## Refresh and fetch

Provider **Auto refresh** controls provider requests while that provider view is
focused. Git **Auto refresh** and **Auto fetch** apply only to repository data.

**Fetch size** is the graph commit window considered by a provider. It is not a
cache-retention setting and does not limit resources returned by provider APIs.
Scrolling outside the fetched window does not start a remote request, but
available disk-cached data may still appear.

Reload requests the selected commit or current provider inventory again.
Provider-specific guides describe any additional live updates or automatic work.

## Cache

**Cache limit** is the number of commit snapshots retained on disk, not the
number of runs, builds, jobs, resources, or findings. Supported values are 10,
20, and 50; the default is 20.

Cached data can remain visible after its remote object is deleted. Each provider
guide describes what is persisted and when live data replaces cached data.

## Errors and diagnostics

Short status messages appear in the main view. Technical request details are
kept in the Debug dialog (`:debug`) with credentials redacted. When one part of
a provider request fails, Codepulse keeps usable partial data where possible.
