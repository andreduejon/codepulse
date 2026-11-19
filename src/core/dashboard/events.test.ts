import { describe, expect, test } from "bun:test";
import { githubEvents } from "../github/events";
import type { GitHubWorkflowRun } from "../github/types";
import { jenkinsEvents } from "../jenkins/events";
import type { JenkinsRun } from "../jenkins/types";
import { isOpenShiftWarningEvent, openShiftEvents } from "../openshift/events";
import { warningTarget } from "../openshift/warnings";
import { snykEvents } from "../snyk/events";
import { type DashboardEvent, dashboardRows, gitEvents, keepUnchangedRows } from "./events";

const SHA = "e6209dd7a1b2c3d4e5f60718293a4b5c6d7e8f90";
const HOUR = 3_600_000;
const at = (iso: string) => Date.parse(iso);

const run = (overrides: Partial<GitHubWorkflowRun> = {}): GitHubWorkflowRun => ({
  id: 1,
  name: "CI",
  status: "completed",
  conclusion: "failure",
  headSha: SHA,
  event: "push",
  runNumber: 812,
  updatedAt: "2026-03-02T10:52:00Z",
  url: "https://github.com/demo/shop/actions/runs/1",
  ...overrides,
});

describe("events", () => {
  test("each provider's finished work becomes one event at the time it ended, with its status", () => {
    expect(
      gitEvents("/repo/shop", [{ hash: SHA, time: at("2026-03-02T09:20:00Z"), subject: "feat(api): health" }]),
    ).toEqual([
      {
        id: `/repo/shop:git:${SHA}`,
        app: "/repo/shop",
        source: "git",
        time: at("2026-03-02T09:20:00Z"),
        status: null,
        text: "feat(api): health",
        sha: SHA,
      },
    ]);
    // The same run cached under two commits' snapshots is one event.
    expect(
      githubEvents("/repo/shop", [
        { sha: SHA, runs: [run()] },
        { sha: SHA, runs: [run()] },
      ]),
    ).toEqual([
      expect.objectContaining({ source: "github-actions", status: "fail", text: "CI #812 failed", sha: SHA }),
    ]);
    const jenkins: JenkinsRun = {
      id: "j-412",
      name: "shop",
      status: "completed",
      conclusion: "success",
      headSha: SHA,
      runNumber: 412,
      startedAt: null,
      updatedAt: "2026-03-02T10:41:00Z",
      url: "https://jenkins.example/job/shop/412/",
      jobLabel: "shop",
      jobUrl: "https://jenkins.example/job/shop/",
    };
    expect(jenkinsEvents("/repo/shop", [{ sha: SHA, runs: [jenkins] }])).toEqual([
      expect.objectContaining({ source: "jenkins", status: "pass", text: "shop #412 passed" }),
    ]);
    // A multibranch branch job's build carries the branch; a plain job's leaves it to Git.
    expect(jenkinsEvents("/repo/shop", [{ sha: SHA, runs: [{ ...jenkins, branch: "develop" }] }])[0]?.branch).toBe(
      "develop",
    );
    expect(jenkinsEvents("/repo/shop", [{ sha: SHA, runs: [jenkins] }])[0]).not.toHaveProperty("branch");
    expect(
      openShiftEvents("/repo/shop", [
        {
          sha: SHA,
          builds: [
            {
              id: "Build/shop-api-12",
              name: "shop-api-12",
              namespace: "shop-dev",
              status: "pass",
              imageRefs: [],
              commitSha: SHA,
              updatedAt: "2026-03-02T10:20:00Z",
            },
          ],
        },
      ]),
    ).toEqual([
      expect.objectContaining({ source: "openshift", status: "pass", text: "build shop-api-12 complete in shop-dev" }),
    ]);
    // A cancelled build says so, in the neutral status.
    expect(
      openShiftEvents("/repo/shop", [
        {
          sha: SHA,
          builds: [
            {
              id: "Build/shop-api-13",
              name: "shop-api-13",
              namespace: "shop-dev",
              status: "cancelled",
              imageRefs: [],
              commitSha: SHA,
              updatedAt: "2026-03-02T10:20:00Z",
            },
          ],
        },
      ]),
    ).toEqual([expect.objectContaining({ status: "cancelled", text: "build shop-api-13 cancelled in shop-dev" })]);
    // One cached as failed before cancelled was a status of its own: its saved object says it was cancelled.
    expect(
      openShiftEvents("/repo/shop", [
        {
          sha: SHA,
          builds: [
            {
              id: "Build/shop-api-14",
              name: "shop-api-14",
              namespace: "shop-dev",
              status: "fail",
              imageRefs: [],
              commitSha: SHA,
              updatedAt: "2026-03-02T10:20:00Z",
              object: { status: { phase: "Cancelled" } },
            },
          ],
        },
      ]),
    ).toEqual([expect.objectContaining({ status: "cancelled", text: "build shop-api-14 cancelled in shop-dev" })]);
    // A finished build's own end time, also when the build carries no creation time.
    expect(
      openShiftEvents("/repo/shop", [
        {
          sha: SHA,
          builds: [
            {
              id: "Build/shop-api-13",
              name: "shop-api-13",
              namespace: "shop-dev",
              status: "fail",
              imageRefs: [],
              commitSha: SHA,
              updatedAt: null,
              object: {
                spec: { source: { git: { uri: "https://git.example/shop.git", ref: "refs/heads/develop" } } },
                status: { phase: "Failed", completionTimestamp: "2026-03-02T10:25:00Z" },
              },
            },
          ],
        },
      ]),
    ).toEqual([
      // The build's Git ref is the branch it built.
      expect.objectContaining({
        time: at("2026-03-02T10:25:00Z"),
        text: "build shop-api-13 failed in shop-dev",
        branch: "develop",
      }),
    ]);
    const counts = { critical: 1, high: 3, medium: 0, low: 2 };
    expect(snykEvents("/repo/shop", [{ sha: SHA, scannedAt: "2026-03-02T10:30:00Z", counts }])).toEqual([
      expect.objectContaining({
        source: "snyk",
        status: "fail",
        severity: "critical",
        // Every severity, in order, also when none was found: the counts line up from scan to scan.
        text: "scan · 6 vulnerabilities · 1 critical · 3 high · 0 medium · 2 low",
        counts,
      }),
    ]);
    expect(
      snykEvents("/repo/shop", [
        { sha: SHA, scannedAt: "2026-03-02T10:30:00Z", counts: { critical: 0, high: 0, medium: 1, low: 0 } },
      ]),
    ).toEqual([
      expect.objectContaining({
        severity: "medium",
        text: "scan · 1 vulnerability · 0 critical · 0 high · 1 medium · 0 low",
      }),
    ]);
    expect(
      snykEvents("/repo/shop", [
        { sha: SHA, scannedAt: "2026-03-02T10:30:00Z", counts: { critical: 0, high: 0, medium: 0, low: 0 } },
      ]),
    ).toEqual([
      // Like Snyk's own C0 H0 M0 L0: every severity at zero, no mark.
      expect.objectContaining({
        status: "pass",
        severity: null,
        text: "scan · 0 vulnerabilities · 0 critical · 0 high · 0 medium · 0 low",
        counts: { critical: 0, high: 0, medium: 0, low: 0 },
        partial: false,
      }),
    ]);
    // Some projects failed: zero findings is not a clean result, so the scan is partial and not a pass.
    expect(
      snykEvents("/repo/shop", [
        {
          sha: SHA,
          scannedAt: "2026-03-02T10:30:00Z",
          counts: { critical: 0, high: 0, medium: 0, low: 0 },
          partial: true,
          failedProjects: 1,
        },
      ]),
    ).toEqual([expect.objectContaining({ status: "unknown", severity: null, partial: true })]);
  });
});

