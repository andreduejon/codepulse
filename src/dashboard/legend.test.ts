import { describe, expect, test } from "bun:test";
import { themes } from "../context/theme";
import { GITHUB_LEGEND, JENKINS_LEGEND, OPENSHIFT_LEGEND, SNYK_SEVERITY_LEGEND } from "../providers/legends";
import type { DashboardEvent } from "./events";
import { eventMark, markLegend } from "./legend";

const scan = (severity: DashboardEvent["severity"]): DashboardEvent => ({
  id: "snyk",
  app: "/repo/shop",
  source: "snyk",
  time: 0,
  status: severity ? "fail" : "pass",
  severity,
  text: "scan",
  sha: "abc",
});

describe("dashboard marks", () => {
  test("each provider's events are explained with the legend of its own detail tab", () => {
    expect(markLegend("git")).toBeNull();
    expect(markLegend("github-actions")).toBe(GITHUB_LEGEND);
    expect(markLegend("jenkins")).toBe(JENKINS_LEGEND);
    expect(markLegend("openshift")).toBe(OPENSHIFT_LEGEND);
    expect(markLegend("snyk")).toBe(SNYK_SEVERITY_LEGEND);
  });

  test("a scan's mark is the Snyk triangle in its worst finding's color, and a clean scan has none", () => {
    const theme = themes["catppuccin-mocha"];
    for (const [severity, color] of [
      ["critical", theme.severityCritical],
      ["high", theme.severityHigh],
      ["medium", theme.severityMedium],
      ["low", theme.severityLow],
    ] as const) {
      const mark = eventMark(scan(severity));
      expect(mark?.icon).toBe("▲");
      expect(mark?.color(theme)).toBe(color);
    }
    expect(eventMark(scan(null))).toBeNull();
  });

  test("the severity legend names each level beside its triangle, without the Snyk tab to explain it", () => {
    const theme = themes["catppuccin-mocha"];
    expect(
      SNYK_SEVERITY_LEGEND.map(([markers, label]) => [markers.map(([icon, color]) => [icon, color(theme)]), label]),
    ).toEqual([
      [[["▲", theme.severityCritical]], "critical"],
      [[["▲", theme.severityHigh]], "high"],
      [[["▲", theme.severityMedium]], "medium"],
      [[["▲", theme.severityLow]], "low"],
    ]);
  });
});
