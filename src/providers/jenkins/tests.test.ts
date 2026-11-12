import { expect, test } from "bun:test";
import { jenkinsTestsJob, testFailureText } from "./tests";
import type { JenkinsTestReport } from "./types";

const report: JenkinsTestReport = {
  passCount: 1204,
  failCount: 3,
  skipCount: 12,
  failed: [
    { className: "com.example.PaymentServiceTest", name: "refundsTwice", details: "expected 1", stackTrace: "at A" },
    { className: "OrderMapperTest", name: "mapsCurrency", details: null, stackTrace: null },
  ],
};

test("a test report becomes a Tests row: the failed tests under it, its counts left to the build's summary", () => {
  const job = jenkinsTestsJob(report, "https://jenkins.example.com/job/app/412/");
  expect(job).toMatchObject({
    id: "tests",
    name: "Tests",
    status: "completed",
    conclusion: "failure",
    url: "https://jenkins.example.com/job/app/412/testReport/",
  });
  expect(job.tail).toBeUndefined();
  expect(job.notes).toEqual([
    { id: "0", mark: "fail", text: "PaymentServiceTest › refundsTwice" },
    { id: "1", mark: "fail", text: "OrderMapperTest › mapsCurrency" },
  ]);
});

test("a passing report is a green Tests row without failures", () => {
  const job = jenkinsTestsJob({ passCount: 10, failCount: 0, skipCount: 0, failed: [] }, "https://j/job/app/1/");
  expect(job.tail).toBeUndefined();
  expect(job.conclusion).toBe("success");
  expect(job.notes).toEqual([]);
});

test("a failed test's text: the class and test, the details, then the stack", () => {
  expect(testFailureText(report.failed[0])).toBe("com.example.PaymentServiceTest › refundsTwice\nexpected 1\n\nat A");
  expect(testFailureText(report.failed[1])).toBe("OrderMapperTest › mapsCurrency\nNo error details.");
});
