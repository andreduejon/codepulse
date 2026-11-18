/** Jenkins as a provider module. */
import { jenkinsEvents } from "../../../core/dashboard/events";
import { jenkinsProvider } from "../../../core/jenkins/definition";
import type { JenkinsFailedTest, JenkinsJob, JenkinsRun } from "../../../core/jenkins/types";
import { buildJenkinsProviderItems } from "../../hooks/menu-provider-items";
import { JENKINS_LEGEND } from "../legends";
import { providerModule } from "../module";
import { type JenkinsDetailSource, jenkinsDetail } from "./detail-entry";
import { jenkinsBuildLogTarget, jenkinsTestFailureTarget } from "./log-target";
import { useJenkinsCI } from "./use-jenkins-ci";

export const jenkinsModule = providerModule({
  definition: jenkinsProvider,
  start: ({ state, actions, settings, suspended, onOpenJobLog, adapters }) => {
    const jenkins = useJenkinsCI({ state, actions, config: settings, suspended, adapters });
    const detailSource: JenkinsDetailSource = {
      getCommitData: jenkins.getCommitData,
      fetchJobsForRun: jenkins.fetchJobsForRun,
      fetchCommitData: jenkins.fetchCommitDataForSHA,
      get status() {
        return state.providerStatusFor(jenkinsProvider.id);
      },
      onOpenBuild: (run: JenkinsRun, pipeline: JenkinsJob, entry: number) =>
        onOpenJobLog(jenkinsBuildLogTarget(jenkins, run, pipeline, entry)),
      onOpenTestFailure: (run: JenkinsRun, failed: JenkinsFailedTest[], index: number) =>
        onOpenJobLog(jenkinsTestFailureTarget(run, failed, index)),
    };
    return {
      instance: jenkins,
      getCommitData: jenkins.getCommitData,
      invalidate: jenkins.invalidate,
      refresh: jenkins.refresh,
      heldEvents: app => jenkinsEvents(app, jenkins.heldEntries()),
      detailSource,
    };
  },
  colors: theme => ({ bg: theme.jenkinsBg, fg: theme.jenkinsFg }),
  menuItems: menu =>
    buildJenkinsProviderItems(menu.settings, undefined, menu.update, menu.lastRefresh, menu.tokenIsSet),
  detailEntries: { [jenkinsProvider.id]: jenkinsDetail },
  legend: JENKINS_LEGEND,
});
