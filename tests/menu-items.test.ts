import { describe, expect, it } from "bun:test";
import {
  buildGitHubProviderItems,
  buildJenkinsProviderItems,
  buildOpenShiftProviderItems,
  type GitHubMenuConfig,
  isOptionalRepoMetadataValid,
  type JenkinsMenuConfig,
  type OpenShiftMenuConfig,
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

describe("buildOpenShiftProviderItems", () => {
  it("validates HTTPS server and DNS namespaces", () => {
    const cfg: OpenShiftMenuConfig = {
      enabled: true,
      serverUrl: "https://api.example.com:6443",
      tokenEnvVar: "OPENSHIFT_TOKEN",
      namespaces: [],
      commitShaAnnotation: "dev/commit-sha",
    };
    let changed = cfg;
    const items = buildOpenShiftProviderItems(cfg, next => {
      changed = next;
    });
    const server = items.find(item => item.kind === "editable" && item.label === "Server");
    const namespace = items.find(item => item.kind === "editable" && item.label === "New namespace");
    expect(server?.kind).toBe("editable");
    expect(namespace?.kind).toBe("editable");
    if (server?.kind === "editable") {
      expect(server.isDraftValid?.("https://api.example.com")).toBe(true);
      expect(server.isDraftValid?.("http://api.example.com")).toBe(false);
    }
    if (namespace?.kind === "editable") {
      expect(namespace.isDraftValid?.("team-one")).toBe(true);
      expect(namespace.isDraftValid?.("Bad_Name")).toBe(false);
      namespace.set("Bad_Name");
      expect(changed.namespaces).toEqual([]);
      namespace.set("team-one");
      expect(changed.namespaces).toEqual(["team-one"]);
    }
  });
});

describe("buildJenkinsProviderItems", () => {
  it("adds a job URL for API auto-detection", () => {
    const baseCfg: JenkinsMenuConfig = {
      enabled: true,
      username: "user",
      tokenEnvVar: "JENKINS_TOKEN",
      graphBuildLimit: 20,
      jobs: [],
    };
    const capture: { changed: JenkinsMenuConfig | null } = { changed: null };
    const items = buildJenkinsProviderItems(baseCfg, cfg => {
      capture.changed = cfg;
    });
    const input = items.find(item => item.kind === "editable" && item.label === "New job");
    expect(input?.kind).toBe("editable");
    if (input?.kind === "editable") {
      expect(input.isDraftValid?.("http://jenkins.example.com/job/foo")).toBe(false);
      expect(input.isDraftValid?.("https://user:token@jenkins.example.com/job/foo")).toBe(false);
      expect(input.isDraftValid?.("https://jenkins.example.com/job/service")).toBe(true);
      input.set("http://jenkins.example.com/job/foo");
      expect(capture.changed).toBeNull();
      input.set(" https://jenkins.example.com/job/service ");
    }
    expect(capture.changed?.jobs).toEqual([{ url: "https://jenkins.example.com/job/service" }]);
  });

  it("cycles fetch size per job through 10/20/50", () => {
    const baseCfg: JenkinsMenuConfig = {
      enabled: true,
      username: "user",
      tokenEnvVar: "JENKINS_TOKEN",
      graphBuildLimit: 20,
      jobs: [],
    };
    let changed = baseCfg;
    const items = buildJenkinsProviderItems(baseCfg, cfg => {
      changed = cfg;
    });
    const cycle = items.find(item => item.kind === "cycle" && item.label === "Fetch size per job");
    expect(cycle?.kind).toBe("cycle");
    if (cycle?.kind !== "cycle") return;
    expect(cycle.get()).toBe("20");
    expect(cycle.options).toEqual(["10", "20", "50"]);
    cycle.set("10");
    expect(changed.graphBuildLimit).toBe(10);
    cycle.set("50");
    expect(changed.graphBuildLimit).toBe(50);
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
