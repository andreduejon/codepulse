# OpenShift provider

OpenShift matches cluster resources to graph commits using the configured commit
label or annotation. It shows conservative health summaries for configured
namespaces and lets you inspect resource JSON or supported logs.

See [common provider behavior](README.md) for shared refresh, cache, and
diagnostic conventions.

## Graph status

The graph has two columns, named as the detail tabs:

- **Resources** — what the cluster has of the commit now: Deployments,
  DeploymentConfigs, Pods, ImageStreamTags and Builds (running or finished, as long as
  OpenShift lists them), as fail, running, neutral (cancelled, unknown) and pass counts.
  A muted count follows: Builds only the cache has (see Cached).
- **Events** — the warnings the cluster still reports about the commit, in the warning
  colour, the Normal events it lists now in green, then a muted count of the ones shown
  from the cache (see Warnings).

A muted count is muted text on grey; the neutral chip has bright text. Empty columns
show `·······`. In details, a finished Build the cluster no longer lists (pruned, or
older than the fetch size) shows from the cache with `(cached)` after its name. Builds and
ImageStreamTags poll while the OpenShift view or the Dashboard is shown. Deployments,
DeploymentConfigs, and Pods are listed and watched until you leave both.

### Live in namespace

Next to a commit's refs, a badge in the OpenShift colour names each namespace
that runs that commit now: its Deployments or DeploymentConfigs carry the
commit's SHA label. The badge only names the namespace: whether it is ready,
rolling out or failing shows in the Resources counts and the details. A
Deployment scaled to 0 runs nothing, so it marks no namespace; details still
list it with `0 replicas`. Badges
come from the live list of the whole namespace, so a commit below the fetch size
is marked too, with no extra requests. A namespace that runs a commit the graph
does not show (older than the loaded history, or filtered out) is named at the
end of the graph: `Not in the graph: prod runs 4c5d6e7`.

When the row is narrow, the checked-out branch keeps its badge first, then the
namespaces; the rest fold into `+N`.

## Configuration

Configure the provider per repository from `:providers`:

- Enable the provider.
- Set an HTTPS OpenShift API server URL.
- Optionally set the web console URL (**Console**, for example
  `https://console-openshift-console.apps.example.com`). With it, `o` opens the selected namespace or
  resource in the console, from the detail panel and from the resource dialog. Without it, `o` is not offered
  for OpenShift.
- Set the environment variable containing an API token. Default:
  `OPENSHIFT_TOKEN`. Prefer a long-lived service-account token over
  `oc whoami -t` (env is fixed until Codepulse restarts).
- Cache limit (`10`, `20`, `50`, `100`, `200`, `500`): maximum commit snapshots kept on disk.
- Fetch size (`10`, `20`, `50`): how many graph commits are candidates. Only
  those commits that also have a Build or ImageStreamTag seed are matched.
- Auto refresh (`off`, `2m`, `5m`, `10m`): poll Builds and ImageStreamTags
  while the OpenShift view or the Dashboard is shown. They are also listed
  once when the repository loads. `off` skips that poll. Reload still
  lists seeds. Live Deploy/DC/Pod freshness is watch, not this timer.
- Set the commit SHA label/annotation key. Default: `dev/commit-sha`. Labels first, then
  annotations, on Builds, Deployments, and ImageStreamTags.
- Add one or more namespaces.

Stamp `dev/commit-sha` (or your annotation key) as a **label** on Builds and
Deployments when the API allows it. ImageStreamTags accept annotations only.
Credentials stay in environment variables and are not written to config.

Fetch size limits graph commit candidates, not OpenShift API list pages or the
number of resources returned.
Resource lists follow Kubernetes `metadata.continue` tokens until complete and
retain the final `metadata.resourceVersion` for watches. Each list is bounded to
100 pages and 50,000 items, and repeated continuation tokens stop that resource
request. Resources fetched before a later-page failure remain visible. Codepulse
reports partial inventory in a notice under the **Resources** tab (**Inventory partially
failed**) and records namespace,
resource kind, and technical details in the Debug dialog.

## Cache

Terminal Builds (`Complete`, `Failed`, `Error`, `Cancelled`) and their API objects
are stored in `~/.cache/codepulse/cache.sqlite` under provider `openshift`.
Terminal Build logs are `log` artifacts in the same database, linked to the
commit snapshot and keyed by namespace and Build name. Log caching is best
effort. Without a parent snapshot, the fetched log still appears but is not
persisted and does not recreate the snapshot.

Each snapshot is one commit SHA. Limits `10`, `20`, `50`, `100`, `200`, and `500`
count snapshots, not Builds. Live terminal Builds merge into the existing
snapshot by Build id, preserving its snapshot ID and logs. OpenShift history
prune does not drop Builds already cached. Every cached commit shows its Builds,
also below the fetch size, and keeps them through refreshes. Least-recently-accessed
snapshots evict at the limit, cascading to their log artifacts. Pods, workloads, and
ImageStreamTags are not written to disk; the warnings about them are (see Warnings).

