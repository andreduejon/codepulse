import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import type { AppActions, AppState } from "../../context/state";
import { createAppState } from "../../context/state";
import { buildGraph } from "../../git/graph";
import type { SnykScanOptions, SnykScanResult } from "./types";
import {
  collectSnykAutoScanTips,
  type SnykProviderConfig,
  selectSnykCacheProbes,
  snykDependencyStatus,
  type UseSnykResult,
  useSnyk,
} from "./use-snyk";

const TOKEN_ENV_VAR = "CODEPULSE_TEST_SNYK_TOKEN";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

type Scan = NonNullable<Parameters<typeof useSnyk>[0]["scan"]>;
type ReadCache = NonNullable<Parameters<typeof useSnyk>[0]["readCache"]>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

interface MountedSnyk {
  state: AppState;
  actions: AppActions;
  snyk: UseSnykResult;
  dispose: () => void;
  setSuspended: (value: boolean) => void;
}

const disposers: Array<() => void> = [];
let originalToken: string | undefined;

beforeEach(() => {
  originalToken = process.env[TOKEN_ENV_VAR];
  process.env[TOKEN_ENV_VAR] = "test-token";
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  if (originalToken === undefined) delete process.env[TOKEN_ENV_VAR];
  else process.env[TOKEN_ENV_VAR] = originalToken;
});

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

function result(sha: string, scannedAt = "2026-08-24T10:00:00.000Z"): SnykScanResult {
  return {
    sha,
    scannedAt,
    includesDev: true,
    dependencyProjects: [],
    counts: { critical: 0, high: 0, medium: 0, low: 0 },
    findings: [],
  };
}

function graphRows(shas: string[]) {
  return buildGraph(
    shas.map(hash => ({
      hash,
      shortHash: hash.slice(0, 7),
      parents: [],
      subject: "cached commit",
      body: "",
      author: "Author",
      authorEmail: "author@example.com",
      authorDate: "2026-01-01T00:00:00Z",
      committer: "Author",
      committerEmail: "author@example.com",
      commitDate: "2026-01-01T00:00:00Z",
      refs: [],
    })),
  );
}

function mountSnyk(options: {
  scan: Scan;
  readCache?: ReadCache;
  repoPath?: string;
  config?: Partial<SnykProviderConfig>;
  suspended?: boolean;
  setup?: (actions: AppActions) => void;
}): MountedSnyk {
  let mounted!: MountedSnyk;
  createRoot(dispose => {
    disposers.push(dispose);
    const { state, actions } = createAppState();
    actions.setRepoPath(options.repoPath ?? "/repo-a");
    options.setup?.(actions);
    const [config] = createSignal<Partial<SnykProviderConfig>>({
      enabled: true,
      tokenEnvVar: TOKEN_ENV_VAR,
      ...options.config,
    });
    const [suspended, setSuspended] = createSignal(options.suspended ?? false);
    const snyk = useSnyk({
      state,
      actions,
      config,
      suspended,
      scan: options.scan,
      readCache: options.readCache ?? (async () => null),
    });
    mounted = { state, actions, snyk, dispose, setSuspended };
  });
  return mounted;
}

