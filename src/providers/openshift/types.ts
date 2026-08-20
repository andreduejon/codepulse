export interface OpenShiftProviderConfig {
  enabled: boolean;
  serverUrl: string;
  tokenEnvVar: string;
  namespaces: string[];
  commitShaAnnotation: string;
}

export const DEFAULT_OPENSHIFT_CONFIG: OpenShiftProviderConfig = {
  enabled: false,
  serverUrl: "",
  tokenEnvVar: "OPENSHIFT_TOKEN",
  namespaces: [],
  commitShaAnnotation: "dev/commit-sha",
};

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
  raw: unknown;
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
  resolved: boolean;
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
