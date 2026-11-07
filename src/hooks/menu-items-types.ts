import type { JenkinsJobConfig } from "../providers/jenkins/types";
import type { ProviderAutoRefreshSeconds, ProviderCacheLimit, ProviderLimit } from "../providers/shared/auto-refresh";
import type { SnykCacheLimit } from "../providers/snyk/types";

export type MenuTab = "repository" | "branch" | "providers";

export type SettingItem =
  | { kind: "header"; label: string; tone?: "accent" | "muted"; get?: () => string }
  | { kind: "info"; label: string; get: () => string; valid?: () => boolean }
  | { kind: "copyable"; label: string; get: () => string; onForget?: () => void; visualPrefix?: string }
  | {
      kind: "toggle";
      label: string;
      hotkey?: string;
      get: () => boolean;
      set: (v: boolean) => void;
      disabled?: () => boolean;
      needsReload?: boolean;
    }
  | {
      kind: "cycle";
      label: string;
      hotkey?: string;
      options: string[];
      get: () => string;
      set: (v: string) => void;
      needsReload?: boolean;
    }
  | { kind: "dialog"; label: string; hotkey?: string; dialogId: "theme"; get: () => string }
  | { kind: "action"; label: string; hotkey?: string; get?: () => string; run: () => void; disabled?: () => boolean }
  | { kind: "section"; label: string; count: number; collapsed: () => boolean; toggle: () => void }
  | { kind: "badge"; name: string; colorIndex: number; dimmed?: boolean }
  | { kind: "branch"; name: string; run: () => void; upstream?: string; ahead?: number; behind?: number }
  | {
      kind: "editable";
      label: string;
      placeholder?: string;
      get: () => string;
      set: (v: string) => void;
      valid?: () => boolean;
      showValidity?: boolean;
      isDraftValid?: (v: string) => boolean;
      keepEditingOnSave?: boolean;
      staySelectedOnSave?: boolean;
      fullWidth?: boolean;
    };

/** Width of the info label column (characters). */
export const INFO_LABEL_WIDTH = 12;

/** Usable width for copyable text: dialog=70 - 2(paddingX=1) - 8(paddingX=4) = 60 */
export const COPYABLE_VISIBLE_WIDTH = 60;

export interface GitHubMenuConfig {
  enabled: boolean;
  tokenEnvVar: string;
  trustedEnterpriseHost: string | null;
  fetchDepth: ProviderLimit;
  cacheLimit: ProviderCacheLimit;
  autoRefreshSeconds: ProviderAutoRefreshSeconds;
}

export interface JenkinsMenuConfig {
  enabled: boolean;
  username?: string;
  tokenEnvVar: string;
  fetchDepth: ProviderLimit;
  cacheLimit: ProviderCacheLimit;
  autoRefreshSeconds: ProviderAutoRefreshSeconds;
  jobs: JenkinsJobConfig[];
}

export interface OpenShiftMenuConfig {
  enabled: boolean;
  serverUrl: string;
  tokenEnvVar: string;
  namespaces: string[];
  commitShaAnnotation: string;
  cacheLimit: ProviderCacheLimit;
  fetchDepth: ProviderLimit;
  autoRefreshSeconds: ProviderAutoRefreshSeconds;
}

export interface SnykMenuConfig {
  enabled: boolean;
  tokenEnvVar: string;
  autoScanBranches: string[];
  maxCachedScans: SnykCacheLimit;
}
