import { describe, expect, test } from "bun:test";
import { DEFAULT_LIVE_SECONDS, DEFAULT_SIZE, DemoOptionError, parseDemoOptions, providerError } from "./options";

describe("parseDemoOptions", () => {
  test("starts interactive with every provider in its normal world", () => {
    const options = parseDemoOptions([]);
    expect(options.play).toBeNull();
    expect(options.size).toEqual(DEFAULT_SIZE);
    expect(options.providers).toEqual({ github: "default", jenkins: "default", openshift: "default", snyk: "default" });
    expect(options.live).toBeNull();
  });

  test("reads a play, its size and one mode per provider", () => {
    const options = parseDemoOptions([
      "--play",
      "j enter shot",
      "--size",
      "120x40",
      "--github",
      "error:rate-limit",
      "--snyk",
      "off",
      "--openshift",
      "empty",
    ]);
    expect(options.play).toBe("j enter shot");
    expect(options.size).toEqual({ width: 120, height: 40 });
    expect(options.providers).toEqual({
      github: "error:rate-limit",
      jenkins: "default",
      openshift: "empty",
      snyk: "off",
    });
    expect(providerError(options, "github")).toBe("rate-limit");
    expect(providerError(options, "jenkins")).toBeNull();
  });

  test("--live takes whole seconds and defaults to a minute", () => {
    expect(parseDemoOptions(["--live"]).live).toBe(DEFAULT_LIVE_SECONDS);
    expect(parseDemoOptions(["--live", "20", "--keep"]).live).toBe(20);
    expect(parseDemoOptions(["--live", "--keep"]).live).toBe(DEFAULT_LIVE_SECONDS);
    expect(() => parseDemoOptions(["--live", "1m"])).toThrow("--live takes whole seconds");
  });

  test.each([
    [["--github", "error:watch-denied"], "--github takes default, empty, off, or error:401|rate-limit|offline"],
    [["--snyk", "broken"], "--snyk takes default, empty, off"],
    [["--size", "160"], "--size takes WIDTHxHEIGHT"],
    [["--size", "160x45"], "--size works with --play"],
    [["--play", "shot", "--live"], "--live is for the interactive demo"],
    [["--latency", "fast"], "--latency takes milliseconds"],
    [
      [
        "--latency",
        "9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999",
      ],
      "--latency takes milliseconds",
    ],
    [
      [
        "--live",
        "9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999",
      ],
      "--live takes whole seconds",
    ],
    [
      [
        "--play",
        "shot",
        "--size",
        "9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999x45",
      ],
      "--size takes WIDTHxHEIGHT",
    ],
    [["--theme", "no-such-theme"], 'Unknown theme "no-such-theme"'],
    [["--play"], "--play needs a value"],
    [["--colour"], "Unknown option --colour"],
  ])("explains a wrong option (%j)", (args, message) => {
    expect(() => parseDemoOptions(args)).toThrow(DemoOptionError);
    expect(() => parseDemoOptions(args)).toThrow(message);
  });
});
