import { describe, expect, test } from "bun:test";
import type { OpenShiftWarning } from "../../../core/openshift/warnings";
import { type EventsRow, eventsTreeRows } from "./events-tree";

const warning = (overrides: Partial<OpenShiftWarning>): OpenShiftWarning => ({
  id: "event-1",
  namespace: "shop-test",
  kind: "Pod",
  name: "shop-api-7d9f8-x2k4q",
  reason: "BackOff",
  message: "Back-off restarting failed container",
  count: 1,
  firstSeen: "2026-03-02T09:00:00Z",
  lastSeen: "2026-03-02T09:10:00Z",
  ...overrides,
});

/** A row as the tab draws it, without colors: prefix, then its text and count. */
const text = (row: EventsRow) => {
  switch (row.kind) {
    case "namespace":
      return `${row.prefix}${row.open ? "▾" : "▸"} ${row.namespace} ${row.count}`;
    case "reason":
      return `${row.prefix}${row.open ? "▾" : "▸"} ${row.reason} ${row.count}`;
    case "resource":
      return `${row.prefix}${row.resourceKind} ${row.name}${row.cached ? " (cached)" : ""}`;
  }
};

const WARNINGS = [
  warning({ id: "backoff-1", lastSeen: "2026-03-02T09:30:00Z" }),
  warning({ id: "backoff-2", name: "shop-api-7d9f8-a1b2c", lastSeen: "2026-03-02T09:28:00Z" }),
  warning({ id: "backoff-3", name: "shop-api-7d9f8-q9r8s", lastSeen: "2026-03-02T09:00:00Z" }),
  warning({ id: "unhealthy", reason: "Unhealthy", lastSeen: "2026-03-02T09:29:00Z" }),
  warning({ id: "deadline", kind: "Deployment", name: "shop-api", reason: "ProgressDeadlineExceeded" }),
  warning({ id: "build", namespace: "shop-dev", kind: "Build", name: "shop-api-41", reason: "BuildFailed" }),
];

