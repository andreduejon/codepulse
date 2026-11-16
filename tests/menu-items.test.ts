import { describe, expect, it, test } from "bun:test";
import type {
  GitHubMenuConfig,
  JenkinsMenuConfig,
  OpenShiftMenuConfig,
  SnykMenuConfig,
} from "../src/hooks/menu-items-types";
import {
  buildDashboardItems,
  buildGitHubProviderItems,
  buildJenkinsProviderItems,
  buildOpenShiftProviderItems,
  buildSnykProviderItems,
} from "../src/hooks/menu-provider-items";
import {
  isOptionalRepoMetadataValid,
  optionalRepoMetadataValue,
  relativeAgeLabel,
  startViewItem,
} from "../src/hooks/use-menu-items";

describe("buildDashboardItems", () => {
  it("offers the time window and the knot size, and saves the next choice", () => {
    const saved: unknown[] = [];
    const items = buildDashboardItems({ windowDays: 7, knotMinutes: 60 }, next => saved.push(next));
    expect(items.map(item => ("label" in item ? item.label : ""))).toEqual(["Dashboard", "Time window", "Knot size"]);
    const window = items[1];
    const knot = items[2];
    if (window?.kind !== "cycle" || knot?.kind !== "cycle") throw new Error("expected cycle items");
    expect(window.options).toEqual(["1d", "3d", "7d", "10d", "30d"]);
    expect(window.get()).toBe("7d");
    expect(knot.options).toEqual(["15m", "30m", "1h", "2h", "4h"]);
    expect(knot.get()).toBe("1h");
    window.set("10d");
    knot.set("15m");
    expect(saved).toEqual([
      { windowDays: 10, knotMinutes: 60 },
      { windowDays: 7, knotMinutes: 15 },
    ]);
  });
});

describe("startViewItem", () => {
  it("offers the views that are turned on, and saves the chosen one", () => {
    const saved: unknown[] = [];
    const start = startViewItem(["dashboard", "git", "jenkins"], "jenkins", view => saved.push(view));
    if (start.kind !== "cycle") throw new Error("expected a cycle item");
    expect(start.label).toBe("Start in");
    expect(start.options).toEqual(["Dashboard", "Git", "Jenkins"]);
    expect(start.get()).toBe("Jenkins");
    start.set("Dashboard");
    expect(saved).toEqual(["dashboard"]);
  });

  it("shows Git when the chosen view's provider is turned off, as codepulse starts there", () => {
    const start = startViewItem(["dashboard", "git"], "snyk", () => {});
    if (start.kind !== "cycle") throw new Error("expected a cycle item");
    expect(start.get()).toBe("Git");
  });
});

