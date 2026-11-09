import type { ProviderTreeJob } from "../shared/provider-run-tree";
import type { JenkinsFailedTest, JenkinsJob, JenkinsTestReport } from "./types";

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

const count = (value: number) => value.toLocaleString("en-US");

/**
 * The build's test report as a `Tests` row beside the Pipeline: its counts after the name, muted, and each failed
 * test as a row under it. `o` opens the report page.
 */
export function jenkinsTestsJob(report: JenkinsTestReport, buildUrl: string): ProviderTreeJob<JenkinsJob> {
  const counts = [
    report.failCount > 0 ? `${count(report.failCount)} failed` : "",
    report.passCount > 0 ? `${count(report.passCount)} passed` : "",
    report.skipCount > 0 ? `${count(report.skipCount)} skipped` : "",
  ].filter(Boolean);
  const conclusion = report.failCount > 0 ? "failure" : "success";
  const raw: JenkinsJob = {
    id: "tests",
    name: "Tests",
    status: "completed",
    conclusion,
    startedAt: null,
    completedAt: null,
    steps: [],
    tests: report,
  };
  return {
    id: "tests",
    name: "Tests",
    tail: counts.length > 0 ? `  ${counts.join(" · ")}` : undefined,
    status: "completed",
    conclusion,
    startedAt: null,
    completedAt: null,
    steps: [],
    url: `${buildUrl.replace(/\/+$/, "")}/testReport/`,
    notes: report.failed.map((test, index) => ({ id: String(index), mark: "fail" as const, text: testLabel(test) })),
    raw,
  };
}
