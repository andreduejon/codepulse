/**
 * Jenkins for one open repository, without any UI framework: which commits and jobs to ask about, builds and their
 * stages and test reports, console logs, what the cache keeps, the multibranch limit's notice, and the freeze after
 * an authentication failure. When it fetches is the fetch lifecycle's (core/fetch-lifecycle.ts).
 *
 * Everything outside comes through ports; the Solid hook (providers/jenkins/use-jenkins-ci.ts) builds them.
 */
import { BANNER, bannerOrFallback } from "../../debug/banner";
import type { ProviderFetchArgs } from "../fetch-lifecycle";
import type { ProviderAppPort, ProviderLifecycle } from "../provider-ports";
import { providerError, providerIdle, providerLoading, providerUnavailable, providerWarning } from "../provider-status";
import { collectRunningSHAs, collectTopSHAs } from "../sha-selection";
import { jobsSettled } from "../status";
import { buildJenkinsCommitDataMap, buildJenkinsGraphBadges } from "./commit-data";
import {
  isTerminalJenkinsRun,
  type JenkinsCacheEntry,
  jobsMapFromCache,
  mergeJenkinsJobs,
  mergeJenkinsRuns,
} from "./merge";
import type {
  JenkinsCommitData,
  JenkinsJob,
  JenkinsJobConfig,
  JenkinsJobFetchResult,
  JenkinsListedBuilds,
  JenkinsProviderConfig,
  JenkinsRun,
} from "./types";

/** Jenkins' API: the requests the service makes. */
export interface JenkinsApiPort {
  /** The newest builds of the jobs, for the graph's commits; `knownLastBuilds` skips jobs with no new build. */
  fetchJenkinsGraphDataForSHAs: (
    jobs: JenkinsJobConfig[],
    username: string | undefined,
    token: string,
    shas: string[],
    opts?: {
      signal?: AbortSignal;
      buildLimit?: number;
      knownLastBuilds?: ReadonlyMap<string, number>;
      preferredBranches?: ReadonlySet<string>;
    },
  ) => Promise<JenkinsListedBuilds>;
  /** The builds of the jobs for some commits, with their details. */
  fetchJenkinsDataForSHAs: (
    jobs: JenkinsJobConfig[],
    username: string | undefined,
    token: string,
    shas: string[],
    opts?: { signal?: AbortSignal; buildLimit?: number; preferredBranches?: ReadonlySet<string> },
  ) => Promise<JenkinsListedBuilds>;
  fetchJenkinsRunsForBuilds: (
    runs: JenkinsRun[],
    username: string | undefined,
    token: string,
    signal?: AbortSignal,
  ) => Promise<{ data: JenkinsRun[]; error: string | null }>;
  fetchJenkinsRunJobs: (
    run: JenkinsRun,
    username: string | undefined,
    token: string,
    signal?: AbortSignal,
  ) => Promise<{ jobs: JenkinsJob[]; error: string | null }>;
  fetchJenkinsConsoleLog: (
    run: JenkinsRun,
    username: string | undefined,
    token: string,
    signal?: AbortSignal,
  ) => Promise<string>;
}

/** The cache: finished builds and their stages per commit, and console logs. */
export interface JenkinsCachePort {
  read: (repoPath: string, sha: string) => Promise<JenkinsCacheEntry | null>;
  peekAll: (repoPath: string) => Promise<JenkinsCacheEntry[]>;
  readLog: (repoPath: string, sha: string, key: string) => Promise<string | null>;
  writeLog: (repoPath: string, sha: string, key: string, log: string) => Promise<void>;
  mergeMany: <I>(
    repoPath: string,
    items: readonly { sha: string; incoming: readonly I[] }[],
    merge: (sha: string, existing: JenkinsCacheEntry | null, incoming: I[]) => JenkinsCacheEntry,
    isCurrent?: () => boolean,
  ) => Promise<number>;
}

export interface JenkinsServicePorts {
  app: ProviderAppPort;
  api: JenkinsApiPort;
  cache: () => JenkinsCachePort;
  config: () => JenkinsProviderConfig;
  token: (envVar: string) => string | null;
  lifecycle: () => ProviderLifecycle;
  onDataChange: () => void;
}

/** Whether every job knows its test report: one, or none (`null`). */
const reportsKnown = (jobs: readonly JenkinsJob[]) => jobs.every(job => job.tests !== undefined);

