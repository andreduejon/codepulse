import { DEFAULT_PROVIDER_CACHE_ROOT, ShaSqliteCache } from "../shared/sha-sqlite-cache";
import type { OpenShiftCacheLimit, OpenShiftResource, OpenShiftStatus } from "./types";

export const DEFAULT_OPENSHIFT_CACHE_LIMIT: OpenShiftCacheLimit = 20;
export const DEFAULT_OPENSHIFT_CACHE_ROOT = DEFAULT_PROVIDER_CACHE_ROOT;

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
}

export interface OpenShiftCacheOptions {
  root?: string;
  maxEntries?: OpenShiftCacheLimit;
}

const STATUSES = new Set<OpenShiftStatus>(["pass", "fail", "running", "unknown"]);

export function isOpenShiftCacheEntry(value: unknown): value is OpenShiftCacheEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as OpenShiftCacheEntry;
  if (typeof entry.sha !== "string" || !Array.isArray(entry.builds)) return false;
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

export function cachedBuildToResource(build: OpenShiftCachedBuild): OpenShiftResource {
  return {
    id: build.id,
    kind: "Build",
    namespace: build.namespace,
    name: build.name,
    status: build.status,
    imageRefs: build.imageRefs,
    commitSha: build.commitSha,
    uid: build.uid,
    updatedAt: build.updatedAt ?? null,
    object: build.object,
  };
}

export class OpenShiftCache extends ShaSqliteCache<OpenShiftCacheEntry> {
  constructor(options: OpenShiftCacheOptions = {}) {
    super({
      provider: "openshift",
      root: options.root ?? DEFAULT_OPENSHIFT_CACHE_ROOT,
      maxEntries: options.maxEntries ?? DEFAULT_OPENSHIFT_CACHE_LIMIT,
      isEntry: isOpenShiftCacheEntry,
      invalidMessage: "Cannot cache an invalid OpenShift build snapshot.",
    });
  }

  override readLog(repoPath: string, sha: string, namespace: string, buildName?: string): Promise<string | null> {
    return super.readLog(repoPath, sha, buildName === undefined ? namespace : `${namespace}_${buildName}`);
  }

  override writeLog(
    repoPath: string,
    sha: string,
    namespace: string,
    buildNameOrLog: string,
    log?: string,
  ): Promise<void> {
    return super.writeLog(
      repoPath,
      sha,
      log === undefined ? namespace : `${namespace}_${buildNameOrLog}`,
      log ?? buildNameOrLog,
    );
  }
}
