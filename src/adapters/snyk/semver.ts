/** The runtime's semantic versions, for the override rules (core/snyk/overrides.ts). */
import type { Semver } from "../../core/snyk/overrides";

export const bunSemver: Semver = {
  satisfies: (version, range) => Bun.semver.satisfies(version, range),
  order: (a, b) => Bun.semver.order(a, b),
};
