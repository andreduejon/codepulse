import { describe, expect, test } from "bun:test";
import { createProviderRegistry, providerDetailTab } from "../src/providers/provider";

describe("provider order", () => {
  test("uses canonical order, not registration order", () => {
    const registry = createProviderRegistry();
    registry.register({ id: "openshift", displayName: "OpenShift", isAvailable: () => true });
    registry.register({ id: "jenkins", displayName: "Jenkins", isAvailable: () => true });
    registry.register({ id: "github-actions", displayName: "GitHub", isAvailable: () => true });

    // The dashboard comes first, before Git: Tab from the last provider goes to it.
    expect(registry.getEnabledViews()).toEqual(["dashboard", "git", "github-actions", "jenkins", "openshift"]);
    expect(registry.nextView("git")).toBe("github-actions");
    expect(registry.nextView("openshift")).toBe("dashboard");
    expect(registry.nextView("dashboard")).toBe("git");
  });
});

describe("detail tabs", () => {
  test("each tab names what it lists", () => {
    expect(providerDetailTab("github-actions")?.label).toBe("Actions");
    expect(providerDetailTab("jenkins")?.label).toBe("Builds");
    expect(providerDetailTab("openshift")?.label).toBe("Resources");
    expect(providerDetailTab("snyk")?.label).toBe("Vulnerabilities");
    expect(providerDetailTab("git")).toBeNull();
  });
});
