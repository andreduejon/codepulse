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

/** A row as the tab draws it, without colors: prefix, then its text. */
const text = (row: EventsRow) => {
  switch (row.kind) {
    case "namespace":
      return `${row.prefix}${row.open ? "▾" : "▸"} ${row.namespace} ${row.count}`;
    case "resource":
      return `${row.prefix}${row.resourceKind} ${row.name}${row.removed ? " (removed)" : ""}`;
    case "warning":
      return `${row.prefix}${row.warning.reason}`;
  }
};

const WARNINGS = [
  warning({ id: "backoff", lastSeen: "2026-03-02T09:30:00Z" }),
  warning({ id: "unhealthy", reason: "Unhealthy", lastSeen: "2026-03-02T09:20:00Z" }),
  warning({ id: "deadline", kind: "Deployment", name: "shop-api", reason: "ProgressDeadlineExceeded" }),
  warning({ id: "build", namespace: "shop-dev", kind: "Build", name: "shop-api-41", reason: "BuildFailed" }),
  warning({ id: "oom", name: "shop-api-7d9f8-oom7k", reason: "OOMKilling" }),
];

describe("the Events tab's tree", () => {
  test("namespace, resource, then its warnings newest first; a removed resource keeps its place", () => {
    const rows = eventsTreeRows(WARNINGS, entry => entry.id !== "oom", new Set());
    expect(rows.map(text)).toEqual([
      "├─ ▾ shop-dev 1",
      "│  └─ Build shop-api-41",
      "│     └─ BuildFailed",
      "└─ ▾ shop-test 4",
      "   ├─ Deployment shop-api",
      "   │  └─ ProgressDeadlineExceeded",
      "   ├─ Pod shop-api-7d9f8-oom7k (removed)",
      "   │  └─ OOMKilling",
      "   └─ Pod shop-api-7d9f8-x2k4q",
      "      ├─ BackOff",
      "      └─ Unhealthy",
    ]);
    // The warnings under a removed resource are removed with it.
    expect(rows.find(row => row.key === "warning:oom")).toMatchObject({ removed: true });
  });

  test("a resource recreated under its old name is two rows: the one the commit has, then the removed one", () => {
    const rows = eventsTreeRows(
      [warning({ id: "new", uid: "pod-2" }), warning({ id: "old", uid: "pod-1", reason: "OOMKilling" })],
      entry => entry.uid === "pod-2",
      new Set(),
    );
    expect(rows.map(text)).toEqual([
      "└─ ▾ shop-test 2",
      "   ├─ Pod shop-api-7d9f8-x2k4q",
      "   │  └─ BackOff",
      "   └─ Pod shop-api-7d9f8-x2k4q (removed)",
      "      └─ OOMKilling",
    ]);
  });

  test("a closed namespace keeps only its own row", () => {
    const rows = eventsTreeRows(WARNINGS, () => true, new Set(["namespace:shop-test"]));
    expect(rows.map(text)).toEqual([
      "├─ ▾ shop-dev 1",
      "│  └─ Build shop-api-41",
      "│     └─ BuildFailed",
      "└─ ▸ shop-test 4",
    ]);
  });
});
