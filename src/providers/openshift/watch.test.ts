import { describe, expect, test } from "bun:test";
import { applyOpenShiftWatchEvent } from "./api";
import type { OpenShiftListedInventory } from "./api";
import {
  appendOpenShiftLogFollow,
  isOpenShiftWatchGone,
  parseOpenShiftWatchBuffer,
  shouldFollowOpenShiftLog,
} from "./watch";
import type { OpenShiftResource } from "./types";

function listed(resources: OpenShiftResource[] = []): OpenShiftListedInventory {
  return {
    resources,
    controllers: [],
    failures: [],
    successfulRequests: 0,
    error: null,
    resourceVersions: new Map(),
  };
}

const pod = (name: string, status: OpenShiftResource["status"] = "running"): OpenShiftResource => ({
  id: `Pod:ns:${name}`,
  kind: "Pod",
  namespace: "ns",
  name,
  status,
  imageRefs: [],
});

describe("parseOpenShiftWatchBuffer", () => {
  test("splits NDJSON and keeps a partial trailing line", () => {
    const { events, rest } = parseOpenShiftWatchBuffer(
      '{"type":"ADDED","object":{"kind":"Pod"}}\n{"type":"MODIFIED","object":',
    );
    expect(events).toEqual([{ type: "ADDED", object: { kind: "Pod" } }]);
    expect(rest).toBe('{"type":"MODIFIED","object":');
  });

  test("skips malformed lines", () => {
    const { events } = parseOpenShiftWatchBuffer("not-json\n{\"type\":\"DELETED\",\"object\":{}}\n");
    expect(events).toEqual([{ type: "DELETED", object: {} }]);
  });
});

describe("isOpenShiftWatchGone", () => {
  test("detects 410 status objects", () => {
    expect(isOpenShiftWatchGone({ type: "ERROR", object: { code: 410, reason: "Expired" } })).toBe(true);
    expect(isOpenShiftWatchGone({ type: "ADDED", object: { code: 410 } })).toBe(false);
  });
});

describe("applyOpenShiftWatchEvent", () => {
  test("upserts and deletes by kind:ns:name", () => {
    const inventory = listed([pod("app")]);
    expect(
      applyOpenShiftWatchEvent(
        inventory,
        {
          type: "MODIFIED",
          object: {
            kind: "Pod",
            metadata: { name: "app", namespace: "ns" },
            status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] },
          },
        },
        "dev/commit-sha",
      ),
    ).toBe("applied");
    expect(inventory.resources[0]?.status).toBe("pass");

    expect(
      applyOpenShiftWatchEvent(
        inventory,
        {
          type: "DELETED",
          object: { kind: "Pod", metadata: { name: "app", namespace: "ns" } },
        },
        "dev/commit-sha",
      ),
    ).toBe("applied");
    expect(inventory.resources).toEqual([]);
  });

  test("returns gone on 410 watch errors", () => {
    expect(applyOpenShiftWatchEvent(listed(), { type: "ERROR", object: { code: 410 } }, "dev/commit-sha")).toBe("gone");
  });
});

describe("appendOpenShiftLogFollow", () => {
  test("keeps the last 1000 lines", () => {
    const lines = Array.from({ length: 1005 }, (_, index) => `line-${index}`);
    const out = appendOpenShiftLogFollow("", `${lines.join("\n")}\n`, 1000);
    const kept = out.split("\n");
    expect(kept[0]).toBe("line-6");
    expect(kept.at(-2)).toBe("line-1004");
    expect(kept).toHaveLength(1000);
  });
});

describe("shouldFollowOpenShiftLog", () => {
  test("follows pods and running builds only", () => {
    expect(shouldFollowOpenShiftLog(pod("app"))).toBe(true);
    expect(shouldFollowOpenShiftLog({ ...pod("app"), kind: "Build", id: "Build:ns:app", status: "running" })).toBe(true);
    expect(shouldFollowOpenShiftLog({ ...pod("app"), kind: "Build", id: "Build:ns:app", status: "pass" })).toBe(false);
  });
});
