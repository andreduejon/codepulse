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
export type OpenShiftStatus = "pass" | "fail" | "running" | "unknown";

export interface OpenShiftResource {
  id: string;
  kind: OpenShiftResourceKind;
  namespace: string;
  name: string;
  status: OpenShiftStatus;
  imageRefs: string[];
  commitSha?: string;
  updatedAt?: string | null;
  raw: unknown;
}

export interface OpenShiftDetailLine {
  id: string;
  text: string;
  status: OpenShiftStatus;
}

export interface OpenShiftDetailGroup {
  id: string;
  name: string;
  status: OpenShiftStatus;
  lines: OpenShiftDetailLine[];
}

export interface OpenShiftResourceDetailResult {
  groups: OpenShiftDetailGroup[];
  error: string | null;
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
}
