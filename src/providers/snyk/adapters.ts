/** Snyk's adapters for its service: the scanner (the Snyk CLI), its cache, and the token in the environment. */
import type { SnykAdapters } from "../../core/snyk/service";
import * as scanner from "./scanner";

export function snykAdapters(): SnykAdapters {
  return {
    scan: options => scanner.scanSnykCommit(options),
    readCache: (...args) => scanner.getCachedSnykScan(...args),
    hasToken: envVar => !!process.env[envVar]?.trim(),
  };
}
