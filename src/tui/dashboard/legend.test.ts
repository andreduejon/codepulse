import { describe, expect, test } from "bun:test";
import type { DashboardEvent } from "../../core/dashboard/events";
import { defaultProviderModules } from "../context/provider-modules";
import { themes } from "../context/theme";
import { GITHUB_LEGEND, PULLS_LEGEND } from "../providers/github-actions/legend";
import { JENKINS_LEGEND } from "../providers/jenkins/legend";
import { OPENSHIFT_LEGEND, OPENSHIFT_WARNING_LEGEND } from "../providers/openshift/legend";
import { SNYK_SEVERITY_LEGEND } from "../providers/snyk/legend";
import { eventMark, markLegend } from "./legend";

const modules = defaultProviderModules();

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
    expect(markLegend("git", modules)).toBeNull();
    // Its runs', and a pull request's opening (merged and closed share a run's marks).
    expect(markLegend("github-actions", modules)).toEqual([...GITHUB_LEGEND, ...PULLS_LEGEND.slice(0, 2)]);
    expect(markLegend("jenkins", modules)).toBe(JENKINS_LEGEND);
    expect(markLegend("openshift", modules)).toEqual([...OPENSHIFT_LEGEND, OPENSHIFT_WARNING_LEGEND]);
    expect(markLegend("snyk", modules)).toBe(SNYK_SEVERITY_LEGEND);
  });

  test("an OpenShift warning's mark is the yellow `!` of its Resources tab, and a build's is how it ended", () => {
    const theme = themes["catppuccin-mocha"];
    const event = (id: string, status: DashboardEvent["status"]): DashboardEvent => ({
      id,
      app: "/repo/shop",
      source: "openshift",
      time: 0,
      status,
      text: "",
      sha: "abc",
    });
    const warning = eventMark(event("/repo/shop:openshift:warning:shop-test/uid", "unknown"), modules);
    expect([warning?.icon, warning?.color(theme)]).toEqual(["!", theme.warning]);
    const build = eventMark(event("/repo/shop:openshift:shop-dev/Build:shop-dev:shop-api-13", "fail"), modules);
    expect([build?.icon, build?.color(theme)]).toEqual(["✗", theme.error]);
  });

  test("a pull request opened is GitHub's ◀, muted for a draft; merged and closed are a run's ✓ and ○", () => {
    const theme = themes["catppuccin-mocha"];
    const event = (kind: string, status: DashboardEvent["status"]): DashboardEvent => ({
      id: `/repo/shop:github-actions:pull:123:${kind}`,
      app: "/repo/shop",
      source: "github-actions",
      time: 0,
      status,
      text: "",
      sha: "abc",
    });
    const marks = [
      eventMark(event("opened", "unknown"), modules),
      eventMark(event("opened", "skipped"), modules),
      eventMark(event("merged", "pass"), modules),
      eventMark(event("closed", "cancelled"), modules),
    ].map(mark => [mark?.icon, mark?.color(theme)]);
    expect(marks).toEqual([
      ["◀", theme.githubActionsBg],
      ["◀", theme.foregroundMuted],
      ["✓", theme.success],
      ["○", theme.foregroundMuted],
    ]);
  });

  test("a scan's mark is the Snyk triangle in its worst finding's color, and a clean scan has none", () => {
    const theme = themes["catppuccin-mocha"];
    for (const [severity, color] of [
      ["critical", theme.severityCritical],
      ["high", theme.severityHigh],
      ["medium", theme.severityMedium],
      ["low", theme.severityLow],
    ] as const) {
      const mark = eventMark(scan(severity), modules);
      expect(mark?.icon).toBe("▲");
      expect(mark?.color(theme)).toBe(color);
    }
    expect(eventMark(scan(null), modules)).toBeNull();
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