An expired token (401) stops automatic requests: polls, watches, and fetches on
view switches or selection. The banner reads **Token expired** · OpenShift with
`Live data unavailable. Reload to retry.` below. Graph and details keep the last
Live and Cache data, and cached Build JSON and logs remain viewable. **Reload
commit**, `:reload`, or `f` retries explicitly, like GitHub Actions and Jenkins.

## Matching

A commit SHA is taken from `metadata.labels` first, then annotations on
metadata, ImageStreamTag `tag`, and the nested image (same key, default
`dev/commit-sha`). `oc annotate istag` writes `tag.annotations`.

While the OpenShift view or the Dashboard is shown, Builds and ImageStreamTags
poll on Auto refresh. Builds for the graph window are requested with
`labelSelector=dev/commit-sha in (…)`. If that returns nothing, the full Build
list is scanned by annotation (old objects). ImageStreamTags are always listed
in full; they cannot be labeled.

Live inventory lists Deployments, DeploymentConfigs, and Pods in the configured
namespaces, then watches those kinds (`watch=true` from the list
`resourceVersion`). A 410 Gone or dropped stream lists again. Leave the
OpenShift view and the Dashboard to stop watches. Matching still prefers labels, then
annotations, then digest / owner-chain:

```text
Pod → ReplicaSet → Deployment
Pod → ReplicationController → DeploymentConfig
```

Terminating Pods are excluded. ImageStreamTags are a match seed only and are
not written to disk. An overwritten IST annotation moves the tag to the new
commit; it does not stay on the old SHA. Terminal Builds remain on the commit
that produced them.

## Logs

- Terminal Build logs load from the shared database when present, otherwise from
  the Build log API, then cache if the parent snapshot exists. They are not streamed.
  A Build only the cache has (OpenShift pruned it) gives its saved log or, when nobody
  opened it while it existed, says *No saved log*; the cluster is not asked.
- Running Build logs and Pod logs use `?follow=true`. History then tail. Last
  1000 lines. Open at the bottom; stay pinned only if you are already at the
  bottom. When the stream closes the title shows `log ended`. Press `r` to
  restart. They are not stored.
- `c` cycles the view: log (Builds and Pods), JSON, and events (Pods, Builds,
  Deployments, DeploymentConfigs). Terminal Build JSON uses the cached object when
  present; otherwise JSON is a live snapshot. Leave the log view or close the
  dialog to abort follow.
- **Events** starts with what the resource's status says is wrong
  (`STATUS  REASON  MESSAGE`, in red: it is why the resource is `✗`): what a Pod's containers wait on, how their last run
  ended and how often they restarted, its conditions that are False, a workload's failing conditions, a
  Build's failure. The status comes with the object, so it stays after OpenShift
  deletes the events and where events are forbidden. Below it, the events newest
  first: `LAST SEEN  TYPE  REASON  COUNT  MESSAGE`, warnings in the warning colour.
  Kubernetes events are only `Normal` or `Warning`, so red comes only from the status.
  Events are read when the dialog opens (the warnings only the cache has follow them,
  see Warnings); the title counts the
  warnings (`2 warnings`). OpenShift keeps events for 3 hours by default (plain
  Kubernetes for 1), so an older resource says *No recent events*. Without
  permission to list events the view says so.
- `r` refreshes what is shown: the log (restarting a follow), the object, or the
  events. Workloads without logs open in JSON and refresh the same way.
- `/` searches the log, JSON or events (`n` / `N` next and previous hit), like CI logs.
  A failed request shows its reason; an empty log says *No log output.*

Live updates keep the namespaces you collapsed and the cursor on the same row.
When a live list fails, the last workloads stay visible and the banner (every
request failed) or a tab notice (some failed) says so.

## Status

Resources show the same status symbols as CI runs; graph chips use the same
colours. A legend below the tree explains them: `✓ ok  ● in progress  ✗ failing  ○ cancelled`.

- `✓` pass: successful Build, Ready Pod, or fully converged workload.
- `●` running: active Build, Pending/not-ready Pod, or incomplete workload rollout.
- `✗` fail: failed Build, fatal container state, replica failure, or failed
  workload progression.
- `○` cancelled: a Build stopped before it ended (with the start policy `SerialLatestOnly`,
  a queued build is cancelled when a newer one starts). Neutral, like a cancelled CI run:
  a grey chip in the graph, not a failure. A Build cancelled before it checked out its
  source carries no commit, so there is no commit to show it under.
- `?` unknown: insufficient or indeterminate status (a grey chip in the graph).

Aggregate precedence is fail, running, unknown (and cancelled), then pass.

A row shown only from codepulse's cache says `(cached)` and is muted; its status mark
keeps its colour. See Cached below.

A failing row shows only its name and `✗`, to keep the tree quiet. Why it fails
is in the resource dialog's events view: what its containers wait on, exit codes,
restarts, failing conditions and their messages.

## Warnings

