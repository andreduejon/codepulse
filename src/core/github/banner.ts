/** GitHub Actions's messages: what its status and banners say. */
import { banners } from "../banner";

export const GITHUB_BANNER = banners({
  disabled: "GitHub is disabled.",
  noRemote: "GitHub unavailable. No remote.",
  untrustedHost: "GitHub unavailable. Untrusted host.",
  missingToken: (envVar: string) => `GitHub unavailable. Missing ${envVar}.`,
  unavailable: "GitHub unavailable.",
  rateLimit: "GitHub rate limit exceeded.",
  fetchFailed: "GitHub fetch failed.",
  tokenExpired: "GitHub token expired. Live data unavailable. Reload to retry.",
  jobsFailed: "GitHub jobs failed.",
  incomplete: "GitHub data incomplete. Page limit reached.",
  logFailed: "GitHub log failed.",
  timeout: "GitHub request timed out.",
} as const);
