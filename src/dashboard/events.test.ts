import { describe, expect, test } from "bun:test";
import type { GitHubWorkflowRun } from "../providers/github-actions/types";
import type { JenkinsRun } from "../providers/jenkins/types";
import {
  type DashboardEvent,
  dashboardRows,
  gitEvents,
  githubEvents,
  jenkinsEvents,
  openShiftEvents,
  snykEvents,
} from "./events";

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
              object: { status: { phase: "Failed", completionTimestamp: "2026-03-02T10:25:00Z" } },
            },
          ],
        },
      ]),
    ).toEqual([
      expect.objectContaining({ time: at("2026-03-02T10:25:00Z"), text: "build shop-api-13 failed in shop-dev" }),
    ]);
    const counts = { critical: 1, high: 3, medium: 0, low: 2 };
    expect(snykEvents("/repo/shop", [{ sha: SHA, scannedAt: "2026-03-02T10:30:00Z", counts }])).toEqual([
      expect.objectContaining({ source: "snyk", status: "fail", text: "scan · 1 critical, 3 high, 2 low" }),
    ]);
    expect(
      snykEvents("/repo/shop", [
        { sha: SHA, scannedAt: "2026-03-02T10:30:00Z", counts: { critical: 0, high: 0, medium: 0, low: 0 } },
      ]),
    ).toEqual([expect.objectContaining({ status: "pass", text: "scan · no vulnerabilities" })]);
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
      { knotMs: HOUR, maxKnotRows: 5, expanded: new Set(), utcOffset: () => 0 },
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

  test("a new day starts with a date row; a knot past its row limit ends in a row that opens it", () => {
    const busy = Array.from({ length: 7 }, (_, index) => event("shop", 50 - index));
    const yesterday = { ...event("shop", 0), id: "old", time: at("2026-03-01T15:00:00Z") };
    const rows = dashboardRows([...busy, yesterday], {
      knotMs: HOUR,
      maxKnotRows: 5,
      expanded: new Set(),
      utcOffset: () => 0,
    });
    expect(rows.map(row => row.kind)).toEqual(["date", ...Array(5).fill("event"), "more", "gap", "date", "event"]);
    const more = rows.find(row => row.kind === "more");
    expect(more).toMatchObject({ hidden: 2 });
    const opened = dashboardRows([...busy, yesterday], {
      knotMs: HOUR,
      maxKnotRows: 5,
      expanded: new Set([more?.kind === "more" ? more.knot : ""]),
      utcOffset: () => 0,
    });
    expect(opened.filter(row => row.kind === "event")).toHaveLength(8);
    expect(opened.some(row => row.kind === "more")).toBe(false);
  });
});
