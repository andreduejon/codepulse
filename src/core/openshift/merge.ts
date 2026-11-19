/**
 * OpenShift builds as the cache keeps them, and converting between them and resources: plain functions, no storage.
 * The cache (cache.ts) and the provider service (core/openshift/service.ts) both use them.
 */

import { buildStatus } from "./resources";
import type { OpenShiftCacheLimit, OpenShiftResource, OpenShiftStatus } from "./types";
import type { OpenShiftWarning } from "./warnings";

export interface OpenShiftCachedBuild {
  id: string;
  name: string;
  namespace: string;
  uid?: string;
  status: OpenShiftStatus;
  imageRefs: string[];
  commitSha: string;
  updatedAt?: string | null;
  object?: unknown;
}

export interface OpenShiftCacheEntry {
  sha: string;
  builds: OpenShiftCachedBuild[];
  /** The Kubernetes warnings about the commit's resources: kept with its builds, evicted with them. */
  warnings?: OpenShiftWarning[];
}

function isOpenShiftWarning(value: unknown): value is OpenShiftWarning {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as OpenShiftWarning;
  return (
    typeof entry.id === "string" &&
    typeof entry.namespace === "string" &&
    typeof entry.kind === "string" &&
    typeof entry.name === "string" &&
    typeof entry.reason === "string" &&
    typeof entry.message === "string" &&
    typeof entry.count === "number" &&
    (entry.uid === undefined || typeof entry.uid === "string") &&
    (entry.firstSeen === null || typeof entry.firstSeen === "string") &&
    (entry.lastSeen === null || typeof entry.lastSeen === "string")
  );
}

export interface OpenShiftCacheOptions {
  root?: string;
  maxEntries?: OpenShiftCacheLimit;
}

const STATUSES = new Set<OpenShiftStatus>(["pass", "fail", "running", "cancelled", "unknown"]);

export function isOpenShiftCacheEntry(value: unknown): value is OpenShiftCacheEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as OpenShiftCacheEntry;
  if (typeof entry.sha !== "string" || !Array.isArray(entry.builds)) return false;
  if (entry.warnings !== undefined && !(Array.isArray(entry.warnings) && entry.warnings.every(isOpenShiftWarning)))
    return false;
  return entry.builds.every(
    build =>
      typeof build === "object" &&
      build !== null &&
      typeof build.id === "string" &&
      typeof build.name === "string" &&
      typeof build.namespace === "string" &&
      typeof build.commitSha === "string" &&
      STATUSES.has(build.status) &&
      Array.isArray(build.imageRefs) &&
      build.imageRefs.every(ref => typeof ref === "string"),
  );
}

export function mergeById<T extends { id: string }>(existing: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

export function toCachedBuild(resource: OpenShiftResource): OpenShiftCachedBuild | null {
  if (resource.kind !== "Build" || !resource.commitSha) return null;
  return {
    id: resource.id,
    name: resource.name,
    namespace: resource.namespace,
    uid: resource.uid,
    status: resource.status,
    imageRefs: resource.imageRefs,
    commitSha: resource.commitSha,
    updatedAt: resource.updatedAt ?? null,
    object: resource.object,
  };
}

/**
 * How a saved build ended. Its saved object says so: a build cached before cancelled was a status of its own was saved
 * as failed. The Resources tab and the Dashboard read it the same way.
 */
export function cachedBuildStatus(build: OpenShiftCachedBuild): OpenShiftStatus {
  return build.status === "fail" && buildStatus(build.object) === "cancelled" ? "cancelled" : build.status;
}

export function cachedBuildToResource(build: OpenShiftCachedBuild): OpenShiftResource {
  return {
    id: build.id,
    kind: "Build",
    namespace: build.namespace,
    name: build.name,
    status: cachedBuildStatus(build),
    imageRefs: build.imageRefs,
    commitSha: build.commitSha,
    uid: build.uid,
    updatedAt: build.updatedAt ?? null,
    object: build.object,
    // Until the cluster lists it again: a fresh Build from the API replaces this one.
    cacheOnly: true,
  };
}
