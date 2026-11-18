/** Jenkins's messages: what its status and banners say. */
import { banners } from "../banner";

export const JENKINS_BANNER = banners({
  noJobs: "Jenkins unavailable. No jobs configured.",
  noUsername: "Jenkins unavailable. Username not configured.",
  missingToken: (envVar: string) => `Jenkins unavailable. Missing ${envVar}.`,
  authFailed: "Jenkins authentication failed. Live data unavailable. Reload to retry.",
  tokenExpired: "Jenkins token expired. Live data unavailable. Reload to retry.",
  fetchFailed: "Jenkins fetch failed.",
  /** A headline with the counts, then what it means, like the other tab notices. */
  branchLimit: (shown: number, total: number) =>
    `Jenkins branch jobs · ${shown} of ${total} read. Branches in the graph come first. Builds on the other ${total - shown} do not show.`,
  invalidJobUrl: "Jenkins job URL invalid.",
  logFailed: "Jenkins log failed.",
  stagesFailed: "Jenkins stages failed.",
  timeout: "Jenkins request timed out.",
} as const);
