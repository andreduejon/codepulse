/**
 * Every provider tab of the detail view, and what each provider hands it. Adding a provider: its source type here,
 * its entry in the table, and its source in `app-content.tsx`.
 */

import type { DetailTab } from "../context/state";
import { type GitHubDetailSource, githubDetail } from "./github-actions/detail-entry";
import { type JenkinsDetailSource, jenkinsDetail } from "./jenkins/detail-entry";
import { type OpenShiftDetailSource, openshiftDetail } from "./openshift/detail-entry";
import type { DetailEntry } from "./shared/detail-entry";
import { type SnykDetailSource, snykDependenciesDetail, snykVulnerabilitiesDetail } from "./snyk/detail-entry";

/** What each provider hands the detail view, by provider view. */
export interface ProviderDetailSources {
  "github-actions": GitHubDetailSource;
  jenkins: JenkinsDetailSource;
  openshift: OpenShiftDetailSource;
  snyk: SnykDetailSource;
}

/** The provider tabs: what each renders and the legend below it. */
export const DETAIL_ENTRIES: readonly (readonly [DetailTab, DetailEntry])[] = [
  ["github-actions", githubDetail],
  ["jenkins", jenkinsDetail],
  ["openshift", openshiftDetail],
  ["snyk", snykVulnerabilitiesDetail],
  ["snyk-deps", snykDependenciesDetail],
];

export const detailEntryFor = (tab: DetailTab) => DETAIL_ENTRIES.find(([id]) => id === tab)?.[1] ?? null;
