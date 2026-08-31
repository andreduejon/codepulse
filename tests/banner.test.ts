import { afterEach, describe, expect, test } from "bun:test";
import { BANNER, bannerOrFallback, classifyGitFailure, debugError, displayBanner, isBanner } from "../src/debug/banner";
import { clearDebugEvents, getDebugEvents } from "../src/debug/events";

afterEach(() => clearDebugEvents());

describe("banner catalog", () => {
  test("recognizes static banner sentences", () => {
    expect(isBanner(BANNER.git.fetchFailed)).toBe(true);
    expect(isBanner(BANNER.github.jobsFailed)).toBe(true);
    expect(isBanner("raw stderr dump")).toBe(false);
  });

  test("OpenShift token expiry keeps cause and live-data effect", () => {
    expect(BANNER.openshift.tokenExpired).toBe("OpenShift token expired. Live data unavailable.");
    expect(isBanner(BANNER.openshift.tokenExpired)).toBe(true);
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
