# Provider cache

Codepulse caches provider snapshots and associated logs in one SQLite database.
Configuration and themes remain JSON. Git repository files are not changed by
cache management.

| Platform | Database |
|----------|----------|
| macOS / Linux | `~/.cache/codepulse/cache.sqlite` |
| Windows | `%LOCALAPPDATA%\codepulse\Cache\cache.sqlite` |

SQLite working files may appear beside the database. **Recent changes**
(`cache.sqlite-wal`) holds committed changes not yet copied into the main database.
**Shared access** (`cache.sqlite-shm`) coordinates readers and writers.
These files consume additional disk space but are not separate rows in the UI.
SQLite manages them. Do not delete them while Codepulse is running. Eviction
frees reusable database space but does not necessarily shrink the file.

## Global Cache screen

Open `:cache` from the repository view, or choose **Menu → Repository → Actions → Cache**.
The global screen uses the repository
switcher's centered logo and card layout. `General` shows one `Cache data` row
with the database path. Select it and press Enter, or click its path, to copy
the full path even when its display is clipped. The path also supports text selection.

App rows are clustered by configured repository group, like the switcher.
Groups sort by name with ungrouped repositories last. Apps inside each group
sort by oldest last access first. Each row uses its configured app name when
available.

Rows show app names on the left, with muted cache size and cleanup eligibility
right-aligned. Size is stored snapshot payloads and artifacts (including logs)
across all providers, in KB (1024 bytes), not physical SQLite file usage.
Dates use the graph's compact format. Future deadlines use absolute dates,
not relative ages. Counts, last-access ages, provider breakdowns, and details
panes are omitted.

Inspection and selection do not update cache access times. Provider requests,
background cache reads/writes, and scans pause while this screen is open.
Closing it returns to the previous repository view and resumes normal work.

| Key | Action |
|-----|--------|
| `↑` / `↓`, `j` / `k` | Select an app |
| `r` | Reset selected repository's inactivity timer, across all providers |
| `shift+r` | Reset all repository timers, with confirmation |
| `e` | Evict selected repository across all providers, with confirmation |
| `Enter` | Copy selected file path or confirm pending action |
| `Esc` | Cancel confirmation, otherwise return to repository view |
| `q` | Quit application |

Footer hints also support mouse clicks. Arrow navigation stays available without
footer hints. File rows cannot be reset or evicted. Eviction identifies the
selected repository and removes only its snapshots and artifacts, across all
providers. Other repositories are untouched. There is no evict-all action.
Timer resets delete nothing and do not change real access dates or
least-recently-used ordering. Successful resets update row dates without a
success banner. Errors remain visible.

Manual, count-limit, and inactivity eviction remove snapshots and their artifacts
transactionally. Subsequent refreshes, or another running Codepulse instance,
may refill the cache. Eviction is not secure erasure from disk. Configuration,
themes, and Git files remain untouched.

## Retention

Cache limits are `10`, `20`, `50`, `100`, `200`, or `500` snapshots per provider
and repository. Default is `20`. Runs, jobs, findings, and logs do not count as
separate snapshots. Raising retention does not increase fetch depth or API requests.

At startup, Codepulse removes repositories whose latest cache access or manual
timer reset, across all providers, is at least 90 days old. Snapshot deletion
cascades to associated artifacts. One recently accessed provider keeps that
repository's other provider caches eligible for retention.

`Cleanup eligible` is latest repository activity plus 90 days. It is not a
promise of deletion at that instant. Cleanup runs at startup. A screen left open
past the deadline may show `Due now`. Count-limit or manual eviction can remove
snapshots sooner.

Timer resets set eligibility to 90 days from now, without modifying actual
last-access dates. `r` applies to the whole selected repository, not only the
selected provider. `shift+r` applies to all cached repositories.

Repository identity uses the existing hash of its canonical folder path.
Symlink aliases share a cache. Moving or renaming a repository starts a cold
cache under a new identity. The abandoned identity is subject to inactivity
cleanup.

## Upgrading to v0.13.0

The upgrade starts with a cold provider cache. Old JSON snapshots and text-log
files are not migrated or deleted, and are not included in the SQLite screen or
automatic cleanup. Provider data is fetched or scanned again through normal
provider actions; legacy cached data is not available offline in the new cache.
Repository files, provider configuration, and custom themes are unchanged.

Known development schema v1 databases are rebuilt cold as schema v2. Unknown or
corrupt databases are preserved, with diagnostics available in `:debug`.
