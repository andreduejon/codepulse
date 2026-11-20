import { bannerOrFallback, debugError } from "../banner";
import { addDebugEvent } from "../debug-events";
import type { ProviderFetchArgs } from "../fetch-lifecycle";
import { failureOf, type ProviderFailure } from "../provider-failure";
import type { ProviderAppPort, ProviderLifecycle } from "../provider-ports";
import type { ProviderCacheLimit } from "../provider-settings";
import { providerError, providerIdle, providerLoading, providerUnavailable } from "../provider-status";
import { collectRunningSHAs, collectTopSHAs } from "../sha-selection";
import { jobsSettled } from "../status";
import { GITHUB_BANNER } from "./banner";
import { buildCommitDataMap, buildGraphBadges, GQL_BATCH_SIZE } from "./commit-data";
import { type GitHubCacheEntry, isTerminalGitHubRun, mergeGitHubEntry, mergeGitHubRuns } from "./merge";
import type {
  GitHubAnnotation,
  GitHubCommitData,
  GitHubJob,
  GitHubJobFetchResult,
  GitHubProviderConfig,
  GitHubPullRequest,
  GitHubRepo,
  GitHubResult,
  GitHubWorkflowRun,
  GraphQLFetchResult,
} from "./types";

/** The app, as GitHub sees it. */
export type GitHubAppPort = ProviderAppPort;

/** GitHub's API: the requests the service makes. */
export interface GitHubApiPort {
  fetchCIDataForSHAs: (
    repo: GitHubRepo,
    token: string,
    shas: string[],
    opts?: { signal?: AbortSignal; includeJobs?: boolean },
  ) => Promise<GraphQLFetchResult>;
  fetchRunJobs: (repo: GitHubRepo, token: string, runId: number, signal?: AbortSignal) => Promise<GitHubJobFetchResult>;
  fetchJobAnnotations: (
    repo: GitHubRepo,
    token: string,
    jobId: number,
    signal?: AbortSignal,
  ) => Promise<GitHubAnnotation[] | null>;
  fetchJobLog: (repo: GitHubRepo, token: string, jobId: number, signal?: AbortSignal) => Promise<string>;
  /** The repository's open pull requests. */
  fetchOpenPullRequests: (
    repo: GitHubRepo,
    token: string,
    signal?: AbortSignal,
  ) => Promise<GitHubResult<GitHubPullRequest[]>>;
  /** The pull requests merged or closed most recently. */
  fetchClosedPullRequests: (
    repo: GitHubRepo,
    token: string,
    signal?: AbortSignal,
  ) => Promise<GitHubResult<GitHubPullRequest[]>>;
}

/** The cache: finished runs and their jobs per commit, and job logs. */
export interface GitHubCachePort {
  read: (repoPath: string, sha: string) => Promise<GitHubCacheEntry | null>;
  peekAll: (repoPath: string) => Promise<GitHubCacheEntry[]>;
  readLog: (repoPath: string, sha: string, key: string) => Promise<string | null>;
  writeLog: (repoPath: string, sha: string, key: string, log: string) => Promise<void>;
  mergeMany: <I>(
    repoPath: string,
    items: readonly { sha: string; incoming: readonly I[] }[],
    merge: (sha: string, existing: GitHubCacheEntry | null, incoming: I[]) => GitHubCacheEntry,
    isCurrent?: () => boolean,
  ) => Promise<number>;
}

export type GitHubLifecycle = ProviderLifecycle;

/**
 * What the app gives the provider from outside: its API, a cache with a limit, and the token in an environment
 * variable. The terminal app's are in src/providers/github-actions/adapters.ts.
 */
export interface GitHubAdapters {
  api: GitHubApiPort;
  cache: (maxEntries: ProviderCacheLimit) => GitHubCachePort;
  token: (envVar: string) => string | null;
}

export interface GitHubServicePorts {
  app: GitHubAppPort;
  api: GitHubApiPort;
  /** The cache as configured now (its limit follows the settings). */
  cache: () => GitHubCachePort;
  /** The settings as they are now. */
  config: () => GitHubProviderConfig;
  /** The open repository's GitHub repository, when its host is trusted. */
  repo: () => GitHubRepo | null;
  /** The remote read as a GitHub repository, trusted or not (to say why it is unavailable). */
  parsedRepo: () => GitHubRepo | null;
  token: (envVar: string) => string | null;
  lifecycle: () => GitHubLifecycle;
  /** Runs or jobs changed: what shows them reads again. */
  onDataChange: () => void;
}

