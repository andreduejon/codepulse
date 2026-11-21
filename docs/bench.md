# Bench

`bun run bench` measures how fast codepulse is and how much memory it takes, on large repositories it builds for
the run: one of 20,000 commits over 60 days (a pull request merged every few commits, long-lived lanes, tags, 40
branches local and on `origin`) and three of 3,000 in one group. It runs in a home of its own, so your config and
cache stay untouched, and removes everything when it ends. A run takes about half a minute.

```sh
bun run bench              # every scenario
bun run bench graph log    # only those
bun run bench --compare    # each number beside the baseline's, with the ratio
bun run bench --save       # keep this run as the baseline (scripts/bench/baseline.json)
```

| Scenario | Measures |
|----------|----------|
| `functions` | `git log` and the graph build for 200, 2,000 and 20,000 commits, the Git reads of a refresh, the Dashboard's read, SQLite writes and reads |
| `graph` | the graph view alone: mounting 200 to 2,000 rows and the memory they take, a refresh that brings one new commit, cursor moves, memory kept after 20 refreshes |
| `app` | the whole app: startup until the graph shows, keys, pages of older commits, memory after five pages |
| `dashboard` | opening the Dashboard on 1,000 events, keys there, the memory it adds |
| `switching` | switching between the three apps of a group, the memory twelve switches keep |
| `log` | a CI log of 20,000 lines: opening it, its memory, `G`, wrapping it (`w`) and its memory, the memory kept after ten more opens |

Memory is read after a full garbage collection: the process (with OpenTUI's native buffers) and the JavaScript heap.
The heap is the heap's allocated blocks, so it also counts free space between objects: a change that only moves code
around can raise it by 10 to 15% while the live objects stay the same. Before calling that a leak, compare
`Bun.generateHeapSnapshot()` totals or `heapStats().objectCount` on both sides. The process memory right after
startup varies between runs of the same code by about a quarter.

The numbers depend on the machine, so compare runs on the same one; the baseline names the machine it was made on.
Two runs of unchanged code stay within about 25% of each other. Save a new baseline only for a change meant to
change the numbers, and say so in the commit.
