import { describe, expect, test } from "bun:test";
import { createProviderRegistry } from "../src/providers/provider";

describe("provider order", () => {
  test("uses canonical order, not registration order", () => {
    const registry = createProviderRegistry();
    registry.register({ id: "openshift", displayName: "OpenShift", isAvailable: () => true });
    registry.register({ id: "jenkins", displayName: "Jenkins", isAvailable: () => true });
    registry.register({ id: "github-actions", displayName: "GitHub Actions", isAvailable: () => true });

    // The dashboard comes first, before Git: Tab from the last provider goes to it.
    expect(registry.getEnabledViews()).toEqual(["dashboard", "git", "github-actions", "jenkins", "openshift"]);
    expect(registry.nextView("git")).toBe("github-actions");
    expect(registry.nextView("openshift")).toBe("dashboard");
    expect(registry.nextView("dashboard")).toBe("git");
  });
});
