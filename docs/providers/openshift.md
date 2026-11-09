# OpenShift provider

OpenShift matches cluster resources to graph commits using the configured commit
label or annotation. It shows conservative health summaries for configured
namespaces and lets you inspect resource JSON or supported logs.

See [common provider behavior](README.md) for shared refresh, cache, and
diagnostic conventions.

## Graph status

The graph has two lanes:

- **Live** — Deployments, DeploymentConfigs, Pods, ImageStreamTags, and running
  Builds currently observed from OpenShift.
- **Cache** — terminal Builds persisted locally by commit.

Both lanes show fail, running, pass, and unknown counts. Empty lanes show
`·······`; details append `(cached)` to terminal Build names. Builds and
ImageStreamTags poll while the OpenShift view is focused. Deployments,
DeploymentConfigs, and Pods are listed and watched until you leave the view.

### Live in namespace

Next to a commit's refs, a badge in the OpenShift colour names each namespace
that runs that commit now: its Deployments or DeploymentConfigs carry the
commit's SHA label. `dev` is ready, `● test` is rolling out, `✗ prod` is
failing. During a rollout the new commit shows `●` until it is ready. Badges
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
  while the OpenShift view is focused. `off` skips that poll. Reload still
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
reports partial inventory in a notice under the OpenShift tab (**Inventory partially
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
ImageStreamTags are not written to disk.

An expired token (401) stops automatic requests: polls, watches, and fetches on
view switches or selection. The banner reads **Token expired** · OpenShift with
`Live data unavailable. Reload to retry.` below. Graph and details keep the last
Live and Cache data, and cached Build JSON and logs remain viewable. **Reload
commit**, `:reload`, or `f` retries explicitly, like GitHub Actions and Jenkins.

## Matching

A commit SHA is taken from `metadata.labels` first, then annotations on
metadata, ImageStreamTag `tag`, and the nested image (same key, default
`dev/commit-sha`). `oc annotate istag` writes `tag.annotations`.

While the OpenShift view is focused, Builds and ImageStreamTags poll on Auto
refresh. Builds for the graph window are requested with
`labelSelector=dev/commit-sha in (…)`. If that returns nothing, the full Build
list is scanned by annotation (old objects). ImageStreamTags are always listed
in full; they cannot be labeled.

Live inventory lists Deployments, DeploymentConfigs, and Pods in the configured
namespaces, then watches those kinds (`watch=true` from the list
`resourceVersion`). A 410 Gone or dropped stream lists again. Leave the
OpenShift view to stop watches. Matching still prefers labels, then
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
- Running Build logs and Pod logs use `?follow=true`. History then tail. Last
  1000 lines. Open at the bottom; stay pinned only if you are already at the
  bottom. When the stream closes the title shows `log ended`. Press `r` to
  restart. They are not stored.
- `c` cycles the view: log (Builds and Pods), JSON, and events (Pods, Builds,
  Deployments, DeploymentConfigs). Terminal Build JSON uses the cached object when
  present; otherwise JSON is a live snapshot. Leave the log view or close the
  dialog to abort follow.
- **Events** lists what OpenShift reported about the resource, newest first:
  `LAST SEEN  TYPE  REASON  COUNT  MESSAGE`, warnings in the warning colour. They
  are read when the view opens and are not stored. OpenShift keeps events for about
  an hour, so an older resource says *No recent events*. Without permission to list
  events the view says so.
- `r` refreshes what is shown: the log (restarting a follow), the object, or the
  events. Workloads without logs open in JSON and refresh the same way.
- `/` searches the log, JSON or events (`n` / `N` next and previous hit), like CI logs.
  A failed request shows its reason; an empty log says *No log output.*

Live updates keep the namespaces you collapsed and the cursor on the same row.
When a live list fails, the last workloads stay visible and the banner (every
request failed) or a tab notice (some failed) says so.

## Status

Resources show the same status symbols as CI runs; graph chips use the same
colours.

- `✓` pass: successful Build, Ready Pod, or fully converged workload.
- `●` running: active Build, Pending/not-ready Pod, or incomplete workload rollout.
- `✗` fail: failed Build, fatal container state, replica failure, or failed
  workload progression.

A failing row says why after its name, muted:

- Pods: the container's state, how it last ended, and restarts
  (`CrashLoopBackOff · exit 1 · 14 restarts`, `OOMKilled · exit 137`, `Evicted`).
- Deployments and DeploymentConfigs: ready replicas and the failing condition
  (`1/3 ready · ProgressDeadlineExceeded`).
- Builds: the build's reason (`DockerBuildFailed`), or `Cancelled` / `Error`.

When the panel is narrow the reason is cut first, so the name keeps its room; the
selected row scrolls to show all of it.
- `?` unknown: insufficient or indeterminate status (a grey chip in the graph).

Aggregate precedence is fail, running, unknown, then pass.

## Required read permissions

Configured token needs `list` access for:

- `builds.build.openshift.io`
- `imagestreamtags.image.openshift.io`
- `deployments.apps`
- `replicasets.apps`
- `deploymentconfigs.apps.openshift.io`
- `replicationcontrollers`
- `pods`
- `events` (only for the events view in the resource dialog)

Live freshness also needs `watch` on Deployments, DeploymentConfigs, and Pods
in each configured namespace. OpenShift/`kubernetes` `view` already has
`get`/`list`/`watch`. A custom ServiceAccount needs the extra `watch` verb on
those three kinds; Builds and ImageStreamTags stay `list` only. Without watch,
the last list stays until Reload. A notice under the OpenShift tab reads **Watch
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
    resources: ["pods", "pods/log", "replicationcontrollers"]
    verbs: ["get", "list", "watch"]
```

Partial permission failures preserve successful inventory and show a notice under
the OpenShift tab. When every request fails, the banner over the graph shows the error.
Routes, Services, Helm releases, and console links are outside the provider's
current scope.
