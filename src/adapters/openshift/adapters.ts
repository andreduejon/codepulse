/**
 * OpenShift's adapters for its service: the HTTP API and watches, the SQLite cache and the token from the
 * environment. Calls go through the modules at call time, so a test's spy on one of their functions sees them.
 */
import type { OpenShiftAdapters } from "../../core/openshift/service";
import * as api from "./api";
import { OpenShiftCache } from "./cache";

export function openShiftAdapters(cacheRoot?: string): OpenShiftAdapters {
  return {
    api: {
      fetchOpenShiftInventory: (...args) => api.fetchOpenShiftInventory(...args),
      fetchOpenShiftResources: (...args) => api.fetchOpenShiftResources(...args),
      watchOpenShiftStream: (...args) => api.watchOpenShiftStream(...args),
      fetchOpenShiftBuildLog: (...args) => api.fetchOpenShiftBuildLog(...args),
      fetchOpenShiftPodLog: (...args) => api.fetchOpenShiftPodLog(...args),
      followOpenShiftLog: (...args) => api.followOpenShiftLog(...args),
      fetchOpenShiftObject: (...args) => api.fetchOpenShiftObject(...args),
      fetchOpenShiftEvents: (...args) => api.fetchOpenShiftEvents(...args),
    },
    cache: maxEntries => new OpenShiftCache({ root: cacheRoot, maxEntries }),
    token: envVar => api.getOpenShiftToken(envVar),
  };
}
