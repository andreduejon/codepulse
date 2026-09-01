import {
  DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS,
  PROVIDER_AUTO_REFRESH_MS,
  PROVIDER_AUTO_REFRESH_OPTIONS,
  PROVIDER_AUTO_REFRESH_SECONDS,
  PROVIDER_MS_TO_LABEL,
  type ProviderAutoRefreshSeconds,
  type ProviderLimit,
} from "../shared/auto-refresh";

export type OpenShiftCacheLimit = ProviderLimit;

export const OPENSHIFT_AUTO_REFRESH_OPTIONS = PROVIDER_AUTO_REFRESH_OPTIONS;
export const OPENSHIFT_AUTO_REFRESH_SECONDS = PROVIDER_AUTO_REFRESH_SECONDS;
export type OpenShiftAutoRefreshSeconds = ProviderAutoRefreshSeconds;
export const DEFAULT_OPENSHIFT_AUTO_REFRESH_SECONDS = DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS;
export const OPENSHIFT_AUTO_REFRESH_MS = PROVIDER_AUTO_REFRESH_MS;
export const OPENSHIFT_MS_TO_LABEL = PROVIDER_MS_TO_LABEL;
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
  /** Full API object. Kept for Build JSON dialog / disk cache. */
  object?: unknown;
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
