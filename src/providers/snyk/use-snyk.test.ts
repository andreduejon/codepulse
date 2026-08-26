import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import type { AppActions, AppState } from "../../context/state";
import { createAppState } from "../../context/state";
import type { SnykScanOptions, SnykScanResult } from "./types";
import {
  collectSnykAutoScanTips,
  type SnykProviderConfig,
  selectSnykCacheProbes,
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
    counts: { critical: 0, high: 0, medium: 0, low: 0 },
    findings: [],
  };
}

function mountSnyk(options: {
  scan: Scan;
  readCache?: ReadCache;
  repoPath?: string;
  config?: Partial<SnykProviderConfig>;
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
    const snyk = useSnyk({
      state,
      actions,
      config,
      scan: options.scan,
      readCache: options.readCache ?? (async () => null),
    });
    mounted = { state, actions, snyk, dispose };
  });
  return mounted;
}

describe("useSnyk", () => {
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
});