describe("OpenShift warnings", () => {
  const warning = {
    id: "event-backoff",
    namespace: "shop-test",
    kind: "Pod",
    name: "shop-api-7d9f8-x2k4q",
    uid: "pod-uid",
    reason: "BackOff",
    message: "Back-off restarting failed container api in pod shop-api-7d9f8-x2k4q",
    count: 61,
    firstSeen: "2026-03-02T09:00:00Z",
    lastSeen: "2026-03-02T09:30:00Z",
  };

  test("a saved warning is one event at the time it was first seen, so repeating never moves it", () => {
    const events = openShiftEvents("/repo/shop", [
      { sha: SHA, builds: [], warnings: [warning, { ...warning, id: "event-once", reason: "OOMKilling", count: 1 }] },
    ]);
    expect(events.map(event => [event.text, event.time, event.sha])).toEqual([
      ["BackOff · pod shop-api-7d9f8-x2k4q in shop-test · 61 times", at("2026-03-02T09:00:00Z"), SHA],
      ["OOMKilling · pod shop-api-7d9f8-x2k4q in shop-test", at("2026-03-02T09:00:00Z"), SHA],
    ]);
    // A warning, not how something ended: neutral, never a failure. Its mark is OpenShift's own `!`.
    expect(events[0]?.status).toBe("unknown");
    expect(isOpenShiftWarningEvent(events[0] as DashboardEvent)).toBe(true);
    expect(events[0]?.facts).toEqual([
      { label: "Namespace", value: "shop-test" },
      { label: "Resource", value: "Pod shop-api-7d9f8-x2k4q" },
      { label: "Reason", value: "BackOff" },
      { label: "Message", value: "Back-off restarting failed container api in pod shop-api-7d9f8-x2k4q" },
      { label: "Times", value: "61" },
      { label: "Repeated for", value: "30m 00s" },
    ]);
    // Its details open on the Events tab, marking its own row: its reason and the pod by uid.
    expect([events[0]?.tab, events[0]?.entry]).toEqual(["openshift-events", warningTarget(warning)]);
  });

  test("one warning saved with two commits is one event; one without a time is left out", () => {
    const events = openShiftEvents("/repo/shop", [
      { sha: SHA, builds: [], warnings: [warning] },
      {
        sha: "b".repeat(40),
        builds: [],
        warnings: [warning, { ...warning, id: "no-time", firstSeen: null, lastSeen: null }],
      },
    ]);
    expect(events.map(event => event.id)).toEqual([`/repo/shop:openshift:warning:shop-test/event-backoff`]);
  });

  test("of one warning saved with two commits, the newest copy shows, with the same commit whatever the order", () => {
    const older = {
      sha: "b".repeat(40),
      builds: [],
      warnings: [{ ...warning, count: 1, lastSeen: warning.firstSeen }],
    };
    const newer = { sha: SHA, builds: [], warnings: [warning] };
    for (const entries of [
      [older, newer],
      [newer, older],
    ]) {
      const [event] = openShiftEvents("/repo/shop", entries);
      expect([event?.text, event?.sha]).toEqual(["BackOff · pod shop-api-7d9f8-x2k4q in shop-test · 61 times", SHA]);
    }
    // The same copy in both: the same commit either way.
    const twice = [newer, { ...newer, sha: "b".repeat(40) }];
    expect(openShiftEvents("/repo/shop", twice)[0]?.sha).toBe(openShiftEvents("/repo/shop", twice.reverse())[0]?.sha);
  });

  test("a build's event is not a warning", () => {
    const [build] = openShiftEvents("/repo/shop", [
      {
        sha: SHA,
        builds: [
          {
            id: "Build/shop-api-13",
            name: "shop-api-13",
            namespace: "shop-dev",
            status: "pass",
            imageRefs: [],
            commitSha: SHA,
            updatedAt: "2026-03-02T10:20:00Z",
          },
        ],
      },
    ]);
    expect(isOpenShiftWarningEvent(build as DashboardEvent)).toBe(false);
  });
});

