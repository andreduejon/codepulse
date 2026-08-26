# OpenShift provider

OpenShift shows resources associated with graph commits and conservative health
status. The graph uses two 15-character columns: **Live** and **Cache**.
Both use red / green / running count chips. Cache is terminal Builds
(persisted). Live is Deployments, Pods, ImageStreamTags, and running
Builds. Empty lane shows `·······`. Details mark each terminal Build
`(cached)` after its name. Background refresh lists Builds and
ImageStreamTags. Live Pods and workloads load once when a seed has a digest.
Select a Build or Pod and press Enter to view its log, or the API object for
other kinds. JSON is fetched on open, not kept in memory.

## Configuration

Configure the provider per repository from `:providers`:

- Enable the provider.
- Set an HTTPS OpenShift API server URL.
- Set the environment variable containing an API token. Default:
  `OPENSHIFT_TOKEN`. Prefer a long-lived service-account token over
  `oc whoami -t` (env is fixed until Codepulse restarts).
- Set the commit annotation key. Default: `dev/commit-sha`.
- Add one or more namespaces.
- Cache count (`10`, `20`, `50`): maximum commit files kept on disk.
- Fetch size (`10`, `20`, `50`): how many graph commits are candidates. Only
  those commits that also have a Build or ImageStreamTag seed are matched.
  Same options as Jenkins fetch size per job; the unit here is commits on the
  graph, not builds per job.

Stamp `dev/commit-sha` (or your annotation key) as a **label** on Builds and
Deployments when the API allows it. ImageStreamTags accept annotations only.
Credentials stay in environment variables and are not written to config.

## Cache

Terminal Builds (`Complete`, `Failed`, `Error`, `Cancelled`) and their logs are
stored under:

```text
~/.cache/codepulse/openshift/<repository-hash>/<commit-sha>.json
~/.cache/codepulse/openshift/<repository-hash>/logs/<sha>_<namespace>_<build>.txt
```

Raw API objects, Pods, and workloads are not written to disk. An expired token
stops further requests and leaves the cache in place.

## Matching

A commit SHA is taken from `metadata.labels` first, then annotations on
metadata, ImageStreamTag `tag`, and the nested image (same key, default
`dev/commit-sha`). `oc annotate istag` writes `tag.annotations`.

Background refresh lists Builds and ImageStreamTags. Builds for the graph
window are requested with `labelSelector=dev/commit-sha in (…)`. If that
returns nothing, the full Build list is scanned by annotation (old objects).
ImageStreamTags are always listed in full; they cannot be labeled.

Live inventory prefers labeled Deployments for those SHAs, then lists Pods
with each Deployment’s `spec.selector`. If no labeled Deployment exists, the
previous full live list and digest / owner-chain match is used:

```text
Pod → ReplicaSet → Deployment
Pod → ReplicationController → DeploymentConfig
```

Terminating Pods are excluded. ImageStreamTags are a match seed only and are
not written to disk.

## Logs

- Terminal Build logs load from disk when present, otherwise from the Build log
  API, then cache.
- Running Build logs and Pod logs are fetched once from the API. Press `r` to
  refresh. They are not stored.
- `l` toggles log and JSON for Builds and Pods.

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

Build and Pod log views also need `get` on those log subresources.

Partial permission failures preserve successful inventory and show a warning.
Routes, Services, Helm releases, and console links are not included in this
release.
