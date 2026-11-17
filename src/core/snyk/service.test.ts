/** The Snyk service without Solid: the app is a plain object, the scanner and the cache are fakes. */
import { expect, mock, test } from "bun:test";
import type { ProviderStatus } from "../../context/app-state-types";
import type { GraphRow } from "../../git/types";
import type { GraphBadge } from "../../providers/provider";
import type { SnykScanResult } from "../../providers/snyk/types";
import { createSnykService, type SnykServicePorts } from "./service";

const SHA = "c".repeat(40);

function harness(view = "snyk") {
  const app = {
    status: { kind: "idle" } as ProviderStatus,
    badges: new Map<string, GraphBadge>(),
    view,
  };
  let finish!: (result: SnykScanResult) => void;
  let fail!: (error: Error) => void;
  const scan = mock(
    () =>
      new Promise<SnykScanResult>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
  );
  const backgroundErrors: ({ sha: string; message: string } | null)[] = [];
  const service = createSnykService({
    app: {
      repoPath: () => "/repo",
      graphRows: () => [] as GraphRow[],
      badges: () => app.badges,
      status: () => app.status,
      setStatus: status => {
        app.status = status;
      },
      setBadges: badges => {
        app.badges = badges;
      },
      noteSuccess: () => {},
      suspended: () => false,
      view: () => app.view,
    },
    config: () => ({ enabled: true, tokenEnvVar: "SNYK_TOKEN", autoScanBranches: [], maxCachedScans: 50 }),
    hasToken: () => true,
    scan: scan as unknown as SnykServicePorts["scan"],
    readCache: async () => null,
    onResultsChange: () => {},
    onScanningChange: () => {},
    onWorkChange: () => {},
    onBackgroundError: failed => backgroundErrors.push(failed),
  });
  return {
    app,
    scan,
    service,
    backgroundErrors,
    finish: (r: SnykScanResult) => finish(r),
    fail: (e: Error) => fail(e),
  };
}

const result = (): SnykScanResult => ({
  sha: SHA,
  scannedAt: "2026-03-02T09:00:00Z",
  includesDev: true,
  dependencyProjects: [],
  counts: { critical: 1, high: 0, medium: 0, low: 0 },
  findings: [],
});

test("a second request for the same commit waits for the first scan, and its result shows", async () => {
  const h = harness();
  const first = h.service.scanCommit(SHA);
  const second = h.service.scanCommit(SHA.toUpperCase());
  expect(h.service.isScanning(SHA)).toBe(true);
  expect(h.app.status.kind).toBe("loading");
  await Promise.resolve();
  h.finish(result());
  expect(await first).toEqual(await second);
  expect(h.scan).toHaveBeenCalledTimes(1);
  expect(h.service.getCommitData(SHA)?.sha).toBe(SHA);
  expect(h.app.badges.has(SHA)).toBe(true);
  expect(h.service.isScanning(SHA)).toBe(false);
  expect(h.app.status.kind).toBe("idle");
});

test("a scan that fails while another view shows keeps its error until that commit scans", async () => {
  const h = harness("git");
  const failed = h.service.scanCommit(SHA);
  await Promise.resolve();
  h.fail(new Error("Snyk failed"));
  expect(await failed).toBeNull();
  expect(h.backgroundErrors.at(-1)).toEqual({ sha: SHA, message: "Snyk failed" });
  const again = h.service.scanCommit(SHA);
  await Promise.resolve();
  h.finish(result());
  await again;
  expect(h.backgroundErrors.at(-1)).toBeNull();
});

test("a commit that isn't a full hash is refused without scanning", async () => {
  const h = harness();
  expect(await h.service.scanCommit("abc123")).toBeNull();
  expect(h.scan).not.toHaveBeenCalled();
  expect(h.app.status.kind).toBe("error");
});
