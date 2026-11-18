import { expect, test } from "bun:test";
import { dashboardFetchMessage, fetchErrorKey } from "./fetch-errors";

test("one failing provider reads as on its own tab", () => {
  expect(dashboardFetchMessage([{ source: "GitHub", message: "GitHub rate limit exceeded." }])).toEqual({
    kind: "error",
    source: "GitHub",
    message: "GitHub rate limit exceeded.",
  });
});

test("several failing providers share one box, a line each", () => {
  expect(
    dashboardFetchMessage([
      { source: "GitHub", message: "GitHub fetch failed." },
      { source: "Jenkins", message: "Jenkins request timed out." },
      { source: "OpenShift", message: "OpenShift inventory failed." },
    ]),
  ).toEqual({
    kind: "error",
    title: "Errors from GitHub, Jenkins and OpenShift",
    message: "GitHub fetch failed.\nJenkins request timed out.\nOpenShift inventory failed.",
  });
  expect(
    dashboardFetchMessage([
      { source: "GitHub", message: "GitHub fetch failed." },
      { source: "Snyk", message: "Snyk scan failed." },
    ])?.title,
  ).toBe("Errors from GitHub and Snyk");
});

test("nothing failing, nothing to say", () => {
  expect(dashboardFetchMessage([])).toBeNull();
});

test("an error's key changes with its text, so a new error shows after an old one was closed", () => {
  const old = fetchErrorKey({ source: "GitHub", message: "GitHub fetch failed." });
  expect(fetchErrorKey({ source: "GitHub", message: "GitHub fetch failed." })).toBe(old);
  expect(fetchErrorKey({ source: "GitHub", message: "GitHub rate limit exceeded." })).not.toBe(old);
});
