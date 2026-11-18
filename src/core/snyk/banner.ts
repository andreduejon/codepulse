/** Snyk's messages: what its status and banners say. */
import { banners } from "../banner";

export const SNYK_BANNER = banners({
  disabled: "Snyk is disabled.",
  missingToken: (envVar: string) => `Snyk unavailable. Missing ${envVar}.`,
  exactCommit: "Snyk scan requires an exact commit SHA.",
  partialRescan: "Partial scan. Kept last complete snapshot.",
  noDependencyProject:
    "No supported dependency project. Dependency graphs support Bun, npm, pnpm, Yarn, and Maven projects.",
} as const);