describe("event details", () => {
  test("each event carries what its side panel shows, and its page when it has one", () => {
    const [github] = githubEvents("/repo/shop", [
      { sha: SHA, runs: [run({ startedAt: "2026-03-02T10:41:00Z", updatedAt: "2026-03-02T10:52:30Z" })] },
    ]);
    expect(github?.url).toBe("https://github.com/demo/shop/actions/runs/1");
    expect(github?.facts).toEqual([
      { label: "Workflow", value: "CI" },
      { label: "Run", value: "#812" },
      { label: "Trigger", value: "push" },
      { label: "Duration", value: "11m 30s" },
    ]);
    const [failed] = openShiftEvents("/repo/shop", [
      {
        sha: SHA,
        builds: [
          {
            id: "Build/shop-api-41",
            name: "shop-api-41",
            namespace: "shop-dev",
            status: "fail",
            imageRefs: [],
            commitSha: SHA,
            updatedAt: "2026-03-02T10:19:00Z",
            object: {
              status: {
                completionTimestamp: "2026-03-02T10:25:00Z",
                reason: "DockerBuildFailed",
                message: "Docker build strategy has failed.",
              },
            },
          },
        ],
      },
    ]);
    expect(failed?.url).toBeUndefined();
    expect(failed?.facts).toEqual([
      { label: "Namespace", value: "shop-dev" },
      { label: "Build", value: "shop-api-41" },
      { label: "Reason", value: "DockerBuildFailed: Docker build strategy has failed." },
      { label: "Duration", value: "6m 00s" },
    ]);
    const [scan] = snykEvents("/repo/shop", [
      {
        sha: SHA,
        scannedAt: "2026-03-02T10:30:00Z",
        counts: { critical: 1, high: 3, medium: 0, low: 2 },
        partial: true,
        failedProjects: 1,
      },
    ]);
    expect(scan?.facts).toEqual([
      { label: "Vulnerabilities", value: "6 (1 critical, 3 high, 0 medium, 2 low)" },
      { label: "Partial", value: "1 project could not be scanned" },
    ]);
  });
});

