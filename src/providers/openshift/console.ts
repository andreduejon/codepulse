import type { OpenShiftResource, OpenShiftResourceKind } from "./types";
import { isValidOpenShiftServerUrl } from "./validation";

/** The web console's page of each kind. A tag has no page of its own, so it opens its image stream. */
const CONSOLE_KIND_PATH: Record<OpenShiftResourceKind, string> = {
  Build: "builds",
  Deployment: "deployments",
  DeploymentConfig: "deploymentconfigs",
  ImageStreamTag: "imagestreams",
  Pod: "pods",
};

/**
 * A namespace or resource page in the OpenShift web console. The console URL is its own setting: it cannot be worked
 * out from the API server URL. Null without a valid console URL.
 */
export function openShiftConsoleUrl(
  consoleUrl: string,
  target: Readonly<{ namespace: string; resource?: OpenShiftResource }>,
): string | null {
  if (!isValidOpenShiftServerUrl(consoleUrl)) return null;
  const base = consoleUrl.trim().replace(/\/+$/, "");
  const ns = encodeURIComponent(target.namespace);
  const resource = target.resource;
  if (!resource) return `${base}/k8s/cluster/projects/${ns}`;
  const name = resource.kind === "ImageStreamTag" ? (resource.name.split(":")[0] ?? resource.name) : resource.name;
  return `${base}/k8s/ns/${ns}/${CONSOLE_KIND_PATH[resource.kind]}/${encodeURIComponent(name)}`;
}
