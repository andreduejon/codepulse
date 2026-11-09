import { afterEach, describe, expect, test } from "bun:test";
import {
  BANNER,
  bannerOrFallback,
  bannerParts,
  classifyGitFailure,
  debugError,
  displayBanner,
  isBanner,
} from "../src/debug/banner";
import { clearDebugEvents, getDebugEvents } from "../src/debug/events";

afterEach(() => clearDebugEvents());

describe("banner catalog", () => {
  test("recognizes static banner sentences", () => {
    expect(isBanner(BANNER.git.fetchFailed)).toBe(true);
    expect(isBanner(BANNER.github.jobsFailed)).toBe(true);
    expect(isBanner("raw stderr dump")).toBe(false);
  });

  test("token expiry names cause, live-data effect and the retry, for every provider", () => {
    expect(BANNER.openshift.tokenExpired).toBe("OpenShift token expired. Live data unavailable. Reload to retry.");
    expect(BANNER.github.tokenExpired).toBe("GitHub token expired. Live data unavailable. Reload to retry.");
    expect(BANNER.jenkins.tokenExpired).toBe("Jenkins token expired. Live data unavailable. Reload to retry.");
    expect(isBanner(BANNER.openshift.tokenExpired)).toBe(true);
  });

  test("GitHub and Jenkins token expiry banners are catalogued", () => {
    expect(isBanner(BANNER.github.tokenExpired)).toBe(true);
    expect(isBanner(BANNER.jenkins.tokenExpired)).toBe(true);
  });

  test("Jenkins incomplete-data warning is catalogued", () => {
    expect(BANNER.jenkins.incomplete).toBe("Jenkins data incomplete. Branch-job limit reached.");
    expect(isBanner(BANNER.jenkins.incomplete)).toBe(true);
  });

  test("keeps known banners and dumps unknown detail to debug", () => {
    expect(bannerOrFallback(new Error(BANNER.jenkins.timeout), BANNER.jenkins.fetchFailed, "Jenkins")).toBe(
      BANNER.jenkins.timeout,
    );
    expect(getDebugEvents()).toHaveLength(0);

    expect(bannerOrFallback(new Error("ECONNRESET boom"), BANNER.github.fetchFailed, "GitHub")).toBe(
      BANNER.github.fetchFailed,
    );
    expect(getDebugEvents()[0]).toMatchObject({ source: "GitHub", message: "ECONNRESET boom", status: "error" });
  });

  test("redacts secrets in debug detail", () => {
    debugError("Git", "Authorization: secret-token");
    expect(getDebugEvents()[0].message).toBe("Authorization: ********");
  });

  test("maps git fetch dumps to short banners", () => {
    const dump =
      "fatal: unable to access 'https://github.com/lht-general/e-scraphandling-backend.git/': Failed to connect to github.com port 443 after 975630 ms: Timeout was reached";
    expect(classifyGitFailure(dump)).toBe(BANNER.git.fetchTimedOut);
    expect(displayBanner(dump, BANNER.git.fetchFailed)).toBe(BANNER.git.fetchTimedOut);
    expect(displayBanner(BANNER.git.fetchFailed, BANNER.git.logFailed)).toBe(BANNER.git.fetchFailed);
  });
});

describe("bannerParts", () => {
  test.each([
    ["Git", BANNER.git.fetchFailed, "Fetch failed", []],
    ["GitHub Actions", BANNER.github.missingToken("GITHUB_TOKEN"), "Unavailable", ["Missing GITHUB_TOKEN."]],
    ["GitHub Actions", BANNER.github.disabled, "Disabled", []],
    ["Jenkins", BANNER.jenkins.incomplete, "Data incomplete", ["Branch-job limit reached."]],
    ["OpenShift", BANNER.openshift.watchDenied, "Watch denied", ["Resource data might be stale. Reload to refresh."]],
    ["Snyk", "Partial scan. Kept last complete snapshot.", "Partial scan", ["Kept last complete snapshot."]],
    [
      "Snyk",
      BANNER.snyk.noDependencyProject,
      "No supported dependency project",
      ["Dependency graphs support Bun, npm, pnpm, Yarn, and Maven projects."],
    ],
  ])("%s: %s", (source, message, title, detail) => {
    expect(bannerParts(source, message)).toEqual({ title, detail });
  });

  test("keeps a headline that is only the source name and splits extra lines into detail", () => {
    expect(bannerParts("Git", "Git.")).toEqual({ title: "Git", detail: [] });
    expect(bannerParts("Git", "GitHub fetch failed.")).toEqual({ title: "GitHub fetch failed", detail: [] });
    expect(bannerParts("Snyk", "Scan failed.\nsnyk exited 2")).toEqual({
      title: "Scan failed",
      detail: ["snyk exited 2"],
    });
  });
});
