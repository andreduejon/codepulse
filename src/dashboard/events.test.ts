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
        text: "scan · 6 vulnerabilities · 1 critical, 3 high, 2 low",
      }),
    ]);
    expect(
      snykEvents("/repo/shop", [
        { sha: SHA, scannedAt: "2026-03-02T10:30:00Z", counts: { critical: 0, high: 0, medium: 1, low: 0 } },
      ]),
    ).toEqual([expect.objectContaining({ severity: "medium", text: "scan · 1 vulnerability · 1 medium" })]);
    expect(
      snykEvents("/repo/shop", [
        { sha: SHA, scannedAt: "2026-03-02T10:30:00Z", counts: { critical: 0, high: 0, medium: 0, low: 0 } },
      ]),
    ).toEqual([expect.objectContaining({ status: "pass", severity: null, text: "scan · no vulnerabilities" })]);
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
