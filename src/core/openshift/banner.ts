/** OpenShift's messages: what its status and banners say. */
import { banners } from "../banner";

export const OPENSHIFT_BANNER = banners({
  noServer: "OpenShift unavailable. Server URL not configured.",
  noNamespaces: "OpenShift unavailable. No namespaces configured.",
  missingToken: (envVar: string) => `OpenShift unavailable. Missing ${envVar}.`,
  tokenExpired: "OpenShift token expired. Live data unavailable. Reload to retry.",
  unavailable: "OpenShift unavailable.",
  inventoryFailed: "OpenShift inventory failed.",
  inventoryPartial: "OpenShift inventory partially failed.",
  invalidNamespace: "OpenShift namespace invalid.",
  timeout: "OpenShift request timed out.",
  eventsDenied: (namespaces: readonly string[]) =>
    `No permission to list events in ${namespaces.join(", ")}. The token needs list on events.`,
  watchDenied: "OpenShift watch denied. Resource data might be stale. Reload to refresh.",
} as const);
