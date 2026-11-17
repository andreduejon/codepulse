/** Jenkins as a provider module. */
import { jenkinsEvents } from "../../core/dashboard/events";
import type { JenkinsFailedTest, JenkinsJob, JenkinsRun } from "../../core/jenkins/types";
import type { ProviderModule } from "../module";
import type { JenkinsDetailSource } from "./detail-entry";
import { jenkinsBuildLogTarget, jenkinsTestFailureTarget } from "./log-target";
import { useJenkinsCI } from "./use-jenkins-ci";

export const jenkinsModule = {
  id: "jenkins",
  start: ({ state, actions, settings, suspended, onOpenJobLog }) => {
    const jenkins = useJenkinsCI({ state, actions, config: settings.jenkins, suspended });
    return {
      instance: jenkins,
      getCommitData: jenkins.getCommitData,
      invalidate: jenkins.invalidate,
      refresh: jenkins.refresh,
      heldEvents: app => jenkinsEvents(app, jenkins.heldEntries()),
      detailSource: {
        getCommitData: jenkins.getCommitData,
        fetchJobsForRun: jenkins.fetchJobsForRun,
        fetchCommitData: jenkins.fetchCommitDataForSHA,
        get status() {
          return state.providerStatusFor("jenkins");
        },
        onOpenBuild: (run: JenkinsRun, pipeline: JenkinsJob, entry: number) =>
          onOpenJobLog(jenkinsBuildLogTarget(jenkins, run, pipeline, entry)),
        onOpenTestFailure: (run: JenkinsRun, failed: JenkinsFailedTest[], index: number) =>
          onOpenJobLog(jenkinsTestFailureTarget(run, failed, index)),
      },
    };
  },
} satisfies ProviderModule<ReturnType<typeof useJenkinsCI>, JenkinsDetailSource>;
