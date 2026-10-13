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

All providers share one SQLite database at `~/.cache/codepulse/cache.sqlite`
on macOS/Linux or `%LOCALAPPDATA%\codepulse\Cache\cache.sqlite` on Windows.
Snapshots are isolated by provider, canonical repository path hash, and commit SHA.
Each snapshot has a generated integer ID. Cached logs are `log` artifacts in the
same database, linked to their parent snapshot. Updating a snapshot preserves
its ID and logs. Successful cached log reads and writes update the parent's
last-access time.
Configuration remains JSON at `%APPDATA%\codepulse\config.json` on Windows.
Missing environment variables fall back to the user's `AppData\Local` and
`AppData\Roaming` folders.

**Cache limit** is the number of commit snapshots retained on disk, not the
number of runs, builds, jobs, resources, or findings. Supported values are 10,
20, 50, 100, 200, and 500. The default is 20. Fetch size remains 10, 20, or 50.

Least-recently-accessed snapshots leave when the limit is exceeded, along with
associated artifacts through a foreign-key cascade. Foreign keys are enabled on
every app database connection. Log writes and eviction are transactional. Log
caching is best effort and requires an existing parent snapshot. If that snapshot
is absent or has been evicted, the live log still appears but is not persisted,
and no replacement snapshot is created.

Repositories with no cache access or timer reset for 90 days are cleaned up at
startup, across all providers. The global `:cache` screen shows total cached data
sizes and cleanup dates per app, resets inactivity timers, and evicts only a
selected repository across providers after confirmation.
Inspection does not update access times. See the [cache guide](../cache.md).

Schema version 2 uses the same database path. Known development version 1 databases are reset
transactionally without importing their contents. Unknown or corrupt databases
are left untouched. Legacy JSON snapshots and log files are not migrated or
deleted. Moving a repository changes its cache identity. SQLite reuses space
freed by eviction, but its file does not necessarily shrink. Database failures
are recorded in Debug and do not discard usable live provider data.

Cached data can remain visible after its remote object is deleted. Each provider
guide describes what is persisted and when live data replaces cached data.

## Errors and diagnostics

Short status messages appear in the main view. Technical request details are
kept in the Debug dialog (`:debug`) with credentials redacted. When one part of
a provider request fails, Codepulse keeps usable partial data where possible.
