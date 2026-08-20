# OpenShift provider

OpenShift shows resources associated with graph commits and conservative health
status. Select a resource and press Enter to inspect its cached API object as
formatted JSON.

## Configuration

Configure the provider per repository from `:providers`:

- Enable the provider.
- Set an HTTPS OpenShift API server URL.
- Set the environment variable containing an API token. Default:
  `OPENSHIFT_TOKEN`.
- Set the commit annotation key. Default: `dev/commit-sha`.
- Add one or more namespaces.

Only Builds and ImageStreamTags need the commit annotation. Credentials remain
in environment variables and are not written to config.

## Matching

Annotated Builds and ImageStreamTags seed commit matching. Pods and workloads
with resolved images are matched through immutable image digests. Workloads
whose templates retain mutable tags are resolved through exact namespace and
UID owner chains:

```text
Pod → ReplicaSet → Deployment
Pod → ReplicationController → DeploymentConfig
```

Terminating Pods are excluded. Names, mutable image tags, and label selectors
are not used to infer ownership.

## Status

- `PASS`: successful Build, resolved ImageStreamTag, Ready Pod, or fully
  converged workload.
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

Partial permission failures preserve successful inventory and show a warning.
Logs, live refetch-on-open, Routes, Services, and console links are not included
in this release.
