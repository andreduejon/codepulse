import { describe, expect, test } from "bun:test";
import { catppuccinMocha } from "../src/context/theme-definitions";
import { statusColor } from "../src/providers/shared/status";

describe("statusColor", () => {
  test("uses semantic tokens, not accent, for run status", () => {
    expect(statusColor(catppuccinMocha, "fail")).toBe(catppuccinMocha.error);
    expect(statusColor(catppuccinMocha, "running")).toBe(catppuccinMocha.info);
    expect(statusColor(catppuccinMocha, "pass")).toBe(catppuccinMocha.success);
    expect(statusColor(catppuccinMocha, "unknown")).toBe(catppuccinMocha.foregroundMuted);
    expect(statusColor(catppuccinMocha, "running")).not.toBe(catppuccinMocha.accent);
  });
});