describe("the Events tab's tree", () => {
  test("namespace, reason newest first, then each resource, newest first; (cached) when the cluster lost either", () => {
    const rows = eventsTreeRows(WARNINGS, {
      isPresent: entry => entry.id !== "backoff-3",
      // backoff-3's pod is gone; build's event is gone, its build is not.
      isCached: entry => entry.id === "build",
      collapsed: new Set(),
    });
    expect(rows.map(text)).toEqual([
      "├─ ▾ shop-dev 1",
      "│  └─ ▾ BuildFailed 1",
      "│     └─ Build shop-api-41 (cached)",
      "└─ ▾ shop-test 5",
      "   ├─ ▾ BackOff 3",
      "   │  ├─ Pod shop-api-7d9f8-x2k4q",
      "   │  ├─ Pod shop-api-7d9f8-a1b2c",
      "   │  └─ Pod shop-api-7d9f8-q9r8s (cached)",
      "   ├─ ▾ Unhealthy 1",
      "   │  └─ Pod shop-api-7d9f8-x2k4q",
      "   └─ ▾ ProgressDeadlineExceeded 1",
      "      └─ Deployment shop-api",
    ]);
  });

  test("a reason whose resources are all cached is over: muted, also when it is closed; its namespace is not", () => {
    const cachedOf = (collapsed: Set<string>) =>
      eventsTreeRows(WARNINGS, { isPresent: () => true, isCached: entry => entry.id !== "unhealthy", collapsed })
        .filter(row => row.kind === "reason")
        .map(row => `${row.reason}${row.cached ? " (cached)" : ""}`);
    const expected = ["BuildFailed (cached)", "BackOff (cached)", "Unhealthy", "ProgressDeadlineExceeded (cached)"];
    expect(cachedOf(new Set())).toEqual(expected);
    expect(cachedOf(new Set(["reason:shop-test:BackOff"]))).toEqual(expected);
  });

  test("one resource with two events of a reason (another message) is one row: their count, the newer time", () => {
    const rows = eventsTreeRows(
      [
        warning({ id: "probe-503", reason: "Unhealthy", lastSeen: "2026-03-02T09:10:00Z" }),
        warning({ id: "probe-refused", reason: "Unhealthy", lastSeen: "2026-03-02T09:20:00Z" }),
      ],
      { isPresent: () => true, isCached: entry => entry.id === "probe-503", collapsed: new Set() },
    );
    expect(rows.map(text)).toEqual([
      "└─ ▾ shop-test 2",
      "   └─ ▾ Unhealthy 2",
      // Cached only when every one of its events is.
      "      └─ Pod shop-api-7d9f8-x2k4q",
    ]);
    expect(rows[2]).toMatchObject({ count: 2, lastSeen: "2026-03-02T09:20:00Z" });
  });

  test("a resource recreated under its old name is two rows: the one the commit has, then the removed one", () => {
    const rows = eventsTreeRows(
      [warning({ id: "new", uid: "pod-2" }), warning({ id: "old", uid: "pod-1", lastSeen: "2026-03-02T08:00:00Z" })],
      { isPresent: entry => entry.uid === "pod-2", isCached: () => false, collapsed: new Set() },
    );
    expect(rows.map(text).slice(2)).toEqual([
      "      ├─ Pod shop-api-7d9f8-x2k4q",
      "      └─ Pod shop-api-7d9f8-x2k4q (cached)",
    ]);
  });

  test("a pod recreated twice under its name is a row for each: every one's warnings stay reachable", () => {
    const rows = eventsTreeRows(
      [
        warning({ id: "p3", uid: "pod-3", lastSeen: "2026-03-02T09:30:00Z" }),
        warning({ id: "p2", uid: "pod-2", lastSeen: "2026-03-02T09:20:00Z" }),
        warning({ id: "p1", uid: "pod-1", lastSeen: "2026-03-02T09:10:00Z" }),
      ],
      { isPresent: entry => entry.uid === "pod-3", isCached: () => false, collapsed: new Set() },
    );
    expect(rows.map(text).slice(2)).toEqual([
      "      ├─ Pod shop-api-7d9f8-x2k4q",
      "      ├─ Pod shop-api-7d9f8-x2k4q (cached)",
      "      └─ Pod shop-api-7d9f8-x2k4q (cached)",
    ]);
    // Each opens its own pod.
    expect(rows.slice(2).map(row => row.kind === "resource" && row.warning.uid)).toEqual(["pod-3", "pod-2", "pod-1"]);
    expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
  });

  test("a closed namespace or reason keeps only its own row", () => {
    const rows = eventsTreeRows(WARNINGS, {
      isPresent: () => true,
      isCached: () => false,
      collapsed: new Set(["namespace:shop-dev", "reason:shop-test:BackOff"]),
    });
    expect(rows.map(text)).toEqual([
      "├─ ▸ shop-dev 1",
      "└─ ▾ shop-test 5",
      "   ├─ ▸ BackOff 3",
      "   ├─ ▾ Unhealthy 1",
      "   │  └─ Pod shop-api-7d9f8-x2k4q",
      "   └─ ▾ ProgressDeadlineExceeded 1",
      "      └─ Deployment shop-api",
    ]);
  });

  test("Normal events the cluster lists now follow the warnings' reasons, not in the warning color", () => {
    const rows = eventsTreeRows([warning({ id: "backoff", lastSeen: "2026-03-02T09:00:00Z" })], {
      isPresent: () => true,
      isCached: () => false,
      collapsed: new Set(),
      // Newer than the warning, still after it: what went wrong leads.
      normal: [
        warning({ id: "pulled", reason: "Pulled", lastSeen: "2026-03-02T09:30:00Z" }),
        warning({ id: "started", reason: "Started", lastSeen: "2026-03-02T09:20:00Z" }),
        // The same reason as a warning is its own row.
        warning({ id: "backoff-normal", reason: "BackOff", lastSeen: "2026-03-02T09:10:00Z" }),
      ],
    });
    expect(rows.map(text)).toEqual([
      "└─ ▾ shop-test 4",
      "   ├─ ▾ BackOff 1",
      "   │  └─ Pod shop-api-7d9f8-x2k4q",
      "   ├─ ▾ Pulled 1",
      "   │  └─ Pod shop-api-7d9f8-x2k4q",
      "   ├─ ▾ Started 1",
      "   │  └─ Pod shop-api-7d9f8-x2k4q",
      "   └─ ▾ BackOff 1",
      "      └─ Pod shop-api-7d9f8-x2k4q",
    ]);
    const reasons = rows.filter(row => row.kind === "reason");
    expect(reasons.map(row => row.kind === "reason" && row.level)).toEqual(["warning", "normal", "normal", "normal"]);
    expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
  });

  test("what a failing resource's status says leads, before the warnings: its part of the status instead of a time", () => {
    const rows = eventsTreeRows([warning({ id: "backoff" })], {
      isPresent: () => true,
      isCached: () => false,
      collapsed: new Set(),
      failures: [
        {
          ...warning({ id: "status:crash", reason: "CrashLoopBackOff", lastSeen: null }),
          status: "waiting",
        },
      ],
    });
    expect(rows.map(text)).toEqual([
      "└─ ▾ shop-test 2",
      "   ├─ ▾ CrashLoopBackOff 1",
      "   │  └─ Pod shop-api-7d9f8-x2k4q",
      "   └─ ▾ BackOff 1",
      "      └─ Pod shop-api-7d9f8-x2k4q",
    ]);
    expect(rows[1]).toMatchObject({ kind: "reason", level: "failure" });
    expect(rows[2]).toMatchObject({ kind: "resource", status: "waiting", cached: false });
  });
});
