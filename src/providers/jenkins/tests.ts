import type { ProviderTreeJob } from "../shared/provider-run-tree";
import type { JenkinsFailedTest, JenkinsTestReport, JenkinsTreeRow } from "./types";

/** The test's class without its package: `PaymentServiceTest`. */
function shortClassName(className: string): string {
  return className.split(".").at(-1) || className;
}

/** `PaymentServiceTest › refundsTwice`: how a failed test is named in rows and titles. */
export function testLabel(test: JenkinsFailedTest): string {
  return test.className ? `${shortClassName(test.className)} › ${test.name}` : test.name;
}

/** What the log viewer shows for a failed test: its full name, the error, then the stack. */
export function testFailureText(test: JenkinsFailedTest): string {
  const name = test.className ? `${test.className} › ${test.name}` : test.name;
  return [`${name}\n${test.details ?? "No error details."}`, test.stackTrace ?? ""].filter(Boolean).join("\n\n");
}

/**
 * The build's test report as a `Tests` row after the stages, and each failed test as a row under it. Its counts are
 * in the build's summary in the log viewer. `o` opens the report page.
 */
export function jenkinsTestsJob(report: JenkinsTestReport, buildUrl: string): ProviderTreeJob<JenkinsTreeRow> {
  return {
    id: "tests",
    name: "Tests",
    status: "completed",
    conclusion: report.failCount > 0 ? "failure" : "success",
    completedAt: null,
    steps: [],
    url: `${buildUrl.replace(/\/+$/, "")}/testReport/`,
    notes: report.failed.map((test, index) => ({ id: String(index), mark: "fail" as const, text: testLabel(test) })),
    raw: { kind: "tests", report },
  };
}
