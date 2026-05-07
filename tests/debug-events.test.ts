import { afterEach, describe, expect, test } from "bun:test";
import { addDebugEvent, clearDebugEvents, getDebugEvents, redactDebugValue } from "../src/debug/events";

afterEach(() => clearDebugEvents());

describe("debug events", () => {
  test("keeps newest events first and caps at 100", () => {
    for (let i = 0; i < 105; i++) addDebugEvent({ source: "git", message: `event ${i}`, timestamp: i });
    const events = getDebugEvents();
    expect(events).toHaveLength(100);
    expect(events[0].message).toBe("event 104");
    expect(events.at(-1)?.message).toBe("event 5");
  });

  test("returns a copy of the event buffer", () => {
    addDebugEvent({ source: "git", message: "git status" });
    getDebugEvents().length = 0;
    expect(getDebugEvents()).toHaveLength(1);
  });

  test("redacts sensitive tokens from debug text", () => {
    expect(redactDebugValue("GET /x?access_token=abc&sig=def Bearer secret")).toBe(
      "GET /x?access_token=********&sig=******** Bearer ********",
    );
  });
});
