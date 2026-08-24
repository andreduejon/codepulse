import { afterEach, describe, expect, test } from "bun:test";
import { BANNER, bannerOrFallback, debugError, isBanner } from "../src/debug/banner";
import { clearDebugEvents, getDebugEvents } from "../src/debug/events";

afterEach(() => clearDebugEvents());

describe("banner catalog", () => {
  test("recognizes static banner sentences", () => {
    expect(isBanner(BANNER.git.fetchFailed)).toBe(true);
    expect(isBanner(BANNER.github.jobsFailed)).toBe(true);
    expect(isBanner("raw stderr dump")).toBe(false);
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
});
