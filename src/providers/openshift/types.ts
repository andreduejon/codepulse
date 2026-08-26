export type OpenShiftCacheLimit = 10 | 20 | 50;

export const OPENSHIFT_AUTO_REFRESH_OPTIONS = ["off", "2m", "5m", "10m"] as const;
export const OPENSHIFT_AUTO_REFRESH_SECONDS = [0, 120, 300, 600] as const;
export type OpenShiftAutoRefreshSeconds = (typeof OPENSHIFT_AUTO_REFRESH_SECONDS)[number];
export const DEFAULT_OPENSHIFT_AUTO_REFRESH_SECONDS: OpenShiftAutoRefreshSeconds = 120;
export const OPENSHIFT_AUTO_REFRESH_MS: Record<(typeof OPENSHIFT_AUTO_REFRESH_OPTIONS)[number], number> = {
  off: 0,
  "2m": 120_000,
  "5m": 300_000,
  "10m": 600_000,
};
export const OPENSHIFT_MS_TO_LABEL: Record<number, string> = {
  0: "off",
  120000: "2m",
  300000: "5m",
  600000: "10m",
};
export const OPENSHIFT_LOG_FOLLOW_MAX_LINES = 1000;
export const OPENSHIFT_WATCH_KINDS = ["Deployment", "DeploymentConfig", "Pod"] as const;
export type OpenShiftWatchKind = (typeof OPENSHIFT_WATCH_KINDS)[number];

export interface OpenShiftProviderConfig {
  enabled: boolean;
  serverUrl: string;
  tokenEnvVar: string;
  namespaces: string[];
  commitShaAnnotation: string;
  cacheLimit: OpenShiftCacheLimit;
  fetchDepth: OpenShiftCacheLimit;
  /** Builds + IST poll while OpenShift view is focused. 0 = off. */
  autoRefreshSeconds: OpenShiftAutoRefreshSeconds;
}

export const DEFAULT_OPENSHIFT_CONFIG: OpenShiftProviderConfig = {
  enabled: false,
  serverUrl: "",
  tokenEnvVar: "OPENSHIFT_TOKEN",
  namespaces: [],
  commitShaAnnotation: "dev/commit-sha",
  cacheLimit: 20,
  fetchDepth: 20,
  autoRefreshSeconds: DEFAULT_OPENSHIFT_AUTO_REFRESH_SECONDS,
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
  labels?: Record<string, string>;
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