The events in the configured namespaces are read with every build list fetch (Reload and
auto refresh). codepulse takes them as OpenShift reports them: a warning is never turned
into a failure, and `✗` comes only from a resource's own status. Events of type `Warning`
are kept with their commit (below); `Normal` ones (Scheduled, Pulled, BuildStarted) show
in the **Events** tab only while the cluster lists them, and are never saved.

- A warning belongs to the commit whose resource it is about: the same name, and the same
  uid, so a resource recreated under its old name is another one. One about a ReplicaSet
  or ReplicationController goes to the commit whose pods it runs, else to its
  Deployment's or DeploymentConfig's commit. A Deployment keeps its name across commits,
  and during a rollout the previous commit still holds it through its old pods: its
  warning goes only to the commit it runs (the one it names), and only when it happened
  after that commit's rollout began (the later of its newest ReplicaSet's creation and
  the commit's oldest pod there); an earlier one was the previous commit's and is left
  out. A warning about a resource no commit has is not kept.
- Warnings are saved in the commit's snapshot (see Cache), so they outlast the cluster's
  copy and are evicted with the snapshot by the cache limit.
- The graph's **Events** column counts a commit's events, not how often each happened:
  yellow for the warnings the cluster still reports, green for the Normal events it lists
  now, muted for those shown from the cache (a warning OpenShift deleted, or an event about
  a resource that is gone).
- In **Resources**, a resource OpenShift warned about shows `!` before its status mark.
- The **Events** tab starts with **Reload commit** and the count (`total events`), then a
  tree: namespace, each reason newest first (the warnings' in the warning colour, then the
  Normal events'), then the resources it happened to, newest first, each with when. An event is always about one object, so ten
  pods crash-looping are ten BackOff events under one BackOff row. A resource with two
  events of one reason (another message) is one row. Enter (or a click) on a resource
  opens its dialog on the events view, where the whole message is; `o` opens it in the
  web console. A namespace whose events the token may not list is named in a notice
  under the tab.
- The resource dialog's events view ends with a section **Cached (no longer in the
  cluster)**: the warnings kept about the resource that the cluster's events no longer
  have, newest first, in the same columns. When the events cannot load, the section is
  **Saved warnings** and lists every kept one: nothing says whether the cluster still
  has them.

## Cached

Something shows from codepulse's cache when the cluster's latest list no longer has its
uid: a Build OpenShift pruned, a pod that was replaced, an event OpenShift deleted (it
keeps events for about 3 hours after they last happen). It says `(cached)` and its row is
muted, in **Resources** and **Events** alike.

- A list that failed changes nothing. Right after start, events read from the cache are
  cached until their namespace is listed; whether a pod is still there is known once the
  live list has loaded.
- In **Events**, a resource is cached when the cluster no longer has it, or no longer has
  any of its events of that reason. While a problem keeps happening Kubernetes updates the
  same event (its count and last time), so it stays one; when it starts again after
  OpenShift deleted it, the new event is a new one beside the cached one. A pod recreated
  under its old name is two rows: the one running, then the cached one.
- Enter on a cached pod opens its dialog on its events only: there is no log, object or
  console page for it any more. A pruned Build opens in full: its log and object are
  cached. A ReplicaSet or ReplicationController also opens on its events only, since no
  commit holds one.
- In the graph, what only the cache has is the muted count at the end of each column.
- A finished Build OpenShift prunes while codepulse runs turns `(cached)` with the next build
  list; one of a commit below the fetch size is never asked about, so it is always shown
  from the cache.

## Required read permissions

Configured token needs `list` access for:

- `builds.build.openshift.io`
- `imagestreamtags.image.openshift.io`
- `deployments.apps`
- `replicasets.apps`
- `deploymentconfigs.apps.openshift.io`
- `replicationcontrollers`
- `pods`
- `events` (for the **Events** tab, and the resource dialog's events view and warning count)

Live freshness also needs `watch` on Deployments, DeploymentConfigs, and Pods
in each configured namespace. OpenShift/`kubernetes` `view` already has
`get`/`list`/`watch`. A custom ServiceAccount needs the extra `watch` verb on
those three kinds; Builds and ImageStreamTags stay `list` only. Without watch,
the last list stays until Reload. A notice under the **Resources** tab reads **Watch
denied** with `Resource data might be stale. Reload to refresh.` below. `live` only appears
while a watch socket is connected.

Build and Pod log views need `get` on those log subresources (`?follow=true`
uses the same get). Example Role:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: codepulse
rules:
  - apiGroups: ["build.openshift.io"]
    resources: ["builds", "builds/log"]
    verbs: ["get", "list"]
  - apiGroups: ["image.openshift.io"]
    resources: ["imagestreamtags"]
    verbs: ["get", "list"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps.openshift.io"]
    resources: ["deploymentconfigs"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods", "pods/log", "replicationcontrollers", "events"]
    verbs: ["get", "list", "watch"]
```

Partial permission failures preserve successful inventory and show a notice under
the **Resources** tab. When every request fails, the banner over the graph shows the error.
Routes, Services, Helm releases, and console links are outside the provider's
current scope.
