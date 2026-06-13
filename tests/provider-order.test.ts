import { describe, expect, test } from "bun:test";
import {
  getEnabledProviderViews,
  nextProviderView,
  type ProviderView,
  registerProvider,
  unregisterProvider,
} from "../src/providers/provider";

const PROVIDERS: ProviderView[] = ["github-actions", "jenkins", "openshift"];

function resetProviders() {
  for (const provider of PROVIDERS) unregisterProvider(provider);
}

describe("provider order", () => {
  test("uses canonical order, not registration order", () => {
    resetProviders();
    registerProvider({ id: "openshift", displayName: "OpenShift", isAvailable: () => true });
    registerProvider({ id: "jenkins", displayName: "Jenkins", isAvailable: () => true });
    registerProvider({ id: "github-actions", displayName: "GitHub Actions", isAvailable: () => true });

    expect(getEnabledProviderViews()).toEqual(["git", "github-actions", "jenkins", "openshift"]);
    expect(nextProviderView("git")).toBe("github-actions");
    expect(nextProviderView("openshift")).toBe("git");

    resetProviders();
  });
});
