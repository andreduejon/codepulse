/** The providers' cache as the app manages it (the cache screen): what it holds per repository, and the port to it. */

export const CACHE_INACTIVITY_MS = 90 * 24 * 60 * 60 * 1_000;

export interface CacheGroupSummary {
  provider: string;
  repoHash: string;
  repoPath: string;
  snapshotCount: number;
  payloadBytes: number;
  artifactCount: number;
  artifactBytes: number;
  logCount: number;
  logBytes: number;
  lastAccessed: number;
  cleanupAt: number;
}

export interface ProviderCacheSummary {
  path: string;
  databaseBytes: number;
  journalBytes: number;
  groups: CacheGroupSummary[];
}

export interface CacheEvictionResult {
  snapshotCount: number;
  artifactCount: number;
}

export type CacheRepositorySummary = Pick<
  CacheGroupSummary,
  "repoHash" | "repoPath" | "snapshotCount" | "lastAccessed" | "cleanupAt"
>;

/** The providers' cache: the cache screen's summary and actions, and what the app needs around it. */
export interface CacheStorePort {
  /** The cache file, as the cache screen names it. */
  path: () => string;
  summary: () => ProviderCacheSummary;
  /** Starts a repository's inactivity time again; 1 when it had any snapshots. */
  resetTimer: (repoHash: string) => number;
  /** Starts every repository's inactivity time again; how many repositories. */
  resetAllTimers: () => number;
  /** Removes a repository's snapshots and their logs. */
  evictRepository: (repoHash: string) => CacheEvictionResult;
  /** A repository's cache identity, as its snapshots are kept. */
  identity: (repoPath: string) => Promise<{ hash: string }>;
  /** Called with the repository after each snapshot a provider writes; returns the function that stops it. */
  onWrite: (listener: (repoPath: string) => void) => () => void;
  /** While the cache screen shows, providers write nothing. */
  setSuspended: (suspended: boolean) => void;
}
