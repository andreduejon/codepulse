import { BANNER } from "../../debug/banner";
import { type CacheSyncResult, SYNC_OK, syncFailed } from "../shared/cache-sync";
import { mergeById, persistMergedSnapshots } from "../shared/sha-sqlite-cache";
import { fetchOpenShiftInventory, getOpenShiftToken, isTerminalBuildStatus } from "./api";
import { OpenShiftCache, toCachedBuild } from "./cache";
import type { OpenShiftProviderConfig } from "./types";

/**
 * Lists the Builds of an app's commits in its namespaces and writes the finished ones into its cache: what the
 * OpenShift view does for the app when it is open.
 */
export async function syncOpenShiftCache(opts: {
  app: string;
  config: OpenShiftProviderConfig;
  shas: readonly string[];
  cacheRoot?: string;
  signal?: AbortSignal;
}): Promise<CacheSyncResult> {
  const { config, signal } = opts;
  const token = getOpenShiftToken(config.tokenEnvVar);
  if (!token || !config.serverUrl || config.namespaces.length === 0 || opts.shas.length === 0) return SYNC_OK;
  const result = await fetchOpenShiftInventory(config, token, signal, "seeds", { commitShas: [...opts.shas] });
  if (signal?.aborted) return SYNC_OK;
  if (result.error === BANNER.openshift.tokenExpired || (result.successfulRequests === 0 && result.error))
    return syncFailed(result.error, BANNER.openshift.tokenExpired);
  const bySha = new Map([...result.data].map(([sha, data]) => [sha.toLowerCase(), data]));
  await persistMergedSnapshots(
    new OpenShiftCache({ root: opts.cacheRoot, maxEntries: config.cacheLimit }),
    opts.app,
    opts.shas,
    () => !signal?.aborted,
    sha =>
      (bySha.get(sha.toLowerCase())?.namespaces ?? [])
        .flatMap(namespace => namespace.builds)
        .map(toCachedBuild)
        .filter((build): build is NonNullable<typeof build> => build !== null && isTerminalBuildStatus(build.status)),
    (sha, existing, incoming) => ({ sha, builds: mergeById(existing?.builds ?? [], incoming) }),
  );
  return SYNC_OK;
}
