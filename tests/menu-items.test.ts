import { describe, expect, it } from "bun:test";
import {
  buildGitHubProviderItems,
  type GitHubMenuConfig,
  isOptionalRepoMetadataValid,
  optionalRepoMetadataValue,
} from "../src/hooks/use-menu-items";

describe("buildGitHubProviderItems", () => {
  const baseCfg = {
    enabled: true,
    tokenEnvVar: "GITHUB_TOKEN",
    trustedEnterpriseHost: null,
  };

  it("shows host info and disabled allow-host toggle for github.com", () => {
    const items = buildGitHubProviderItems(baseCfg, "https://github.com/owner/repo.git", "env");
    const host = items.find(item => item.kind === "info" && item.label === "Host");
    const allowHost = items.find(item => item.kind === "toggle" && item.label === "Allow host");

    expect(host?.kind).toBe("info");
    if (host?.kind === "info") expect(host.get()).toBe("github.com");

    expect(allowHost?.kind).toBe("toggle");
    if (allowHost?.kind === "toggle") {
      expect(allowHost.get()).toBe(true);
      expect(allowHost.disabled?.()).toBe(true);
    }
  });

  it("shows off + enabled toggle for untrusted enterprise host", () => {
    const items = buildGitHubProviderItems(baseCfg, "https://ghe.example.com/owner/repo.git", "env");
    const allowHost = items.find(item => item.kind === "toggle" && item.label === "Allow host");

    expect(allowHost?.kind).toBe("toggle");
    if (allowHost?.kind === "toggle") {
      expect(allowHost.get()).toBe(false);
      expect(allowHost.disabled?.()).toBe(false);
    }
  });

  it("shows on for trusted enterprise host", () => {
    const items = buildGitHubProviderItems(
      { ...baseCfg, trustedEnterpriseHost: "ghe.example.com" },
      "https://ghe.example.com/owner/repo.git",
      "env",
    );
    const allowHost = items.find(item => item.kind === "toggle" && item.label === "Allow host");

    expect(allowHost?.kind).toBe("toggle");
    if (allowHost?.kind === "toggle") {
      expect(allowHost.get()).toBe(true);
      expect(allowHost.disabled?.()).toBe(false);
    }
  });

  it("toggle setter stores current enterprise host", () => {
    const capture: { changed: GitHubMenuConfig | null; persisted: GitHubMenuConfig | null } = {
      changed: null,
      persisted: null,
    };

    const items = buildGitHubProviderItems(
      baseCfg,
      "https://ghe.example.com/owner/repo.git",
      "env",
      cfg => {
        capture.changed = cfg;
      },
      cfg => {
        capture.persisted = cfg;
      },
    );
    const allowHost = items.find(item => item.kind === "toggle" && item.label === "Allow host");

    expect(allowHost?.kind).toBe("toggle");
    if (allowHost?.kind === "toggle") {
      allowHost.set(true);
    }

    expect(capture.changed).not.toBeNull();
    expect(capture.persisted).not.toBeNull();
    if (capture.changed == null || capture.persisted == null) throw new Error("expected callbacks");
    expect(capture.changed.trustedEnterpriseHost).toBe("ghe.example.com");
    expect(capture.persisted.trustedEnterpriseHost).toBe("ghe.example.com");
  });
});

describe("repo metadata menu validation", () => {
  it("allows blank or 64-char repo metadata values", () => {
    expect(isOptionalRepoMetadataValid("")).toBe(true);
    expect(isOptionalRepoMetadataValid(" ".repeat(10))).toBe(true);
    expect(isOptionalRepoMetadataValid("x".repeat(64))).toBe(true);
  });

  it("rejects trimmed repo metadata values over 64 chars", () => {
    expect(isOptionalRepoMetadataValid("x".repeat(65))).toBe(false);
    expect(isOptionalRepoMetadataValid(`  ${"x".repeat(65)}  `)).toBe(false);
  });

  it("omits blank repo metadata values", () => {
    expect(optionalRepoMetadataValue("  ")).toBeUndefined();
    expect(optionalRepoMetadataValue("  platform  ")).toBe("platform");
  });
});