export function createJenkinsService(ports: JenkinsServicePorts) {
  const { app } = ports;
  const lifecycle = () => ports.lifecycle();

  const commitDataCache = new Map<string, JenkinsCommitData>();
  const jobsCache = new Map<string, JenkinsJobFetchResult>();
  const logCache = new Map<string, string>();
  const runCache = new Map<string, JenkinsRun>();
  const resolvedShas = new Set<string>();
  const queriedSHAs = new Set<string>();
  const lastBuildByJob = new Map<string, number>();
  let authFrozen = false;
  /** The auth banner that froze requests (token expired or authentication failed). */
  let authError: string | null = null;
  let discoveryTruncated = false;
  let branchJobs = { shown: 0, total: 0 };

  const isAvailable = () => {
    const config = ports.config();
    if (!config.enabled) return false;
    if (config.jobs.length === 0) return false;
    if (!config.username?.trim()) return false;
    return ports.token(config.tokenEnvVar) !== null;
  };

  const settledStatus = () =>
    discoveryTruncated
      ? providerWarning(BANNER.jenkins.branchLimit(branchJobs.shown, branchJobs.total))
      : providerIdle();
  /** Branch names in the loaded graph (local, and remote without the remote's name): their jobs are read first. */
  const graphBranches = () => {
    const names = new Set<string>();
    for (const row of app.graphRows()) {
      for (const ref of row.commit.refs) {
        if (ref.type === "branch") names.add(ref.name);
        else if (ref.type === "remote") names.add(ref.name.slice(ref.name.indexOf("/") + 1));
      }
    }
    return names;
  };

  function rememberAuthError(error: string | null): void {
    if (error === BANNER.jenkins.tokenExpired || error === BANNER.jenkins.authFailed) {
      authFrozen = true;
      authError = error;
    }
  }

  function rebuildCaches() {
    const allRuns = [...runCache.values()];
    const rebuilt = buildJenkinsCommitDataMap(allRuns, false);
    commitDataCache.clear();
    for (const sha of queriedSHAs) {
      const existing = rebuilt.get(sha) ?? { sha, runs: [], resolved: resolvedShas.has(sha) };
      existing.resolved = resolvedShas.has(sha);
      commitDataCache.set(sha, existing);
    }
    for (const [sha, data] of rebuilt) {
      data.resolved = resolvedShas.has(sha);
      commitDataCache.set(sha, data);
    }
    app.setBadges(buildJenkinsGraphBadges(allRuns));
    ports.onDataChange();
  }

  /**
   * Asks Jenkins about `shas`. Every fetch starts from the configured jobs, so a branch pushed since is found (one
   * request per multibranch project lists its branch jobs). Commits already asked about may skip the jobs whose last
   * build is unchanged and finished; new commits and a `thorough` fetch (Reload) skip none: a build can be for a
   * commit the graph didn't have when its job was last listed.
   */
  async function fetchForSHAs(shas: string[], mode: "shallow" | "full", signal?: AbortSignal, thorough = false) {
    const epoch = lifecycle().getEpoch();
    const repoPath = app.repoPath();
    if (!lifecycle().isCurrent(epoch, repoPath)) return { firstError: null, stale: true };
    const config = ports.config();
    const token = ports.token(config.tokenEnvVar);
    if (!token || shas.length === 0) return { firstError: null };
    const jobs = config.jobs;
    const shortcuts = !thorough && shas.every(sha => queriedSHAs.has(sha));
    const result =
      mode === "shallow"
        ? await ports.api.fetchJenkinsGraphDataForSHAs(jobs, config.username, token, shas, {
            signal,
            buildLimit: config.fetchDepth,
            ...(shortcuts ? { knownLastBuilds: lastBuildByJob } : {}),
            preferredBranches: graphBranches(),
          })
        : await ports.api.fetchJenkinsDataForSHAs(jobs, config.username, token, shas, {
            signal,
            buildLimit: config.fetchDepth,
            preferredBranches: graphBranches(),
          });
    if (signal?.aborted || !lifecycle().isCurrent(epoch, repoPath)) return { firstError: null, stale: true };
    if (result.error === null) {
      for (const sha of shas) {
        queriedSHAs.add(sha);
        if (mode === "full") resolvedShas.add(sha);
      }
    }
    if (result.discoveryComplete) {
      const activeJobUrls = new Set(result.jobUrls);
      for (const [key, run] of runCache) if (!activeJobUrls.has(run.jobUrl)) runCache.delete(key);
    }
    discoveryTruncated = result.discoveryTruncated;
    branchJobs = result.branchJobs;
    for (const [url, number] of result.lastBuilds) lastBuildByJob.set(url, number);
    for (const run of result.data) runCache.set(`${run.id}:${run.headSha}`, run);
    rebuildCaches();
    // Like GitHub's and OpenShift's: a truncated discovery still caches the finished builds it read. The notice says
    // some branch jobs were not read, and each session asks again, so a build missing here is added later.
    await persistTerminalRuns(repoPath, shas, epoch);
    return { firstError: result.error, stale: false };
  }

  /**
   * Read cached commits from disk (no network). With `everyCached`, also the commits below the fetch depth that are
   * not in memory yet: the cache limit decides how many commits keep their builds, the fetch depth only how many
   * Jenkins is asked about. Those are peeked, not read, so showing them does not count as a use for eviction.
   */
  async function hydrateCachedCandidates(
    repoPath: string,
    shas: readonly string[],
    epoch: number,
    everyCached = false,
  ): Promise<void> {
    if (!lifecycle().isCurrent(epoch, repoPath)) return;
    const disk = ports.cache();
    const [read, peeked] = await Promise.all([
      Promise.all(shas.map(sha => disk.read(repoPath, sha))),
      everyCached ? disk.peekAll(repoPath) : Promise.resolve([]),
    ]);
    if (!lifecycle().isCurrent(epoch, repoPath)) return;
    const targets = new Set(shas.map(sha => sha.toLowerCase()));
    const known = new Set([...runCache.values()].map(run => run.headSha.toLowerCase()));
    const entries = [
      ...read,
      ...peeked.filter(entry => !targets.has(entry.sha.toLowerCase()) && !known.has(entry.sha.toLowerCase())),
    ];
    let changed = false;
    for (const entry of entries) {
      if (!entry) continue;
      for (const run of entry.runs) runCache.set(`${run.id}:${run.headSha}`, run);
      for (const [id, jobs] of Object.entries(entry.jobs ?? {}))
        if (!jobsCache.has(id)) jobsCache.set(id, { jobs, error: null });
      changed = true;
    }
    if (changed) rebuildCaches();
  }

  /** The finished builds of these commits, with the stages read for them, into the cache (one write for all). */
  async function persistTerminalRuns(repoPath: string, shas: readonly string[], epoch: number): Promise<void> {
    const isCurrent = () => lifecycle().isCurrent(epoch, repoPath);
    if (!isCurrent()) return;
    const items = shas
      .map(sha => ({
        sha,
        incoming: [...runCache.values()].filter(
          run => isTerminalJenkinsRun(run) && run.headSha.toLowerCase() === sha.toLowerCase(),
        ),
      }))
      .filter(item => item.incoming.length > 0);
    if (items.length === 0) return;
    await ports.cache().mergeMany(
      repoPath,
      items,
      (sha, existing, incoming: JenkinsRun[]) => ({
        sha,
        runs: mergeJenkinsRuns(existing?.runs ?? [], incoming),
        jobs: mergeJenkinsJobs(
          existing?.jobs,
          jobsMapFromCache(
            jobsCache,
            incoming.map(run => run.id),
          ),
        ),
      }),
      isCurrent,
    );
  }

  // ── What the lifecycle runs ─────────────────────────────────────────────────────────────────────

  const reportUnavailable = (showStatus: boolean) => {
    if (!showStatus) return;
    const config = ports.config();
    if (config.jobs.length === 0) app.setStatus(providerUnavailable(BANNER.jenkins.noJobs));
    else if (!config.username?.trim()) app.setStatus(providerUnavailable(BANNER.jenkins.noUsername));
    else app.setStatus(providerUnavailable(BANNER.jenkins.missingToken(config.tokenEnvVar)));
  };

  const onCancelledStatus = () => {
    if (app.status().kind === "loading") app.setStatus(settledStatus());
  };

  const runInitialFetch = async ({ signal, shas, showStatus, retry, epoch }: ProviderFetchArgs) => {
    if (authFrozen && !retry) return;
    if (retry) authFrozen = false;
    if (showStatus) app.setStatus(providerLoading());
    const window = shas ?? collectTopSHAs(app.graphRows(), ports.config().fetchDepth);
    const repoPath = app.repoPath();
    await hydrateCachedCandidates(repoPath, window, epoch, true);
    if (signal?.aborted || !lifecycle().isCurrent(epoch, repoPath)) return;
    // An explicit retry asks again for every target, also when a fetch it waited behind just marked them queried.
    const target = retry ? window : window.filter(sha => !queriedSHAs.has(sha));
    if (target.length === 0) {
      if (showStatus) app.setStatus(settledStatus());
      lifecycle().noteFetchStarted();
      return;
    }
    const { firstError, stale } = await fetchForSHAs(target, "shallow", signal, retry);
    if (stale || !lifecycle().isCurrent(epoch, repoPath)) return;
    lifecycle().noteFetchStarted();
    rememberAuthError(firstError ?? null);
    // Reading only some branch jobs is a notice (its own banner), not a failure that delays the next refresh.
    lifecycle().noteFetchResult(!firstError);
    if (!firstError) app.noteSuccess();
    if (firstError) app.setStatus(providerError(firstError));
    else app.setStatus(settledStatus());
  };

  const runRefresh = async ({ signal, showStatus, retry, epoch }: ProviderFetchArgs) => {
    const repoPath = app.repoPath();
    if (authFrozen && !retry) return;
    if (retry) authFrozen = false;
    if (showStatus) app.setStatus(providerLoading());
    // The builds still running, asked about directly (its own badges: on the dashboard, the shown view's are none).
    const target = collectRunningSHAs(app.badges());
    const wanted = new Set(target.map(sha => sha.toLowerCase()));
    const runningRuns = [...runCache.values()].filter(
      run => wanted.has(run.headSha.toLowerCase()) && run.status === "running",
    );
    let runningError: string | null = null;
    if (runningRuns.length > 0) {
      const config = ports.config();
      const token = ports.token(config.tokenEnvVar);
      if (!token) return;
      const { data, error } = await ports.api.fetchJenkinsRunsForBuilds(runningRuns, config.username, token, signal);
      if (signal?.aborted || !lifecycle().isCurrent(epoch, repoPath)) return;
      for (const run of data) runCache.set(`${run.id}:${run.headSha}`, run);
      rebuildCaches();
      await persistTerminalRuns(repoPath, target, epoch);
      if (!lifecycle().isCurrent(epoch, repoPath)) return;
      runningError = error;
    }
    // Builds that started since: each job's last build is probed, and only the jobs with a new one are listed.
    const window = collectTopSHAs(app.graphRows(), ports.config().fetchDepth);
    const { firstError, stale } = await fetchForSHAs(window, "shallow", signal);
    if (stale || !lifecycle().isCurrent(epoch, repoPath)) return;
    lifecycle().noteRefreshSettled();
    const error = runningError ?? firstError ?? null;
    rememberAuthError(error);
    lifecycle().noteFetchResult(!error);
    if (!error) app.noteSuccess();
    if (error) app.setStatus(providerError(error));
    else app.setStatus(settledStatus());
  };

  const onResetCaches = () => {
    commitDataCache.clear();
    jobsCache.clear();
    logCache.clear();
    runCache.clear();
    resolvedShas.clear();
    queriedSHAs.clear();
    lastBuildByJob.clear();
    authFrozen = false;
    discoveryTruncated = false;
    ports.onDataChange();
    app.setBadges(new Map());
    app.setStatus(providerIdle());
  };

  // ── What the app asks ───────────────────────────────────────────────────────────────────────────

  /** Manual Reload / Fetch: re-query the whole graph window (like GitHub), not only running builds. */
  async function refreshWindow(): Promise<void> {
    if (app.suspended()) return;
    const window = collectTopSHAs(app.graphRows(), ports.config().fetchDepth);
    await lifecycle().fetchInitial(undefined, window, true, true);
    if (app.view() === "jenkins") lifecycle().startAutoRefresh();
  }

  /** A build's stages and test report: from the cache once final, else asked of Jenkins. */
  async function fetchJobsForRun(run: JenkinsRun, signal?: AbortSignal): Promise<JenkinsJobFetchResult> {
    const epoch = lifecycle().getEpoch();
    const repoPath = app.repoPath();
    // Only finished stages with a known test report are final; a cached snapshot with a running job or stage, or
    // without its report (not read, or cached before reports were), is fetched again.
    const cached = jobsCache.get(run.id);
    if (cached && jobsSettled(cached.jobs) && reportsKnown(cached.jobs)) return cached;
    if (!lifecycle().isCurrent(epoch, repoPath)) return { jobs: [], error: null };
    // Frozen after an auth failure: no requests until Reload; say why instead of asking Jenkins again.
    if (authFrozen) return { jobs: [], error: authError ?? BANNER.jenkins.tokenExpired };
    const config = ports.config();
    const token = ports.token(config.tokenEnvVar);
    if (!token) return { jobs: [], error: BANNER.jenkins.missingToken(config.tokenEnvVar) };
    const result = await lifecycle().runRequest(
      signal => ports.api.fetchJenkinsRunJobs(run, config.username, token, signal),
      signal,
    );
    if (signal?.aborted || !lifecycle().isCurrent(epoch, repoPath)) return { jobs: [], error: null };
    if (run.status === "completed" && result.error === null && jobsSettled(result.jobs) && reportsKnown(result.jobs)) {
      jobsCache.set(run.id, result);
      await persistTerminalRuns(repoPath, [run.headSha], epoch);
    }
    return result;
  }

  /** A build's console log: a finished build's from memory or the cache, else from Jenkins (and kept once finished). */
  async function fetchRunLog(run: JenkinsRun, signal?: AbortSignal): Promise<string> {
    const epoch = lifecycle().getEpoch();
    const cached = logCache.get(run.id);
    if (cached) return cached;
    const repoPath = app.repoPath();
    if (!lifecycle().isCurrent(epoch, repoPath)) return "";
    const disk = ports.cache();
    if (isTerminalJenkinsRun(run)) {
      const diskLog = await disk.readLog(repoPath, run.headSha, run.id).catch(() => null);
      if (!lifecycle().isCurrent(epoch, repoPath)) return "";
      if (diskLog) {
        logCache.set(run.id, diskLog);
        return diskLog;
      }
    }
    const config = ports.config();
    const token = ports.token(config.tokenEnvVar);
    if (!token) throw new Error(BANNER.jenkins.missingToken(config.tokenEnvVar));
    const log = await lifecycle().runRequest(
      signal => ports.api.fetchJenkinsConsoleLog(run, config.username, token, signal),
      signal,
    );
    if (!lifecycle().isCurrent(epoch, repoPath)) return "";
    if (run.status === "completed" && log) {
      logCache.set(run.id, log);
      if (lifecycle().isCurrent(epoch, repoPath))
        await disk.writeLog(repoPath, run.headSha, run.id, log).catch(() => {});
    }
    return log;
  }

  /** One commit's builds: from the cache, and with `force` (Reload commit) asked of Jenkins in full. */
  async function fetchCommitDataForSHA(sha: string, force = false): Promise<void> {
    const epoch = lifecycle().getEpoch();
    const repoPath = app.repoPath();
    await hydrateCachedCandidates(repoPath, [sha], epoch);
    if (!lifecycle().isCurrent(epoch, repoPath)) return;
    // Turned off or not set up (a cached event on the dashboard can still offer Load commit): the cache only.
    if (!force || !isAvailable()) return;
    queriedSHAs.delete(sha);
    // Reload commit is an explicit retry: it clears an auth freeze and reports its own outcome.
    authFrozen = false;
    let firstError: string | null;
    try {
      const result = await lifecycle().trackFetch(() =>
        lifecycle().runRequest(signal => fetchForSHAs([sha], "full", signal)),
      );
      if (result.stale || !lifecycle().isCurrent(epoch, repoPath)) return;
      firstError = result.firstError ?? null;
    } catch (err) {
      if (!lifecycle().isCurrent(epoch, repoPath) || (err instanceof Error && err.name === "AbortError")) return;
      firstError = bannerOrFallback(err, BANNER.jenkins.fetchFailed, "Jenkins");
    }
    rememberAuthError(firstError);
    if (firstError) {
      app.setStatus(providerError(firstError));
      return;
    }
    app.noteSuccess();
    if (app.status().kind === "error") app.setStatus(settledStatus());
  }

  return {
    /** A commit's builds, or null before any were read. Not reactive: the adapter makes it so. */
    getCommitData: (sha: string) => commitDataCache.get(sha) ?? null,
    /** Every build held for the open repository. Not reactive: the adapter makes it so. */
    heldEntries: () => [...commitDataCache.values()],
    queriedSHAs,
    isAvailable,
    reportUnavailable,
    onCancelledStatus,
    runInitialFetch,
    runRefresh,
    onResetCaches,
    refreshWindow,
    fetchJobsForRun,
    fetchRunLog,
    fetchCommitDataForSHA,
  };
}

export type JenkinsService = ReturnType<typeof createJenkinsService>;
