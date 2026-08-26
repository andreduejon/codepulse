export type OpenShiftCacheLimit = 10 | 20 | 50;

export interface OpenShiftProviderConfig {
  enabled: boolean;
  serverUrl: string;
  tokenEnvVar: string;
  namespaces: string[];
  commitShaAnnotation: string;
  cacheLimit: OpenShiftCacheLimit;
  fetchDepth: OpenShiftCacheLimit;
}

export const DEFAULT_OPENSHIFT_CONFIG: OpenShiftProviderConfig = {
  enabled: false,
  serverUrl: "",
  tokenEnvVar: "OPENSHIFT_TOKEN",
  namespaces: [],
  commitShaAnnotation: "dev/commit-sha",
  cacheLimit: 20,
  fetchDepth: 20,
};

export const OPENSHIFT_TERMINAL_PHASES = new Set(["Complete", "Failed", "Error", "Cancelled"]);

export type OpenShiftResourceKind = "Build" | "ImageStreamTag" | "Deployment" | "DeploymentConfig" | "Pod";
export type OpenShiftInventoryKind = OpenShiftResourceKind | "ReplicaSet" | "ReplicationController";
export type OpenShiftStatus = "pass" | "fail" | "running" | "unknown";

export interface OpenShiftOwnerReference {
  kind: string;
  uid: string;
}

export interface OpenShiftControllerReference {
  kind: "ReplicaSet" | "ReplicationController";
  namespace: string;
  uid: string;
  ownerReferences: OpenShiftOwnerReference[];
}

export interface OpenShiftResource {
  id: string;
  kind: OpenShiftResourceKind;
  namespace: string;
  name: string;
  status: OpenShiftStatus;
  imageRefs: string[];
  commitSha?: string;
  uid?: string;
  ownerReferences?: OpenShiftOwnerReference[];
  terminating?: boolean;
  updatedAt?: string | null;
  podSelector?: Record<string, string>;
}

export interface OpenShiftNamespaceData {
  namespace: string;
  builds: OpenShiftResource[];
  imageStreamTags: OpenShiftResource[];
  deployments: OpenShiftResource[];
  deploymentConfigs: OpenShiftResource[];
  pods: OpenShiftResource[];
}

export interface OpenShiftCommitData {
  sha: string;
  namespaces: OpenShiftNamespaceData[];
  /** Live inventory was applied or skipped (no digest seed). Not a cache/UI flag. */
  liveFetched: boolean;
}

/** Terminal Builds are persisted. Everything else stays in the live lane. */
export function isCachedOpenShiftResource(resource: OpenShiftResource): boolean {
  return resource.kind === "Build" && (resource.status === "pass" || resource.status === "fail");
}

export interface OpenShiftInventoryResult {
  data: Map<string, OpenShiftCommitData>;
  error: string | null;
  failures: OpenShiftInventoryFailure[];
  successfulRequests: number;
}

export interface OpenShiftInventoryFailure {
  namespace: string;
  kind: OpenShiftInventoryKind;
  path: string;
  error: string;
}