export function createGitHubService(ports: GitHubServicePorts) {
  const { app } = ports;
  const lifecycle = () => ports.lifecycle();

  /** SHA → all runs for that commit. */
  let commitDataCache = new Map<string, GitHubCommitData>();
  /** runId → jobs (pre-populated from GraphQL; REST fallback for on-demand fetches) */
  const jobsCache = new Map<number, GitHubJob[]>();
  /**
   * runId → the run's `updatedAt` its cached jobs belong to. A re-run keeps the run id but changes the run, so jobs
   * cached for an earlier version are not reused for it.
   */
  const jobsRunVersion = new Map<number, string>();
  const cacheJobs = (run: Pick<GitHubWorkflowRun, "id" | "updatedAt">, jobs: GitHubJob[]) => {
    jobsCache.set(run.id, jobs);
    jobsRunVersion.set(run.id, run.updatedAt);
  };
  /** The cached jobs, when they belong to this version of the run. */
  const cachedJobsFor = (run: GitHubWorkflowRun) =>
    jobsRunVersion.get(run.id) === run.updatedAt ? jobsCache.get(run.id) : undefined;
  /** Commits already asked about: new ones are caught up quietly, a Reload asks again. */
  const queriedSHAs = new Set<string>();
  /** After a 401: no automatic requests until a Reload. */
  let authFrozen = false;
  /** The open pull requests and those merged or closed most recently, each list as last read (kept on a failure). */
  let pullRequests: GitHubPullRequest[] = [];
  let closedPullRequests: GitHubPullRequest[] = [];
  /** Whether a list was read for this repository: the first fetch reads one, refreshes and Reloads read it again. */
  let pullsRead = false;
  /**
   * The pull request lists on their way: a newer read stops them (an older answer never overwrites a newer one), and
   * so does a reset. They run beside the fetch of the runs, outside the lifecycle's own requests.
   */
  let pullsRequest: AbortController | null = null;
  /** Skip unsupported WorkflowRun.jobs after the first retry. */
  let jobsUnsupported = false;

  function rememberAuthError(failure: ProviderFailure | undefined): void {
    if (failure === "auth") authFrozen = true;
  }

  const isAvailable = (): boolean => {
    const config = ports.config();
    if (!config.enabled) return false;
    if (!ports.repo()) return false;
    return ports.token(config.tokenEnvVar) !== null;
  };

  function publishBadges() {
    const cachedRuns = [...commitDataCache.values()].flatMap(data => data.runs);
    app.setBadges(buildGraphBadges(cachedRuns));
  }

  /** Fetch CI data for the given SHAs and merge results into caches. The caller dedups and filters. */
  async function fetchForSHAs(
    shas: string[],
    signal?: AbortSignal,
  ): Promise<{ firstError: string | null; failure?: ProviderFailure; failedSHAs: string[] }> {
    const epoch = lifecycle().getEpoch();
    const repoPath = app.repoPath();
    if (!lifecycle().isCurrent(epoch, repoPath)) return { firstError: null, failedSHAs: [] };
    if (shas.length === 0) return { firstError: null, failedSHAs: [] };
    const repo = ports.repo();
    const token = ports.token(ports.config().tokenEnvVar);
    if (!repo || !token) return { firstError: null, failedSHAs: [] };

    // Split into batches of GQL_BATCH_SIZE and fire in parallel
    const batches: string[][] = [];
    for (let i = 0; i < shas.length; i += GQL_BATCH_SIZE) batches.push(shas.slice(i, i + GQL_BATCH_SIZE));
    const results = await Promise.all(
      batches.map(batch => ports.api.fetchCIDataForSHAs(repo, token, batch, { signal, includeJobs: !jobsUnsupported })),
    );
    if (signal?.aborted || !lifecycle().isCurrent(epoch, repoPath)) return { firstError: null, failedSHAs: [] };

    if (!jobsUnsupported && results.some(result => result.jobsUnsupported)) {
      jobsUnsupported = true;
      addDebugEvent({
        source: "GitHub",
        status: "info",
        message: "GraphQL workflow jobs unavailable. Using REST on expand.",
      });
    }
    const failed = results.find(r => r.error);
    const firstError = failed?.error ?? null;
    const failedSHAs: string[] = [];
    for (let i = 0; i < results.length; i++) if (results[i]?.error) failedSHAs.push(...(batches[i] ?? []));
    const failedShaSet = new Set(failedSHAs);

    // Merge all batch results (include successful batches even if others errored)
    const allRuns: GitHubWorkflowRun[] = [];
    for (const result of results) {
      allRuns.push(...result.data);
      for (const [runId, jobs] of result.jobs) {
        const listed = result.data.find(candidate => candidate.id === runId);
        if (jobs.length > 0 && listed) cacheJobs(listed, jobs);
      }
    }
    const newCommitData = buildCommitDataMap(allRuns);
    for (const sha of shas) {
      if (failedShaSet.has(sha)) continue;
      const incoming = newCommitData.get(sha)?.runs ?? [];
      const existing = commitDataCache.get(sha)?.runs ?? [];
      commitDataCache.set(sha, { sha, runs: mergeGitHubRuns(existing, incoming) });
    }
    ports.onDataChange();
    publishBadges();
    await persistTerminalRuns(repoPath, shas, epoch);
    return { firstError, failure: failed?.failure, failedSHAs };
  }

  /**
   * The open pull requests and the ones merged or closed most recently, read with each fetch of the window (two
   * requests side by side). A list that fails keeps its last one and only goes to Debug (the API port says why, once):
   * the runs say what is wrong with the token or the host.
   */
  async function fetchPullRequests(signal?: AbortSignal): Promise<void> {
    const epoch = lifecycle().getEpoch();
    const repoPath = app.repoPath();
    const repo = ports.repo();
    const token = ports.token(ports.config().tokenEnvVar);
    if (!repo || !token) return;
    pullsRequest?.abort();
    const request = new AbortController();
    pullsRequest = request;
    const stop = () => request.abort();
    signal?.addEventListener("abort", stop, { once: true });
    // Aborted (with the fetch they run beside, by a newer read, by a reset): nothing to say.
    const [open, closed] = await Promise.all([
      ports.api.fetchOpenPullRequests(repo, token, request.signal).catch(() => null),
      ports.api.fetchClosedPullRequests(repo, token, request.signal).catch(() => null),
    ]);
    signal?.removeEventListener("abort", stop);
    if (pullsRequest === request) pullsRequest = null;
    if (request.signal.aborted || !lifecycle().isCurrent(epoch, repoPath)) return;
    if (open && !open.error) {
      pullRequests = open.data;
      pullsRead = true;
    }
    if (closed && !closed.error) closedPullRequests = closed.data;
    ports.onDataChange();
  }

  /**
   * Read cached commits from disk (no network). With `everyCached`, also the commits below the fetch depth: the
   * cache limit decides how many commits keep their runs, the fetch depth only how many GitHub is asked about.
   * Those are peeked, not read, so showing them does not count as a use for eviction.
   */
  async function hydrateCachedCandidates(
    repoPath: string,
    shas: readonly string[],
    epoch: number,
    everyCached = false,
  ): Promise<void> {
    if (!lifecycle().isCurrent(epoch, repoPath)) return;
    const disk = ports.cache();
    const pending = shas.filter(sha => !commitDataCache.has(sha));
    const [read, peeked] = await Promise.all([
      Promise.all(pending.map(async sha => ({ sha, entry: await disk.read(repoPath, sha) }))),
      everyCached ? disk.peekAll(repoPath) : Promise.resolve([]),
    ]);
    if (!lifecycle().isCurrent(epoch, repoPath)) return;
    const targets = new Set(pending);
    const entries = [
      ...read,
      ...peeked
        .map(entry => ({ sha: entry.sha.toLowerCase(), entry }))
        .filter(({ sha }) => !targets.has(sha) && !commitDataCache.has(sha)),
    ];
    let changed = false;
    for (const { sha, entry } of entries) {
      if (!entry) continue;
      commitDataCache.set(sha, { sha, runs: entry.runs });
      for (const [id, jobs] of Object.entries(entry.jobs ?? {})) {
        const listed = entry.runs.find(candidate => candidate.id === Number(id));
        if (listed && !jobsCache.has(listed.id)) cacheJobs(listed, jobs);
      }
      changed = true;
    }
    if (!changed) return;
    ports.onDataChange();
    publishBadges();
  }

  /** The finished runs of these commits, with the jobs read for them, into the cache (one write for all). */
  async function persistTerminalRuns(repoPath: string, shas: readonly string[], epoch: number): Promise<void> {
    const isCurrent = () => lifecycle().isCurrent(epoch, repoPath);
    if (!isCurrent()) return;
    const items = shas
      .map(sha => ({ sha, incoming: (commitDataCache.get(sha)?.runs ?? []).filter(isTerminalGitHubRun) }))
      .filter(item => item.incoming.length > 0);
    if (items.length === 0) return;
    await ports.cache().mergeMany(
      repoPath,
      items,
      (sha, existing, incoming: GitHubWorkflowRun[]) => {
        const fresh = new Map<number, GitHubJob[]>();
        for (const run of incoming) {
          const jobs = cachedJobsFor(run);
          if (jobs) fresh.set(run.id, jobs);
        }
        return mergeGitHubEntry(sha, existing, incoming, fresh);
      },
      isCurrent,
    );
  }

  // ── What the lifecycle runs ─────────────────────────────────────────────────────────────────────

  const reportUnavailable = (showStatus: boolean) => {
    if (!showStatus) return;
    const config = ports.config();
    const token = ports.token(config.tokenEnvVar);
    if (!config.enabled) app.setStatus(providerUnavailable(GITHUB_BANNER.disabled));
    else if (!ports.parsedRepo()) app.setStatus(providerUnavailable(GITHUB_BANNER.noRemote));
    else if (!ports.repo()) {
      const host = ports.parsedRepo()?.hostname;
      if (host) debugError("GitHub", `Untrusted host: ${host}`);
      app.setStatus(providerUnavailable(GITHUB_BANNER.untrustedHost));
    } else if (!token) app.setStatus(providerUnavailable(GITHUB_BANNER.missingToken(config.tokenEnvVar)));
  };

  const runInitialFetch = async ({ signal, shas, showStatus, retry, epoch }: ProviderFetchArgs) => {
    if (authFrozen && !retry) return;
    if (retry) authFrozen = false;
    const allSHAs = shas ?? collectTopSHAs(app.graphRows(), ports.config().fetchDepth);
    const repoPath = app.repoPath();
    await hydrateCachedCandidates(repoPath, allSHAs, epoch, true);
    if (signal?.aborted || !lifecycle().isCurrent(epoch, repoPath)) return;
    // An explicit retry asks again for every target, also when a fetch it waited behind just marked them queried.
    const unqueried = retry ? allSHAs : allSHAs.filter(sha => !queriedSHAs.has(sha));
    lifecycle().noteFetchStarted();
    // The pull requests on the first fetch and on a Reload (a refresh reads them again too), beside the runs: they
    // never hold up what the runs say.
    if (!pullsRead || retry) void fetchPullRequests(signal);
    if (unqueried.length === 0) return;
    if (showStatus) app.setStatus(providerLoading());
    try {
      const { firstError, failure, failedSHAs } = await fetchForSHAs(unqueried, signal);
      if (signal?.aborted || !lifecycle().isCurrent(epoch, repoPath)) return;
      for (const sha of unqueried) queriedSHAs.add(sha);
      for (const sha of failedSHAs) queriedSHAs.delete(sha);
      rememberAuthError(failure);
      lifecycle().noteFetchResult(!firstError);
      if (!firstError) app.noteSuccess();
      // An error shows also from a background fetch (like Jenkins): the runs would otherwise look not loaded yet.
      if (firstError) app.setStatus(providerError(firstError));
      else if (showStatus || app.status().kind === "error") app.setStatus(providerIdle());
    } catch (err) {
      if (signal?.aborted) return;
      const message = bannerOrFallback(err, GITHUB_BANNER.fetchFailed, "GitHub");
      rememberAuthError(failureOf(err));
      lifecycle().noteFetchResult(false);
      app.setStatus(providerError(message));
      for (const sha of unqueried) queriedSHAs.delete(sha);
    }
  };

  const runRefresh = async ({ signal, retry, epoch }: ProviderFetchArgs) => {
    const repoPath = app.repoPath();
    if (authFrozen && !retry) return;
    if (retry) authFrozen = false;
    lifecycle().noteRefreshSettled();
    // The runs still running (its own badges: on the dashboard, the shown view's are none), and the newest commits,
    // where a workflow may have started since (a deploy, a re-run): one query for both.
    const runningSHAs = collectRunningSHAs(app.badges());
    const shas = [...new Set([...runningSHAs, ...collectTopSHAs(app.graphRows(), ports.config().fetchDepth)])];
    if (shas.length === 0) return;
    try {
      void fetchPullRequests(signal);
      const { firstError, failure } = await fetchForSHAs(shas, signal);
      if (signal?.aborted || !lifecycle().isCurrent(epoch, repoPath)) return;
      rememberAuthError(failure);
      lifecycle().noteFetchResult(!firstError);
      if (!firstError) app.noteSuccess();
      // Like Jenkins: a failed refresh is visible (cached runs stay), not only in Debug.
      if (firstError) app.setStatus(providerError(firstError));
      else if (app.status().kind === "error") app.setStatus(providerIdle());
      if (firstError) debugError("GitHub", firstError);
    } catch (err) {
      if (signal?.aborted) return;
      lifecycle().noteFetchResult(false);
      debugError("GitHub", err);
    }
  };

  const onResetCaches = () => {
    commitDataCache = new Map();
    jobsCache.clear();
    jobsRunVersion.clear();
    queriedSHAs.clear();
    pullsRequest?.abort();
    pullsRequest = null;
    pullRequests = [];
    closedPullRequests = [];
    pullsRead = false;
    authFrozen = false;
    jobsUnsupported = false;
    ports.onDataChange();
    app.setBadges(new Map());
    app.setStatus(providerIdle());
  };

  // ── What the app asks ───────────────────────────────────────────────────────────────────────────

  /** Reload: the graph's window asked again, showing status. */
  async function refreshWindow(): Promise<void> {
    if (app.suspended()) return;
    const window = collectTopSHAs(app.graphRows(), ports.config().fetchDepth);
    await lifecycle().fetchInitial(undefined, window, true, true);
    if (app.view() === "github-actions") lifecycle().startAutoRefresh();
  }

  /** One commit's runs: from the cache, and with `force` asked of GitHub again. */
  async function fetchCommitDataForSHA(sha: string, force = false): Promise<void> {
    const epoch = lifecycle().getEpoch();
    const repoPath = app.repoPath();
    await hydrateCachedCandidates(repoPath, [sha], epoch);
    if (!lifecycle().isCurrent(epoch, repoPath)) return;
    if (!force) return;
    await lifecycle().fetchInitial(undefined, [sha], true, true);
  }

  /** Failed jobs say why: their annotations are read once (a job is a check run) and kept with the job. */
  const latestAttempt = (jobs: readonly GitHubJob[]) =>
    jobs.reduce((max, job) => Math.max(max, job.runAttempt ?? 1), 1);
  /** Only the latest attempt's failed jobs: earlier attempts are history, folded away in the tree. */
  const annotationsMissing = (jobs: readonly GitHubJob[]) => {
    const latest = latestAttempt(jobs);
    return (job: GitHubJob) =>
      job.conclusion === "failure" && job.annotations === undefined && (job.runAttempt ?? 1) === latest;
  };
  async function withAnnotations(jobs: GitHubJob[], signal?: AbortSignal): Promise<GitHubJob[]> {
    const needsAnnotations = annotationsMissing(jobs);
    if (!jobs.some(needsAnnotations)) return jobs;
    const repo = ports.repo();
    const token = ports.token(ports.config().tokenEnvVar);
    if (!repo || !token || authFrozen) return jobs;
    return Promise.all(
      jobs.map(async job => {
        if (!needsAnnotations(job)) return job;
        const annotations = await lifecycle().runRequest(
          requestSignal => ports.api.fetchJobAnnotations(repo, token, job.id, requestSignal),
          signal,
        );
        return annotations ? { ...job, annotations } : job;
      }),
    );
  }

  /** A run's jobs: from the cache once every job and step finished, else asked of GitHub. */
  async function fetchJobsForRun(run: GitHubWorkflowRun, signal?: AbortSignal): Promise<GitHubJobFetchResult> {
    const epoch = lifecycle().getEpoch();
    const repoPath = app.repoPath();
    // Only finished jobs are final; a cached snapshot with a running job or step is fetched again, and so is one of
    // an earlier version of the run (a re-run keeps its id).
    const cached = cachedJobsFor(run);
    // Jobs listed by GraphQL (or cached before v0.17) carry no attempt: REST is asked once, to learn about re-runs.
    const attemptsKnown = !!cached && cached.every(job => job.runAttempt !== undefined);
    if (cached && run.status === "completed" && jobsSettled(cached) && attemptsKnown) {
      if (!cached.some(annotationsMissing(cached))) return { jobs: cached, error: null };
      const annotated = await withAnnotations(cached, signal);
      if (signal?.aborted || !lifecycle().isCurrent(epoch, repoPath)) return { jobs: [], error: null };
      if (annotated.some((job, index) => job !== cached[index])) {
        cacheJobs(run, annotated);
        await persistTerminalRuns(repoPath, [run.headSha], epoch);
      }
      return { jobs: annotated, error: null };
    }
    if (!lifecycle().isCurrent(epoch, repoPath)) return { jobs: [], error: null };
    // Finished GraphQL jobs still show when REST cannot be asked about attempts.
    const fallback = cached && jobsSettled(cached) ? { jobs: cached, error: null } : null;
    // Frozen after a 401: no requests until Reload; say why instead of asking GitHub again.
    if (authFrozen) return fallback ?? { jobs: [], error: GITHUB_BANNER.tokenExpired };

    const repo = ports.repo();
    const token = ports.token(ports.config().tokenEnvVar);
    if (!repo || !token) return fallback ?? { jobs: [], error: GITHUB_BANNER.unavailable };

    const fetched = await lifecycle().runRequest(signal => ports.api.fetchRunJobs(repo, token, run.id, signal), signal);
    if (signal?.aborted || !lifecycle().isCurrent(epoch, repoPath)) return { jobs: [], error: null };
    if (fetched.error) return fallback ?? fetched;
    // REST lists every attempt, so its jobs know theirs (1 where the host does not say).
    const listed = fetched.jobs.map(job => (job.runAttempt === undefined ? { ...job, runAttempt: 1 } : job));
    const jobs = await withAnnotations(listed, signal);
    if (signal?.aborted || !lifecycle().isCurrent(epoch, repoPath)) return { jobs: [], error: null };
    if (run.status === "completed" && jobsSettled(jobs)) {
      cacheJobs(run, jobs);
      await persistTerminalRuns(repoPath, [run.headSha], epoch);
    }
    return { jobs, error: null };
  }

  /** A job's log: a finished run's from the cache, else from GitHub (and kept once the run finished). */
  async function fetchJobLogForJob(
    jobId: number,
    run: { headSha: string; status: string },
    signal?: AbortSignal,
  ): Promise<string> {
    const epoch = lifecycle().getEpoch();
    const repoPath = app.repoPath();
    if (!lifecycle().isCurrent(epoch, repoPath)) return "";
    const key = String(jobId);
    const disk = ports.cache();
    if (isTerminalGitHubRun(run)) {
      const diskLog = await disk.readLog(repoPath, run.headSha, key).catch(() => null);
      if (!lifecycle().isCurrent(epoch, repoPath)) return "";
      if (diskLog) return diskLog;
    }
    const repo = ports.repo();
    const config = ports.config();
    const token = ports.token(config.tokenEnvVar);
    if (!repo || !token)
      throw new Error(token ? GITHUB_BANNER.noRemote : GITHUB_BANNER.missingToken(config.tokenEnvVar));
    const log = await lifecycle().runRequest(signal => ports.api.fetchJobLog(repo, token, jobId, signal), signal);
    if (!lifecycle().isCurrent(epoch, repoPath)) return "";
    if (isTerminalGitHubRun(run) && log && lifecycle().isCurrent(epoch, repoPath))
      await disk.writeLog(repoPath, run.headSha, key, log).catch(() => {});
    return log;
  }

  return {
    /** A commit's runs, or null before any were read. Not reactive: the adapter makes it so. */
    getCommitData: (sha: string) => commitDataCache.get(sha) ?? null,
    /** The open pull requests whose branch points at this commit, by number. Not reactive: the adapter makes it so. */
    pullRequestsAt: (sha: string): GitHubPullRequest[] =>
      pullRequests.filter(pr => pr.headSha.toLowerCase() === sha.toLowerCase()).sort((a, b) => a.number - b.number),
    /** The merged or closed ones whose branch pointed at this commit, last ended first. Not reactive. */
    closedPullRequestsAt: (sha: string): GitHubPullRequest[] =>
      closedPullRequests
        .filter(pr => pr.headSha.toLowerCase() === sha.toLowerCase())
        .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "")),
    /** Every pull request it holds, open and recently ended: the Dashboard's events. Not reactive. */
    heldPullRequests: (): GitHubPullRequest[] => [...pullRequests, ...closedPullRequests],
    /** Every run held for the open repository. Not reactive: the adapter makes it so. */
    heldEntries: () => [...commitDataCache.values()],
    queriedSHAs,
    isAvailable,
    reportUnavailable,
    runInitialFetch,
    runRefresh,
    onResetCaches,
    refreshWindow,
    fetchCommitDataForSHA,
    fetchJobsForRun,
    fetchJobLogForJob,
  };
}

export type GitHubService = ReturnType<typeof createGitHubService>;
