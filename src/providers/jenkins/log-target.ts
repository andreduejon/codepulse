import type { JobLogTarget } from "../shared/job-log-dialog";
import { isWholeBuildEntry, jenkinsBuildSummary, jenkinsLogEntries } from "./build-summary";
import { sliceStageLog } from "./stage-log";
import { testFailureText, testLabel } from "./tests";
import type { JenkinsFailedTest, JenkinsJob, JenkinsJobFetchResult, JenkinsRun } from "./types";

const STAGE_IN_PARALLEL = "Runs in parallel: the full log, with the other branches' lines";
const STAGE_NOT_IN_LOG = "Not in the log yet: the full log";

/** What a build log reads from the Jenkins provider. */
export interface JenkinsLogReader {
  fetchRunLog: (run: JenkinsRun) => Promise<string>;
  fetchJobsForRun: (run: JenkinsRun) => Promise<JenkinsJobFetchResult>;
}

/**
 * A Jenkins build in the log viewer at an entry: the full log (its summary, then the console) and each stage's part
 * of the console, ←/→ between them. The summary is read again with the log, so `r` updates a running build.
 */
export function jenkinsBuildLogTarget(
  ci: JenkinsLogReader,
  run: JenkinsRun,
  pipeline: JenkinsJob,
  entry: number,
): JobLogTarget {
  const entries = jenkinsLogEntries(pipeline);
  return {
    provider: "jenkins",
    job: entries[entry] ?? entries[0],
    run,
    jobs: entries,
    noun: "stage",
    fetchLog: async current => {
      const full = await ci.fetchRunLog(run);
      if (!isWholeBuildEntry(current)) {
        const stage = sliceStageLog(full, current.name);
        if (stage.log !== undefined) return stage.log;
        // The title still names the stage, so say why the whole console shows instead, in every view.
        return { log: full, note: stage.missing === "parallel" ? STAGE_IN_PARALLEL : STAGE_NOT_IN_LOG };
      }
      const latest = await ci.fetchJobsForRun(run).catch(() => null);
      return { log: full, summary: jenkinsBuildSummary(latest?.jobs[0] ?? pipeline) };
    },
  };
}

/** A failed test in the log viewer: its error and stack, ←/→ to the build's other failed tests. Null without one. */
export function jenkinsTestFailureTarget(
  run: JenkinsRun,
  failed: readonly JenkinsFailedTest[],
  index: number,
): JobLogTarget | null {
  const entries = failed.map((test, at) => ({ id: `test-${at}`, name: testLabel(test) }));
  const entry = entries[index] ?? entries[0];
  if (!entry) return null;
  return {
    provider: "jenkins",
    job: entry,
    // `o` opens the build's test report.
    run: { name: run.name, runNumber: run.runNumber, url: `${run.url.replace(/\/+$/, "")}/testReport/` },
    jobs: entries,
    noun: "test",
    fetchLog: async current => {
      const test = failed[entries.findIndex(candidate => candidate.id === current.id)];
      return test ? testFailureText(test) : "";
    },
  };
}
