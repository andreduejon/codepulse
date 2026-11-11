# Demo

`bun run demo` starts codepulse on throwaway repositories with made-up GitHub Actions, Jenkins, OpenShift and Snyk
data. It needs a source checkout, Bun and Git, and no accounts. Nothing reaches the network, and your own config,
cache and Git settings stay untouched: everything the demo writes goes into a fresh folder in the system temp
directory, which is removed when it ends.

It is for development: to look at a screen without a real server, and to check a UI change headless.

```sh
bun run demo                                   # interactive, in your terminal
bun run demo --play 'j j enter tab shot'       # headless: play keys, print the screen as text
bun run demo --help                            # options and steps
```

## Options

| Option | Mode | What it does |
|--------|------|--------------|
| `--play "STEPS"` | headless | Plays the steps, prints the screens, exits. Without it the demo is interactive. |
| `--size WxH` | headless | Screen size, default `160x45`. The interactive demo uses your terminal's size. |
| `--github MODE` | both | `default`, `empty`, `off`, or `error:401`, `error:rate-limit`, `error:offline`, `error:timeout`, `error:no-token` |
| `--jenkins MODE` | both | `default`, `empty`, `off`, or `error:401`, `error:offline`, `error:timeout`, `error:no-token` |
| `--openshift MODE` | both | `default`, `empty`, `off`, or `error:401`, `error:offline`, `error:timeout`, `error:partial`, `error:watch-denied`, `error:no-token` |
| `--snyk MODE` | both | `default`, `empty`, `off`, or `error:no-token`, `error:partial`, `error:no-cli` |
| `--setup` | both | Starts on a repository the config does not know yet: the welcome screen. |
| `--live [SECONDS]` | interactive | The world moves on every SECONDS (default 60). See [Phases](#phases). |
| `--latency MS` | both | Fake server delay in milliseconds, default 150. Raise it to look at loading states. |
| `--theme NAME` | both | Starts with that theme. |
| `--keep` | both | Keeps the demo folder (repositories, config, cache, `requests.log`) and prints where it is. |

Provider modes:

- `default`: the normal world.
- `empty`: connected, but nothing to show (no runs, no builds, no resources, no findings).
- `off`: turned off in the config.
- `error:KIND`: every request fails that way. `timeout` takes as long as the app waits (20 seconds).
  `partial` fails one part (shop-prod's lists, or Snyk's `admin` project); `watch-denied` lets OpenShift list but
  not watch.

Seconds are whole numbers (`--live 30`); `--latency` and the `sleep:` step take milliseconds.

## Headless (`--play`)

The app runs in OpenTUI's test renderer, the one the tests use, and boots the way `codepulse` does. Each step runs
when the screen has settled after the one before. `shot` prints the screen under a header:

```
=== shot 2: jenkins (160x45) ===
```

When a step fails, the play prints `=== failed at step N (STEP): why (WxH) ===` and the screen at that moment, and
exits with `1`. A wrong option or step exits with `2` before anything starts.

Steps are separated by spaces or new lines. Quote text with spaces: `wait:"full log"`.

| Step | What it does |
|------|--------------|
| `j` `/` `G` `tab` `enter` `esc` `space` `backspace` | A key. Names: `up` `down` `left` `right` `home` `end` `pageup` `pagedown` `delete` `f1`…`f12`. |
| `shift+tab` `ctrl+d` `alt+x` | A key with modifiers. |
| `down*3` | A key three times. |
| `type:TEXT` | Types text, for search, filters and settings fields. |
| `wait:TEXT` / `gone:TEXT` | Waits until the text shows, or is gone. Fails after 30 seconds. |
| `expect:TEXT` / `absent:TEXT` | Fails unless the text is on screen, or unless it is not. |
| `shot` / `shot:NAME` | Prints the screen. Without any shot, the play prints the last screen. |
| `size:WxH` | Resizes, for minimum widths and compact layouts. |
| `advance` | Moves the world to its next phase. |
| `click:TEXT` / `click:TEXT#2` / `click:X,Y` | Clicks the middle of the first (or second) place the text shows, or a cell. |
| `hover:TEXT` | Moves the mouse over the text. |
| `scroll:down*5@TEXT` | Scrolls the wheel over the text, or over the middle of the screen without `@`. |
| `sleep:MS` | Waits a fixed time, for things on a timer. |

The same play prints the same screens every run: the commits and the app's clock start at a fixed moment
(2 March 2026, 09:30 UTC), dates are shown in UTC, and long text in the selected row stays still instead of
scrolling sideways. So comparing before and after a change shows only what the change did:

```sh
bun run demo --play "$(cat play.txt)" > before.txt
# change the code
bun run demo --play "$(cat play.txt)" > after.txt
diff before.txt after.txt
```

## The world

Two repositories in the group `demo`: **shop**, which the demo opens, and **shop-web** (`shift →`), with GitHub and
Snyk only. shop's `origin` is `git@github.com:demo/shop.git`, served from a local copy, so `f` fetches offline.

The newest commits carry the provider data:

| Commit | Shows |
|--------|-------|
| `export request metrics` (dev) | GitHub run running, Deploy preview queued. Jenkins build running. shop-dev rolling out, one pod still pulling. |
| `add a health endpoint` | GitHub run cancelled. Jenkins build aborted. |
| `docs: rewrite the README …` (main, tag, stash) | GitHub green, deploy run with a long name. Jenkins parallel stages. Live in shop-prod, events forbidden there. |
| `retry policy types` (feature branch) | GitHub lint failure with a long annotation. Jenkins unstable. Snyk scan fails. |
| `retry failed payments …` | GitHub re-run (attempt 2) with annotations, a skipped job. Jenkins failed tests. Crash loop, OOM and eviction in shop-test. Snyk: a new package, an override that can go. |
| `round discounts to cents` | GitHub nightly run timed out. Jenkins build without a test report. |

Snyk scans the branch tips by itself; other commits wait for **Scan commit**. Its findings and dependency tree come
from each commit's `package.json` files (the root project and `admin/`). Jenkins lists more branch jobs than it
reads, so its view notes the limit.

### The graph

shop has 86 commits over twelve days, built to show every shape the graph has to draw
(`scripts/demo/repositories.ts`):

- Eleven local-only branches (`lane/01` … `lane/11`) out of one commit, crossed by two long-lived lanes: 14 lanes at
  the widest, more than the 12 the graph shows, so it scrolls sideways (`◀` and `▶` mark the hidden side).
- Merges of every kind: pull request merges, `main` merged into feature branches, stacked branches
  (`feature/checkout-ui` merged into `feature/checkout-api`, then into `main`), a criss-cross (`feature/inventory`
  and `feature/pricing` merge each other), and an octopus merge of four `deps/*` branches.
- Three roots: `main`, the `gh-pages` branch, and legacy deploy scripts merged in as an unrelated history.
- A release branch with tags (`v1.4.0` … `v1.4.2`), a hotfix merged into it and into `main`, and a backport.
- A change and its revert, six branches out of one commit merged back in a different order, and open branches:
  local-only (`feature/dark-mode`, `experiment/graph-layout`), remote-only (`origin/feature/metrics-dashboard`),
  and behind its remote (`release/1.x`).

`scripts/demo/graph.test.ts` draws it with the app's renderer and checks that every line meets another line or a
commit.

### Phases

`--live` and the `advance` step move the world on, twice:

1. The running work finishes: the GitHub run on `export request metrics` passes and its deploy starts, the Jenkins
   build fails two tests, and the shop-dev rollout fails to pull its image.
2. A new commit lands on `origin/dev`, with a queued GitHub run and a running Jenkins build.

Only the servers change; the app finds out the way it would for real. OpenShift shows the failed rollout at once,
through its watch. GitHub and Jenkins show their results on their next refresh (`r`, `f`, or auto refresh). Git
shows the new commit on the next fetch (`f`; with `--live`, auto fetch runs every 30 seconds).

## How it works

Everything lives in `scripts/demo/`:

| File | Role |
|------|------|
| `run.ts` | The launcher: reads the options, builds the folder, starts the app, removes the folder. |
| `world.ts` | The folder: both repositories and their remotes, the config, the fake tools, and the app's environment (home, config, cache and temp all inside the folder, on every OS). |
| `repositories.ts`, `history.ts` | The repositories' histories, and the importer that builds them in one `git fast-import`. |
| `scenario.ts` | The made-up GitHub, Jenkins and OpenShift data, per phase. |
| `packages.ts` | The npm world: each commit's `package.json`, the dependency graphs, the findings, the registry. |
| `fake-fetch.ts` | Preloaded into the app: answers GitHub, Jenkins and OpenShift requests and logs them to `requests.log`. |
| `fake-cli.ts` | The `snyk`, `npm` and `pnpm` on the app's PATH (compiled into one executable on Windows, cached in `node_modules/.cache/codepulse-demo`). |
| `fake-ssh.ts` | Lets `git fetch` reach the local remotes. |
| `play.ts`, `player.tsx`, `steps.ts`, `clock.ts` | The headless mode: steps, the test renderer, the fixed clock. |

To show a new state, add it to `scenario.ts` (or `packages.ts`) on a commit that has room for it, and list it in
the table above.