describe("useSnyk", () => {
  test("scans without supported dependency projects warn in any tab while retaining findings", async () => {
    const { state, snyk } = mountSnyk({
      scan: async () => result(SHA_A),
      setup: actions => {
        actions.setActiveProviderView("snyk");
        actions.setGraphRows(graphRows([SHA_A]));
      },
    });
    await snyk.scanCommit(SHA_A);
    expect(snyk.getCommitData(SHA_A)).not.toBeNull();
    expect(state.providerStatusFor("snyk")).toEqual({
      kind: "warning",
      message: "No supported dependency project. Dependency graphs support Bun, npm, pnpm, Yarn, and Maven projects.",
    });
  });

  test("failed and skipped graphs warn with one summary without discarding valid findings", async () => {
    const scan = result(SHA_A);
    scan.dependencyProjects = [
      { targetFile: "pnpm-lock.yaml", packageManager: "pnpm", status: "scanned", graphs: [], reason: null },
      { targetFile: "web/bun.lock", packageManager: "bun", status: "skipped", graphs: [], reason: "Bun not found." },
      { targetFile: "api/yarn.lock", packageManager: "yarn", status: "failed", graphs: [], reason: "Graph failed." },
    ];
    const { state, snyk } = mountSnyk({ scan: async () => scan });
    await snyk.scanCommit(SHA_A);
    expect(snyk.getCommitData(SHA_A)).toEqual(scan);
    expect(state.providerStatusFor("snyk")).toEqual({
      kind: "warning",
      message: [
        "Snyk dependency graphs incomplete: 2 of 3 projects.",
        "web/bun.lock: Bun not found.",
        "api/yarn.lock: Graph failed.",
      ].join("\n"),
    });
  });

  test("complete dependency coverage clears the banner", () => {
    const scan = result(SHA_A);
    scan.dependencyProjects = [
      { targetFile: "pnpm-lock.yaml", packageManager: "pnpm", status: "scanned", graphs: [], reason: null },
    ];
    expect(snykDependencyStatus(scan)).toEqual({ kind: "idle" });
  });

  test("scan failures stay errors", async () => {
    const { state, snyk } = mountSnyk({
      scan: async () => {
        throw new Error("Snyk CLI not found on PATH. Install Snyk CLI to scan.");
      },
    });
    await snyk.scanCommit(SHA_A);
    expect(state.providerStatusFor("snyk")).toEqual({
      kind: "error",
      message: "Snyk CLI not found on PATH. Install Snyk CLI to scan.",
    });
  });

  test("suspension preserves results and badges, aborts scans, and drops queued work", async () => {
    const pending = deferred<SnykScanResult>();
    const calls: SnykScanOptions[] = [];
    const { state, snyk, setSuspended } = mountSnyk({
      setup: actions => actions.setActiveProviderView("snyk"),
      scan: options => {
        calls.push(options);
        return options.sha === SHA_B ? pending.promise : Promise.resolve(result(options.sha));
      },
    });
    await snyk.scanCommit(SHA_A);
    const badges = state.graphBadges();
    const active = snyk.scanCommit(SHA_B);
    const queued = snyk.scanCommit(SHA_C);
    setSuspended(true);
    expect(calls[1].signal?.aborted).toBe(true);
    expect(await queued).toBeNull();
    expect(snyk.isScanning(SHA_B)).toBe(false);
    expect(snyk.isScanning(SHA_C)).toBe(false);
    expect(snyk.getCommitData(SHA_A)).toEqual(result(SHA_A));
    expect(state.graphBadges()).toEqual(badges);
    expect(snyk.isAvailable()).toBe(true);
    expect(await snyk.scanCommit(SHA_C, true)).toBeNull();
    expect(calls).toHaveLength(2);

    setSuspended(false);
    pending.resolve(result(SHA_B));
    expect(await active).toBeNull();
    expect(snyk.getCommitData(SHA_B)).toBeNull();
    expect(calls).toHaveLength(2);
    await snyk.scanCommit(SHA_C);
    expect(snyk.getCommitData(SHA_C)).toEqual(result(SHA_C));
  });

  test("suspension stops pending hydration batches without clearing already loaded scans", async () => {
    const shas = Array.from({ length: 80 }, (_, index) => index.toString(16).padStart(40, "0"));
    const reads: string[] = [];
    const { snyk, actions, setSuspended } = mountSnyk({
      setup: actions => actions.setGraphRows(graphRows(shas)),
      readCache: async (_repo, sha) => {
        reads.push(sha);
        return result(sha);
      },
      scan: async options => result(options.sha),
    });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(snyk.getCommitData(shas[0])).toEqual(result(shas[0]));
    setSuspended(true);
    actions.setGraphRows(graphRows([...shas, SHA_A]));
    await Bun.sleep(10);
    expect(reads).toHaveLength(20);
    expect(snyk.getCommitData(shas[0])).toEqual(result(shas[0]));
    setSuspended(false);
    await Bun.sleep(30);
    expect(snyk.getCommitData(shas[79])).toEqual(result(shas[79]));
    expect(snyk.getCommitData(SHA_A)).toEqual(result(SHA_A));
  });

  test("ignores hydration completions from before suspension even after resume", async () => {
    const pending = deferred<SnykScanResult | null>();
    let reads = 0;
    const { snyk, setSuspended } = mountSnyk({
      setup: actions => actions.setGraphRows(graphRows([SHA_A])),
      readCache: () => (++reads === 1 ? pending.promise : Promise.resolve(null)),
      scan: async options => result(options.sha),
    });
    setSuspended(true);
    setSuspended(false);
    pending.resolve(result(SHA_A));
    await Bun.sleep(0);
    expect(reads).toBe(2);
    expect(snyk.getCommitData(SHA_A)).toBeNull();
  });

  test("paused auto scans and explicit invalidation wait for resume without duplicating completed scans", async () => {
    let reads = 0;
    const calls: SnykScanOptions[] = [];
    const { snyk, setSuspended } = mountSnyk({
      suspended: true,
      config: { autoScanBranches: ["main"] },
      setup: actions => {
        actions.setActiveProviderView("snyk");
        actions.setGraphRows(graphRows([SHA_A]));
        actions.setBranches([{ name: "main", isCurrent: true, isRemote: false, lastCommitHash: SHA_A }]);
      },
      readCache: async () => {
        reads++;
        return null;
      },
      scan: async options => {
        calls.push(options);
        return result(options.sha);
      },
    });
    await Bun.sleep(0);
    expect(reads).toBe(0);
    expect(calls).toHaveLength(0);
    setSuspended(false);
    await Bun.sleep(0);
    expect(calls).toHaveLength(1);
    setSuspended(true);
    setSuspended(false);
    await Bun.sleep(0);
    expect(calls).toHaveLength(1);
    setSuspended(true);
    const before = reads;
    snyk.invalidate();
    expect(snyk.getCommitData(SHA_A)).toBeNull();
    await Bun.sleep(0);
    expect(reads).toBe(before);
    expect(calls).toHaveLength(1);
    setSuspended(false);
    await Bun.sleep(0);
    expect(calls).toHaveLength(2);
  });

  test("a late auto-scan cache miss cannot enqueue a duplicate scan after resume", async () => {
    const pending = deferred<SnykScanResult | null>();
    let reads = 0;
    let scans = 0;
    const { setSuspended } = mountSnyk({
      config: { autoScanBranches: ["main"] },
      setup: actions => {
        actions.setActiveProviderView("snyk");
        actions.setBranches([{ name: "main", isCurrent: true, isRemote: false, lastCommitHash: SHA_A }]);
      },
      readCache: () => (++reads === 1 ? pending.promise : Promise.resolve(null)),
      scan: async options => {
        scans++;
        return result(options.sha);
      },
    });
    setSuspended(true);
    setSuspended(false);
    await Bun.sleep(0);
    pending.resolve(null);
    await Bun.sleep(0);
    expect(scans).toBe(1);
  });

  test("deduplicates concurrent scans for the same SHA", async () => {
    const pending = deferred<SnykScanResult>();
    const calls: SnykScanOptions[] = [];
    const scan: Scan = options => {
      calls.push(options);
      return pending.promise;
    };
    const { snyk } = mountSnyk({ scan });

    const first = snyk.scanCommit(SHA_A);
    const second = snyk.scanCommit(SHA_A.toUpperCase());

    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
    expect(snyk.isScanning(SHA_A)).toBe(true);

    const scanResult = result(SHA_A);
    pending.resolve(scanResult);
    expect(await first).toEqual(scanResult);
    expect(await second).toEqual(scanResult);
    expect(snyk.isScanning(SHA_A)).toBe(false);
    expect(snyk.getCommitData(SHA_A)).toEqual(scanResult);
  });

  test("executes distinct scans sequentially", async () => {
    const calls: Array<{ options: SnykScanOptions; pending: Deferred<SnykScanResult> }> = [];
    const scan: Scan = options => {
      const pending = deferred<SnykScanResult>();
      calls.push({ options, pending });
      return pending.promise;
    };
    const { snyk } = mountSnyk({ scan });

    const first = snyk.scanCommit(SHA_A);
    const second = snyk.scanCommit(SHA_B);

    expect(calls.map(call => call.options.sha)).toEqual([SHA_A]);
    expect(snyk.isScanning(SHA_A)).toBe(true);
    expect(snyk.isScanning(SHA_B)).toBe(true);

    calls[0].pending.resolve(result(SHA_A));
    await first;
    expect(calls.map(call => call.options.sha)).toEqual([SHA_A, SHA_B]);

    calls[1].pending.resolve(result(SHA_B));
    await second;
    expect(snyk.isScanning(SHA_A)).toBe(false);
    expect(snyk.isScanning(SHA_B)).toBe(false);
  });

  test("upgrades a queued same-SHA scan to force", async () => {
    const calls: Array<{ options: SnykScanOptions; pending: Deferred<SnykScanResult> }> = [];
    const scan: Scan = options => {
      const pending = deferred<SnykScanResult>();
      calls.push({ options, pending });
      return pending.promise;
    };
    const { snyk } = mountSnyk({ scan });

    const active = snyk.scanCommit(SHA_A);
    const queued = snyk.scanCommit(SHA_B);
    const forced = snyk.scanCommit(SHA_B, true);

    expect(forced).toBe(queued);
    expect(calls).toHaveLength(1);

    calls[0].pending.resolve(result(SHA_A));
    await active;
    expect(calls).toHaveLength(2);
    expect(calls[1].options).toMatchObject({ sha: SHA_B, force: true });

    calls[1].pending.resolve(result(SHA_B));
    expect(await queued).toEqual(result(SHA_B));
  });

  test("probes only unseen cache SHAs", () => {
    expect(selectSnykCacheProbes([SHA_A, SHA_B, SHA_C], new Set([SHA_A]), new Set([SHA_C]))).toEqual([SHA_B]);
  });

  test("hydrates 500 cached scans in yielding batches without remote scans", async () => {
    const shas = Array.from({ length: 500 }, (_, index) => index.toString(16).padStart(40, "0"));
    const reads: string[] = [];
    let scans = 0;
    const { snyk } = mountSnyk({
      config: { maxCachedScans: 500 },
      setup: actions => actions.setGraphRows(graphRows(shas)),
      readCache: async (_repo, sha) => {
        reads.push(sha);
        return result(sha);
      },
      scan: async options => {
        scans++;
        return result(options.sha);
      },
    });
    const countAtYield = await new Promise<number>(resolve => setTimeout(() => resolve(reads.length), 0));
    expect(countAtYield).toBeGreaterThan(0);
    expect(countAtYield).toBeLessThan(500);
    const deadline = Date.now() + 5_000;
    while (!snyk.getCommitData(shas[499]) && Date.now() < deadline) await Bun.sleep(1);
    expect(reads).toHaveLength(500);
    expect(snyk.getCommitData(shas[0])).toEqual(result(shas[0]));
    expect(snyk.getCommitData(shas[499])).toEqual(result(shas[499]));
    expect(scans).toBe(0);
  });

  test("stops queued hydration batches after disposal", async () => {
    const shas = Array.from({ length: 80 }, (_, index) => index.toString(16).padStart(40, "0"));
    const reads: string[] = [];
    const { dispose } = mountSnyk({
      setup: actions => actions.setGraphRows(graphRows(shas)),
      readCache: async (_repo, sha) => {
        reads.push(sha);
        return result(sha);
      },
      scan: async options => result(options.sha),
    });
    await Promise.resolve();
    await Promise.resolve();
    dispose();
    await Bun.sleep(10);
    expect(reads).toHaveLength(20);
  });

  test("does not auto-scan configured branch tips on the Git view", async () => {
    const calls: SnykScanOptions[] = [];
    const scan: Scan = options => {
      calls.push(options);
      return Promise.resolve(result(options.sha));
    };
    mountSnyk({
      scan,
      config: { autoScanBranches: ["main"] },
      setup: next => {
        next.setBranches([{ name: "main", isCurrent: true, isRemote: false, lastCommitHash: SHA_A }]);
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(0);
  });

  test("selects unique configured local branch tips", () => {
    expect(
      collectSnykAutoScanTips(
        [
          { name: "main", isRemote: false, lastCommitHash: SHA_A },
          { name: "release", isRemote: false, lastCommitHash: SHA_B },
          { name: "duplicate", isRemote: false, lastCommitHash: SHA_A },
          { name: "main", isRemote: true, lastCommitHash: SHA_C },
        ],
        ["main", "release", "duplicate"],
      ),
    ).toEqual([SHA_A, SHA_B]);
  });

  test("reports unavailable and does not scan when the token is missing", async () => {
    delete process.env[TOKEN_ENV_VAR];
    const calls: SnykScanOptions[] = [];
    const scan: Scan = async options => {
      calls.push(options);
      return result(options.sha);
    };
    const { state, snyk } = mountSnyk({ scan });

    expect(snyk.isAvailable()).toBe(false);
    expect(await snyk.scanCommit(SHA_A)).toBeNull();
    expect(calls).toHaveLength(0);
    expect(state.providerStatusFor("snyk")).toEqual({
      kind: "unavailable",
      message: `Snyk unavailable. Missing ${TOKEN_ENV_VAR}.`,
    });
  });

  test("aborts the active scan and ignores its result after disposal", async () => {
    const pending = deferred<SnykScanResult>();
    let signal: AbortSignal | undefined;
    const scan: Scan = options => {
      signal = options.signal;
      return pending.promise;
    };
    const { dispose, snyk } = mountSnyk({ scan });

    const active = snyk.scanCommit(SHA_A);
    expect(signal?.aborted).toBe(false);

    dispose();
    expect(signal?.aborted).toBe(true);
    expect(snyk.isScanning(SHA_A)).toBe(false);

    pending.resolve(result(SHA_A));
    await active;
    expect(snyk.getCommitData(SHA_A)).toBeNull();
  });

  test("uses captured repository path and ignores result after invalidation", async () => {
    const pending = deferred<SnykScanResult>();
    const calls: SnykScanOptions[] = [];
    const scan: Scan = options => {
      calls.push(options);
      return pending.promise;
    };
    const { actions, snyk } = mountSnyk({ scan, repoPath: "/repo-a" });

    const active = snyk.scanCommit(SHA_A);
    actions.setRepoPath("/repo-b");
    snyk.invalidate();
    pending.resolve(result(SHA_A));
    await active;

    expect(calls[0].repoPath).toBe("/repo-a");
    expect(snyk.getCommitData(SHA_A)).toBeNull();
  });
});
