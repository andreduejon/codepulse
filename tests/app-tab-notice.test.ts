import { describe, expect, test } from "bun:test";
import { isTabNoticeStatus, tabNoticeFor } from "../src/app-tab-notice";
import type { ProviderStatus } from "../src/context/state";
import { BANNER } from "../src/debug/banner";
import type { ProviderView } from "../src/providers/provider";
import type { SnykScanResult } from "../src/providers/snyk/types";

const scan: SnykScanResult = {
  sha: "a".repeat(40),
  scannedAt: "2026-10-26T10:00:00.000Z",
  includesDev: true,
  dependencyProjects: [
    { targetFile: "package.json", packageManager: "npm", status: "scanned", graphs: [], reason: null },
    {
      targetFile: "web/package.json",
      packageManager: "npm",
      status: "failed",
      graphs: [],
      reason: "Missing node_modules folder.",
    },
  ],
  counts: { critical: 0, high: 0, medium: 0, low: 0 },
  findings: [],
  partial: true,
  failedProjects: 1,
  failedTargets: ["web/package.json"],
};

const idle: ProviderStatus = { kind: "idle" };
const notice = (
  view: string,
  source: string,
  status: ProviderStatus,
  tab: string,
  snykScan = null as typeof scan | null,
) => tabNoticeFor({ view: view as ProviderView, source, status, tab: tab as never, snykScan });

describe("tab notices", () => {
  test("only warnings leave the banner for the tab", () => {
    expect(isTabNoticeStatus({ kind: "warning", message: BANNER.jenkins.branchLimit(25, 30) })).toBe(true);
    expect(isTabNoticeStatus({ kind: "error", message: BANNER.jenkins.authFailed })).toBe(false);
    expect(isTabNoticeStatus({ kind: "unavailable", message: BANNER.jenkins.noJobs })).toBe(false);
  });

  test("provider warnings become a headline without the provider name", () => {
    expect(
      notice("openshift", "OpenShift", { kind: "warning", message: BANNER.openshift.watchDenied }, "info"),
    ).toEqual({
      key: `status:openshift:${BANNER.openshift.watchDenied}`,
      fromStatus: true,
      kind: "warning",
      title: "Watch denied",
      detail: ["Resource data might be stale. Reload to refresh."],
      entries: [],
    });
    expect(
      notice("jenkins", "Jenkins", { kind: "warning", message: BANNER.jenkins.branchLimit(25, 30) }, "jenkins"),
    ).toMatchObject({
      title: "Branch jobs · 25 of 30 read",
      detail: ["Branches in the graph come first. Builds on the other 5 do not show."],
    });
  });

  test("a partial Snyk rescan warns on every Snyk tab", () => {
    const status: ProviderStatus = { kind: "warning", message: BANNER.snyk.partialRescan };
    expect(notice("snyk", "Snyk", status, "snyk-deps", scan)).toMatchObject({
      title: "Partial scan",
      detail: ["Kept last complete snapshot."],
    });
  });

  test("Snyk scans show their coverage gaps per tab, keyed by scan", () => {
    expect(notice("snyk", "Snyk", idle, "snyk-deps", scan)).toMatchObject({
      key: `snyk-deps:${scan.sha}:${scan.scannedAt}`,
      fromStatus: false,
      title: "1 project failed",
      entries: [{ label: "web/package.json", text: "Missing node_modules folder." }],
    });
    expect(notice("snyk", "Snyk", idle, "snyk", scan)).toMatchObject({
      key: `snyk:${scan.sha}:${scan.scannedAt}`,
      title: "Partial scan · 1 project failed",
    });
    expect(notice("snyk", "Snyk", idle, "info", scan)).toBeNull();
    expect(notice("snyk", "Snyk", idle, "snyk", null)).toBeNull();
  });

  test("the Git view has no tab notices", () => {
    expect(notice("git", "Git", { kind: "warning", message: "x" }, "files")).toBeNull();
  });
});
