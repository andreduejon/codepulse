import { describe, expect, test } from "bun:test";
import { createProviderRegistry } from "../src/tui/providers/provider";
import { BUILT_IN_PROVIDERS } from "./test-helpers";

describe("provider order", () => {
  test("uses canonical order, not registration order", () => {
    const registry = createProviderRegistry(BUILT_IN_PROVIDERS);
    registry.register({ id: "openshift", displayName: "OpenShift", isAvailable: () => true });
    registry.register({ id: "jenkins", displayName: "Jenkins", isAvailable: () => true });
    registry.register({ id: "github-actions", displayName: "GitHub", isAvailable: () => true });

    // The dashboard comes first, before Git: Tab from the last provider goes to it.
    expect(registry.getEnabledViews()).toEqual(["dashboard", "git", "github-actions", "jenkins", "openshift"]);
    expect(registry.nextView("git")).toBe("github-actions");
    expect(registry.nextView("openshift")).toBe("dashboard");
    expect(registry.nextView("dashboard")).toBe("git");
  });

  test("a dashboard turned off has no tab: Tab from the last provider goes to Git", () => {
    const registry = createProviderRegistry(BUILT_IN_PROVIDERS);
    registry.register({ id: "jenkins", displayName: "Jenkins", isAvailable: () => true });
    registry.setDashboardEnabled(false);
    expect(registry.getEnabledViews()).toEqual(["git", "jenkins"]);
    expect(registry.nextView("jenkins")).toBe("git");
    registry.setDashboardEnabled(true);
    expect(registry.getEnabledViews()).toEqual(["dashboard", "git", "jenkins"]);
  });
});

describe("detail tabs", () => {
  test("each tab names what it lists", () => {
    expect(BUILT_IN_PROVIDERS.detailTab("github-actions")?.label).toBe("Actions");
    expect(BUILT_IN_PROVIDERS.detailTab("jenkins")?.label).toBe("Builds");
    expect(BUILT_IN_PROVIDERS.detailTab("openshift")?.label).toBe("Resources");
    expect(BUILT_IN_PROVIDERS.detailTab("snyk")?.label).toBe("Vulnerabilities");
    expect(BUILT_IN_PROVIDERS.detailTab("git")).toBeNull();
  });
});