describe("dashboardRows", () => {
  const event = (app: string, minute: number, source: DashboardEvent["source"] = "git"): DashboardEvent => ({
    id: `${app}:${source}:${minute}`,
    app,
    source,
    time: at("2026-03-02T10:00:00Z") + minute * 60_000,
    status: null,
    text: `${source} at ${minute}`,
    sha: SHA,
  });

  test("a knot holds one app's events within one knot, newest first, with a rope row between knots", () => {
    const rows = dashboardRows(
      [event("shop", 52), event("web", 48), event("shop", 41), event("shop", -40), event("web", 12)],
      { knotMs: HOUR, utcOffset: () => 0 },
    );
    expect(rows.map(row => (row.kind === "event" ? `${row.event.app}@${row.event.time}` : row.kind))).toEqual([
      "date",
      `shop@${event("shop", 52).time}`,
      `shop@${event("shop", 41).time}`,
      "gap",
      `web@${event("web", 48).time}`,
      `web@${event("web", 12).time}`,
      "gap",
      `shop@${event("shop", -40).time}`,
    ]);
  });

  test("a new day starts with a date row, and a busy knot shows every event", () => {
    const busy = Array.from({ length: 7 }, (_, index) => event("shop", 50 - index));
    const yesterday = { ...event("shop", 0), id: "old", time: at("2026-03-01T15:00:00Z") };
    const rows = dashboardRows([...busy, yesterday], { knotMs: HOUR, utcOffset: () => 0 });
    expect(rows.map(row => row.kind)).toEqual(["date", ...Array(7).fill("event"), "gap", "date", "event"]);
  });
});

describe("keepUnchangedRows", () => {
  const event = (id: string, minute: number, text = `commit ${id}`): DashboardEvent => ({
    id,
    app: "shop",
    source: "git",
    time: at("2026-03-02T10:00:00Z") + minute * 60_000,
    status: null,
    text,
    sha: SHA,
  });
  const rows = (events: DashboardEvent[]) => dashboardRows(events, { knotMs: HOUR, utcOffset: () => 0 });

  test("a row read again unchanged is the same row, so a list keyed by row keeps it mounted", () => {
    const before = rows([event("a", 50), event("b", 40), event("c", -30)]);
    // Read again: new objects, the same content, and one event changed.
    const after = keepUnchangedRows(
      before,
      rows([event("a", 50), event("b", 40, "commit b, amended"), event("c", -30)]),
    );
    expect(after.map(row => row.kind)).toEqual(["date", "event", "event", "gap", "event"]);
    // A date row is drawn again: its label depends on the clock.
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).not.toBe(before[2]);
    expect(after[2]?.kind === "event" && after[2].event.text).toBe("commit b, amended");
    expect(after[3]).toBe(before[3]);
    expect(after[4]).toBe(before[4]);
  });

  test("a new event is a new row, and a row that moved to another knot is too", () => {
    const before = rows([event("a", 50), event("b", -30)]);
    const after = keepUnchangedRows(before, rows([event("new", 55), event("a", 50), event("b", 30)]));
    expect(after.map(row => (row.kind === "event" ? row.event.id : row.kind))).toEqual(["date", "new", "a", "b"]);
    expect(after[2]).toBe(before[1]);
    // b is in the first knot now, not after a gap.
    expect(after[3]).not.toBe(before[3]);
  });
});