describe("buildGitHubProviderItems", () => {
  const baseCfg: GitHubMenuConfig = {
    enabled: true,
    tokenEnvVar: "GITHUB_TOKEN",
    trustedEnterpriseHost: null,
    fetchDepth: 20,
    cacheLimit: 20,
    autoRefreshSeconds: 120,
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

  it("cycles fetch size, cache count, and auto refresh", () => {
    let changed = baseCfg;
    let persisted = baseCfg;
    const items = buildGitHubProviderItems(
      baseCfg,
      "https://github.com/owner/repo.git",
      "env",
      cfg => {
        changed = cfg;
      },
      cfg => {
        persisted = cfg;
      },
    );
    const fetchSize = items.find(item => item.kind === "cycle" && item.label === "Fetch size");
    const cacheCount = items.find(item => item.kind === "cycle" && item.label === "Cache count");
    const autoRefresh = items.find(item => item.kind === "cycle" && item.label === "Auto refresh");
    expect(fetchSize?.kind).toBe("cycle");
    expect(cacheCount?.kind).toBe("cycle");
    expect(autoRefresh?.kind).toBe("cycle");
    if (fetchSize?.kind !== "cycle" || cacheCount?.kind !== "cycle" || autoRefresh?.kind !== "cycle") return;
    fetchSize.set("10");
    expect(changed.fetchDepth).toBe(10);
    expect(fetchSize.options).toEqual(["10", "20", "50"]);
    expect(cacheCount.options).toEqual(["10", "20", "50", "100", "200", "500"]);
    for (const limit of [10, 20, 50, 100, 200, 500] as const) {
      cacheCount.set(String(limit));
      expect(changed.cacheLimit).toBe(limit);
      expect(persisted).toEqual(changed);
      expect(changed.fetchDepth).toBe(20);
    }
    autoRefresh.set("5m");
    expect(changed.autoRefreshSeconds).toBe(300);
  });
});

describe("buildOpenShiftProviderItems", () => {
  it("validates HTTPS server and DNS namespaces", () => {
    const cfg: OpenShiftMenuConfig = {
      enabled: true,
      serverUrl: "https://api.example.com:6443",
      consoleUrl: "",
      tokenEnvVar: "OPENSHIFT_TOKEN",
      namespaces: [],
      commitShaAnnotation: "dev/commit-sha",
      cacheLimit: 20,
      fetchDepth: 20,
      autoRefreshSeconds: 120,
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

  it("Console takes an HTTPS console URL or nothing, after Server", () => {
    const cfg: OpenShiftMenuConfig = {
      enabled: true,
      serverUrl: "https://api.example.com:6443",
      consoleUrl: "",
      tokenEnvVar: "OPENSHIFT_TOKEN",
      namespaces: [],
      commitShaAnnotation: "dev/commit-sha",
      cacheLimit: 20,
      fetchDepth: 20,
      autoRefreshSeconds: 120,
    };
    let changed = cfg;
    const items = buildOpenShiftProviderItems(cfg, next => {
      changed = next;
    });
    const labels = items.map(item => ("label" in item ? item.label : ""));
    expect(labels.indexOf("Console")).toBe(labels.indexOf("Server") + 1);
    const console = items.find(item => item.kind === "editable" && item.label === "Console");
    if (console?.kind !== "editable") throw new Error("Expected the Console field");
    expect(console.valid?.()).toBe(true);
    expect(console.isDraftValid?.("")).toBe(true);
    expect(console.isDraftValid?.("https://console-openshift-console.apps.example.com")).toBe(true);
    expect(console.isDraftValid?.("http://console.example.com")).toBe(false);
    console.set(" https://console.example.com ");
    expect(changed.consoleUrl).toBe("https://console.example.com");
    console.set("");
    expect(changed.consoleUrl).toBe("");
  });

  it("cycles Auto refresh through off/2m/5m/10m", () => {
    const cfg: OpenShiftMenuConfig = {
      enabled: true,
      serverUrl: "https://api.example.com:6443",
      consoleUrl: "",
      tokenEnvVar: "OPENSHIFT_TOKEN",
      namespaces: ["ns"],
      commitShaAnnotation: "dev/commit-sha",
      cacheLimit: 20,
      fetchDepth: 20,
      autoRefreshSeconds: 120,
    };
    let changed = cfg;
    const items = buildOpenShiftProviderItems(cfg, next => {
      changed = next;
    });
    const cycle = items.find(item => item.kind === "cycle" && item.label === "Auto refresh");
    expect(cycle?.kind).toBe("cycle");
    if (cycle?.kind !== "cycle") return;
    expect(cycle.options).toEqual(["off", "2m", "5m", "10m"]);
    expect(cycle.get()).toBe("2m");
    cycle.set("off");
    expect(changed.autoRefreshSeconds).toBe(0);
    cycle.set("10m");
    expect(changed.autoRefreshSeconds).toBe(600);
  });

  it("offers and persists every cache option without expanding fetch size", () => {
    const cfg: OpenShiftMenuConfig = {
      enabled: true,
      serverUrl: "https://api.example.com:6443",
      consoleUrl: "",
      tokenEnvVar: "OPENSHIFT_TOKEN",
      namespaces: [],
      commitShaAnnotation: "dev/commit-sha",
      cacheLimit: 20,
      fetchDepth: 20,
      autoRefreshSeconds: 120,
    };
    let changed = cfg;
    let persisted = cfg;
    const items = buildOpenShiftProviderItems(
      cfg,
      next => {
        changed = next;
      },
      next => {
        persisted = next;
      },
    );
    const cacheCount = items.find(item => item.kind === "cycle" && item.label === "Cache count");
    const fetchSize = items.find(item => item.kind === "cycle" && item.label === "Fetch size");
    if (cacheCount?.kind !== "cycle" || fetchSize?.kind !== "cycle") throw new Error("expected limit rows");
    expect(cacheCount.options).toEqual(["10", "20", "50", "100", "200", "500"]);
    expect(fetchSize.options).toEqual(["10", "20", "50"]);
    for (const limit of [10, 20, 50, 100, 200, 500] as const) {
      cacheCount.set(String(limit));
      expect(changed.cacheLimit).toBe(limit);
      expect(persisted).toEqual(changed);
      expect(changed.fetchDepth).toBe(20);
    }
  });
});

describe("buildJenkinsProviderItems", () => {
  it("adds a job URL for API auto-detection", () => {
    const baseCfg: JenkinsMenuConfig = {
      enabled: true,
      username: "user",
      tokenEnvVar: "JENKINS_TOKEN",
      fetchDepth: 20,
      cacheLimit: 20,
      autoRefreshSeconds: 120,
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

  it("cycles fetch size, cache count, and auto refresh", () => {
    const baseCfg: JenkinsMenuConfig = {
      enabled: true,
      username: "user",
      tokenEnvVar: "JENKINS_TOKEN",
      fetchDepth: 20,
      cacheLimit: 20,
      autoRefreshSeconds: 120,
      jobs: [],
    };
    let changed = baseCfg;
    let persisted = baseCfg;
    const items = buildJenkinsProviderItems(
      baseCfg,
      cfg => {
        changed = cfg;
      },
      cfg => {
        persisted = cfg;
      },
    );
    const fetchSize = items.find(item => item.kind === "cycle" && item.label === "Fetch size");
    const cacheCount = items.find(item => item.kind === "cycle" && item.label === "Cache count");
    const autoRefresh = items.find(item => item.kind === "cycle" && item.label === "Auto refresh");
    expect(fetchSize?.kind).toBe("cycle");
    expect(cacheCount?.kind).toBe("cycle");
    expect(autoRefresh?.kind).toBe("cycle");
    if (fetchSize?.kind !== "cycle" || cacheCount?.kind !== "cycle" || autoRefresh?.kind !== "cycle") return;
    expect(fetchSize.get()).toBe("20");
    expect(fetchSize.options).toEqual(["10", "20", "50"]);
    fetchSize.set("10");
    expect(changed.fetchDepth).toBe(10);
    fetchSize.set("50");
    expect(changed.fetchDepth).toBe(50);
    expect(cacheCount.options).toEqual(["10", "20", "50", "100", "200", "500"]);
    for (const limit of [10, 20, 50, 100, 200, 500] as const) {
      cacheCount.set(String(limit));
      expect(changed.cacheLimit).toBe(limit);
      expect(persisted).toEqual(changed);
      expect(changed.fetchDepth).toBe(20);
    }
    expect(autoRefresh.options).toEqual(["off", "2m", "5m", "10m"]);
    autoRefresh.set("off");
    expect(changed.autoRefreshSeconds).toBe(0);
    autoRefresh.set("10m");
    expect(changed.autoRefreshSeconds).toBe(600);
  });
});

describe("buildSnykProviderItems", () => {
  it("offers and persists every bounded cache option", () => {
    const cfg: SnykMenuConfig = {
      enabled: true,
      tokenEnvVar: "SNYK_TOKEN",
      autoScanBranches: [],
      maxCachedScans: 20,
    };
    let changed = cfg;
    let persisted = cfg;
    const items = buildSnykProviderItems(
      cfg,
      () => [],
      next => {
        changed = next;
      },
      next => {
        persisted = next;
      },
    );
    const cacheCount = items.find(item => item.kind === "cycle" && item.label === "Cache count");
    if (cacheCount?.kind !== "cycle") throw new Error("expected cache row");
    expect(cacheCount.get()).toBe("20");
    expect(cacheCount.options).toEqual(["10", "20", "50", "100", "200", "500"]);
    for (const limit of [10, 20, 50, 100, 200, 500] as const) {
      cacheCount.set(String(limit));
      expect(changed.maxCachedScans).toBe(limit);
      expect(persisted).toEqual(changed);
    }
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

describe("provider menu consistency", () => {
  const github: GitHubMenuConfig = {
    enabled: true,
    tokenEnvVar: "GITHUB_TOKEN",
    trustedEnterpriseHost: null,
    fetchDepth: 20,
    cacheLimit: 20,
    autoRefreshSeconds: 120,
  };
  const jenkins: JenkinsMenuConfig = {
    enabled: true,
    tokenEnvVar: "JENKINS_TOKEN",
    fetchDepth: 20,
    cacheLimit: 20,
    autoRefreshSeconds: 120,
    jobs: [{ url: "https://jenkins.example.com/job/app/" }],
  };
  const openshift: OpenShiftMenuConfig = {
    enabled: true,
    serverUrl: "https://api.example.com:6443",
    consoleUrl: "",
    tokenEnvVar: "OPENSHIFT_TOKEN",
    namespaces: ["team-a"],
    commitShaAnnotation: "dev/commit-sha",
    cacheLimit: 20,
    fetchDepth: 20,
    autoRefreshSeconds: 120,
  };
  const snyk: SnykMenuConfig = { enabled: true, tokenEnvVar: "SNYK_TOKEN", autoScanBranches: [], maxCachedScans: 20 };
  const editable = (items: ReturnType<typeof buildGitHubProviderItems>, label: string) => {
    const item = items.find(entry => entry.kind === "editable" && entry.label === label);
    if (item?.kind !== "editable") throw new Error(`Missing editable ${label}`);
    return item;
  };

  it("every Token row asks for a variable name, rejects invalid names and falls back to its default", () => {
    const saved: string[] = [];
    const cases = [
      [
        buildGitHubProviderItems(github, "https://github.com/o/r.git", "env", c => saved.push(c.tokenEnvVar)),
        "GITHUB_TOKEN",
      ],
      [buildJenkinsProviderItems(jenkins, c => saved.push(c.tokenEnvVar)), "JENKINS_TOKEN"],
      [buildOpenShiftProviderItems(openshift, c => saved.push(c.tokenEnvVar)), "OPENSHIFT_TOKEN"],
      [
        buildSnykProviderItems(
          snyk,
          () => [],
          c => saved.push(c.tokenEnvVar),
        ),
        "SNYK_TOKEN",
      ],
    ] as const;
    for (const [items, fallback] of cases) {
      const token = editable(items, "Token");
      expect(token.placeholder).toBe("Enter variable name...");
      expect(token.isDraftValid?.("MY TOKEN")).toBe(false);
      expect(token.isDraftValid?.("MY_TOKEN")).toBe(true);
      token.set("  ");
      expect(saved.at(-1)).toBe(fallback);
    }
  });

  it("duplicate namespaces and job URLs are invalid drafts, like duplicate Snyk branches", () => {
    const namespace = editable(buildOpenShiftProviderItems(openshift), "New namespace");
    expect(namespace.isDraftValid?.("team-a")).toBe(false);
    expect(namespace.isDraftValid?.("team-b")).toBe(true);
    const job = editable(buildJenkinsProviderItems(jenkins), "New job");
    expect(job.isDraftValid?.("https://jenkins.example.com/job/app")).toBe(false);
    expect(job.isDraftValid?.("https://jenkins.example.com/job/other/")).toBe(true);
  });

  it("Snyk shows when it last scanned, like the other providers' Last refresh", () => {
    const items = buildSnykProviderItems(
      snyk,
      () => [],
      undefined,
      undefined,
      () => "2m ago",
    );
    const lastScan = items.find(item => item.kind === "info" && item.label === "Last scan");
    expect(lastScan?.kind === "info" && lastScan.get()).toBe("2m ago");
  });
});

test("a last fetch the clock puts in the future reads as just now, not a negative age", () => {
  const now = Date.now();
  expect(relativeAgeLabel(new Date(now + 22_325_948_000))).toBe("just now");
  expect(relativeAgeLabel(new Date(now - 5_000))).toBe("5s ago");
  expect(relativeAgeLabel(new Date(now - 3 * 3_600_000))).toBe("3h ago");
});
