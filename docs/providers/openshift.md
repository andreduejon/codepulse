# OpenShift provider

OpenShift shows resources associated with graph commits and conservative health
status. The graph uses two 15-character columns: **Live** and **Cache**.
Both use fail (red) / running (info) / pass (green) count chips. Cache is terminal Builds
(persisted). Live is Deployments, Pods, ImageStreamTags, and running
Builds. Empty lane shows `·······`. Details mark each terminal Build
`(cached)` after its name. Builds and ImageStreamTags poll while the OpenShift view is focused, using the
provider **Auto refresh** cycle (`off`, `2m`, `5m`, `10m`; default `2m`).
Deployments, DeploymentConfigs, and Pods are listed then watched in the
configured namespaces until you leave the view. Git Auto refresh / Auto fetch
stay git-only. Select a Build or Pod and press Enter to view its log, or the
API object for other kinds. Terminal Build JSON is kept with the list and on
disk. Other kinds fetch JSON on open.

## Configuration

Configure the provider per repository from `:providers`:

- Enable the provider.
- Set an HTTPS OpenShift API server URL.
- Set the environment variable containing an API token. Default:
  `OPENSHIFT_TOKEN`. Prefer a long-lived service-account token over
  `oc whoami -t` (env is fixed until Codepulse restarts).
- Cache count (`10`, `20`, `50`): maximum commit files kept on disk.
- Fetch size (`10`, `20`, `50`): how many graph commits are candidates. Only
  those commits that also have a Build or ImageStreamTag seed are matched.
  Same 10 / 20 / 50 scale as Jenkins and GitHub Actions fetch size.
- Auto refresh (`off`, `2m`, `5m`, `10m`): poll Builds and ImageStreamTags
  while the OpenShift view is focused. `off` skips that poll. Reload still
  lists seeds. Live Deploy/DC/Pod freshness is watch, not this timer.
- Set the commit SHA key. Default: `dev/commit-sha`. Labels first, then
  annotations, on Builds, Deployments, and ImageStreamTags.
- Add one or more namespaces.

Stamp `dev/commit-sha` (or your annotation key) as a **label** on Builds and
Deployments when the API allows it. ImageStreamTags accept annotations only.
Credentials stay in environment variables and are not written to config.

## Cache

Terminal Builds (`Complete`, `Failed`, `Error`, `Cancelled`), their API objects,
and their logs are stored under:

```text
~/.cache/codepulse/openshift/<repository-hash>/<commit-sha>.json
~/.cache/codepulse/openshift/<repository-hash>/logs/<sha>_<namespace>_<build>.txt
```

Each file is one commit SHA. Limit `10` / `20` / `50` is SHA files, not Builds.
Live terminal Builds merge into the existing file by Build id. OpenShift
history prune does not drop Builds already cached. Oldest SHA files evict at
the limit. Pods, workloads, and ImageStreamTags are not written to disk.

An expired token (401) stops further requests. The banner reads `OpenShift
token expired. Live data unavailable.` Graph and details keep the last Live
and Cache data. Reload is disabled. Cached Build JSON and logs still open.

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

- Terminal Build logs load from disk when present, otherwise from the Build log
  API, then cache. They are not streamed.
- Running Build logs and Pod logs use `?follow=true`. History then tail. Last
  1000 lines. Open at the bottom; stay pinned only if you are already at the
  bottom. When the stream closes the title shows `log ended`. Press `r` to
  restart. They are not stored.
- `c` cycles view mode (log / JSON) for Builds and Pods. Terminal Build JSON
  uses the cached object when present; otherwise JSON is a live snapshot.
  Leave the log view or close the dialog to abort follow.

## Status

- `PASS`: successful Build, Ready Pod, or fully converged workload.
- `RUN`: active Build, Pending/not-ready Pod, or incomplete workload rollout.
- `FAIL`: failed Build, fatal container state, replica failure, or failed
  workload progression.
- `?`: insufficient or indeterminate status.

Aggregate precedence is `FAIL`, `RUN`, `?`, then `PASS`.

## Required read permissions

Configured token needs `list` access for:

- `builds.build.openshift.io`
- `imagestreamtags.image.openshift.io`
- `deployments.apps`
- `replicasets.apps`
- `deploymentconfigs.apps.openshift.io`
- `replicationcontrollers`
- `pods`

Live freshness also needs `watch` on Deployments, DeploymentConfigs, and Pods
in each configured namespace. OpenShift/`kubernetes` `view` already has
`get`/`list`/`watch`. A custom ServiceAccount needs the extra `watch` verb on
those three kinds; Builds and ImageStreamTags stay `list` only. Without watch,
the last list stays until Reload. The graph banner reads `OpenShift watch
denied. Resource data might be stale. Reload to refresh.` `live` only appears
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

Partial permission failures preserve successful inventory and show a warning.
Routes, Services, Helm releases, and console links are not included in this
release.
