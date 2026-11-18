/**
 * An OpenShift commit's data, without any UI: from a cache entry, merged with the live list, which commits the build
 * list may show. Plain functions; the service (service.ts) and the hook's tests use them.
 */

import type { GraphBadge } from "../provider-model";
import { cachedBuildToResource, mergeById, type OpenShiftCacheEntry } from "./merge";
import { isTerminalBuildStatus } from "./resources";
import type { OpenShiftCommitData, OpenShiftListedInventory, OpenShiftNamespaceData, OpenShiftResource } from "./types";
import { mergeWarnings } from "./warnings";

/** A graph badge with no resources, for a commit that only carries namespace markers. */
export function emptyGraphBadge(sha: string): GraphBadge {
  const none = { passCount: 0, failCount: 0, runningCount: 0, unknownCount: 0 };
  return {
    sha,
    badge: "unknown",
    ...none,
    resourceCount: 0,
    lanes: { live: { ...none } },
    latestRunAt: "",
    latestStatus: "unknown",
  };
}

function emptyNamespace(namespace: string): OpenShiftNamespaceData {
  return {
    namespace,
    builds: [],
    imageStreamTags: [],
    deployments: [],
    deploymentConfigs: [],
    pods: [],
  };
}

/**
 * A live list that failed for some namespace/kind keeps that slice of the previous list, so a failed request does not
 * look like the workloads went away. Successful slices replace their previous contents as usual.
 */
export function keepFailedLiveSlices(
  previous: OpenShiftListedInventory | null | undefined,
  next: OpenShiftListedInventory,
): OpenShiftListedInventory {
  if (!previous || next.failures.length === 0) return next;
  const failed = new Set(next.failures.map(failure => `${failure.namespace}:${failure.kind}`));
  const keep = (item: { namespace: string; kind: string }) => failed.has(`${item.namespace}:${item.kind}`);
  return {
    ...next,
    resources: [...next.resources, ...previous.resources.filter(keep)],
    controllers: [...next.controllers, ...previous.controllers.filter(keep)],
  };
}

export function commitDataFromCacheEntry(entry: OpenShiftCacheEntry): OpenShiftCommitData {
  const namespaces = new Map<string, OpenShiftNamespaceData>();
  for (const build of entry.builds) {
    const ns = namespaces.get(build.namespace) ?? emptyNamespace(build.namespace);
    ns.builds.push(cachedBuildToResource(build));
    namespaces.set(build.namespace, ns);
  }
  return {
    sha: entry.sha,
    namespaces: [...namespaces.values()],
    liveFetched: false,
    ...(entry.warnings?.length ? { warnings: entry.warnings } : {}),
  };
}

/**
 * A commit the build list was asked about, after it answered: a finished Build it held as listed that the list no
 * longer has is shown from the cache from now on (OpenShift pruned it); an unfinished one is gone. A namespace whose
 * list failed keeps what it had. The same commit when nothing changed.
 */
export function markUnlistedBuilds(
  commit: OpenShiftCommitData,
  listed: ReadonlySet<string>,
  failedNamespaces: ReadonlySet<string>,
): OpenShiftCommitData {
  let changed = false;
  const namespaces = commit.namespaces.map(ns => {
    if (failedNamespaces.has(ns.namespace)) return ns;
    const builds = ns.builds.flatMap(build => {
      if (build.cacheOnly || listed.has(build.id)) return [build];
      changed = true;
      return isTerminalBuildStatus(build.status) ? [{ ...build, cacheOnly: true }] : [];
    });
    return builds.length === ns.builds.length && builds.every((build, i) => build === ns.builds[i])
      ? ns
      : { ...ns, builds };
  });
  return changed ? { ...commit, namespaces } : commit;
}

export function resourceHasImageDigest(resource: OpenShiftResource): boolean {
  return resource.imageRefs.some(ref => /sha256:[a-fA-F0-9]+/i.test(ref));
}

export function commitHasDigestSeed(commit: OpenShiftCommitData): boolean {
  return commit.namespaces.some(ns => [...ns.builds, ...ns.imageStreamTags].some(resourceHasImageDigest));
}

export function selectOpenShiftCandidateSHAs(
  graphSHAs: readonly string[],
  annotatedSHAs: Iterable<string>,
  selectedSHA?: string | null,
): Set<string> {
  const annotated = new Set([...annotatedSHAs].map(sha => sha.toLowerCase()));
  const out = new Set<string>();
  for (const sha of graphSHAs) {
    const key = sha.toLowerCase();
    if (annotated.has(key)) out.add(key);
  }
  if (selectedSHA) {
    const key = selectedSHA.toLowerCase();
    if (annotated.has(key)) out.add(key);
  }
  return out;
}

function clearLiveLane(ns: OpenShiftNamespaceData): OpenShiftNamespaceData {
  return { ...ns, deployments: [], deploymentConfigs: [], pods: [], imageStreamTags: [] };
}

export function mergeLiveIntoCommit(
  base: OpenShiftCommitData | null,
  live: OpenShiftCommitData | undefined,
  sha: string,
  liveFetched = false,
): OpenShiftCommitData {
  // Warnings come from their own list (warnings.ts), not from a resource listing: the commit keeps both sides'.
  const kept = mergeWarnings(base?.warnings ?? [], live?.warnings ?? []);
  const warnings = kept.length > 0 ? { warnings: kept } : {};
  if (!live) {
    if (!base) return { sha, namespaces: [], liveFetched };
    if (!liveFetched) return base;
    return { sha, liveFetched: true, namespaces: base.namespaces.map(clearLiveLane), ...warnings };
  }
  if (!base) return { ...live, sha, liveFetched: liveFetched || live.liveFetched };
  const fetched = liveFetched || base.liveFetched || live.liveFetched;
  const namespaces = new Map(base.namespaces.map(ns => [ns.namespace, { ...ns }]));
  const liveNamespaces = new Set(live.namespaces.map(ns => ns.namespace));
  for (const ns of live.namespaces) {
    const current = namespaces.get(ns.namespace) ?? emptyNamespace(ns.namespace);
    namespaces.set(ns.namespace, {
      ...current,
      imageStreamTags: liveFetched
        ? ns.imageStreamTags
        : current.imageStreamTags.length > 0
          ? current.imageStreamTags
          : ns.imageStreamTags,
      deployments: ns.deployments,
      deploymentConfigs: ns.deploymentConfigs,
      pods: ns.pods,
      builds: mergeById(ns.builds, current.builds),
    });
  }
  if (fetched) {
    for (const [name, current] of namespaces) {
      if (!liveNamespaces.has(name)) namespaces.set(name, clearLiveLane(current));
    }
  }
  return {
    sha,
    namespaces: [...namespaces.values()],
    liveFetched: fetched,
    ...warnings,
  };
}
