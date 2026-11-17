import type { ProviderAdapters } from "../../core/app-ports";
import type { CacheStorePort } from "../../core/cache-store";
import type { DashboardReader } from "../../core/dashboard/load";
import type { GitPort } from "../../core/git/port";
import type { Branch, Commit, GraphRow, TagInfo } from "../../core/git/types";
import type { ProviderView } from "../../core/provider-model";
import type { ProviderCacheLimit } from "../../core/provider-settings";
import type { ConfigInfo, KnownRepoInfo } from "../../core/settings/config";
import type { SettingsPort } from "../../core/settings/port";
import type { SystemPort } from "../../core/system";
import type { CustomTheme, createThemeState } from "../context/theme";

export interface AppProps {
  repoPath: string;
  branch?: string;
  all?: boolean;
  maxCount?: number;
  themeName?: string;
  customThemes?: readonly CustomTheme[];
  autoRefreshInterval?: number;
  autoFetchInterval?: number;
  configInfo?: ConfigInfo;
  /** Where the settings are kept: the user's settings file unless the caller gives another. */
  settings?: SettingsPort;
  /** Git: the Git command line unless the caller gives another. */
  git?: GitPort;
  /** The providers' cache: the SQLite cache unless the caller gives another. */
  cacheStore?: CacheStorePort;
  /** Each provider's API, cache and token. */
  providers?: ProviderAdapters;
  /** The browser and the environment. */
  system?: SystemPort;
  /** The Dashboard's reads. */
  dashboard?: DashboardReader;
  startupMode: StartupMode;
  initialGithubConfig?: {
    enabled?: boolean;
    tokenEnvVar?: string;
    trustedEnterpriseHost?: string;
    fetchDepth?: 10 | 20 | 50;
    cacheLimit?: ProviderCacheLimit;
    autoRefreshSeconds?: 0 | 120 | 300 | 600;
  };
  initialJenkinsConfig?: {
    enabled?: boolean;
    username?: string;
    tokenEnvVar?: string;
    graphBuildLimit?: 10 | 20 | 50;
    fetchDepth?: 10 | 20 | 50;
    cacheLimit?: ProviderCacheLimit;
    autoRefreshSeconds?: 0 | 120 | 300 | 600;
    jobs?: { label?: string; url: string }[];
  };
  initialOpenShiftConfig?: {
    enabled?: boolean;
    serverUrl?: string;
    consoleUrl?: string;
    tokenEnvVar?: string;
    namespaces?: string[];
    commitShaAnnotation?: string;
    cacheLimit?: ProviderCacheLimit;
    fetchDepth?: 10 | 20 | 50;
    autoRefreshSeconds?: 0 | 120 | 300 | 600;
  };
  initialSnykConfig?: {
    enabled?: boolean;
    tokenEnvVar?: string;
    autoScanBranches?: string[];
    maxCachedScans?: ProviderCacheLimit;
  };
}

export interface AppContentProps extends AppProps {
  themeState: ReturnType<typeof createThemeState>;
}

export interface RepoSessionSnapshot {
  commits: Commit[];
  graphRows: GraphRow[];
  branches: Branch[];
  currentBranch: string;
  repoPath: string;
  remoteUrl: string;
  tagDetails: Map<string, TagInfo>;
  stashByParent: Map<string, Commit[]>;
  cursorIndex: number;
  scrollTargetIndex: number;
  maxGraphColumns: number;
  hasMore: boolean;
  lastFetchTime: Date | null;
  activeProviderView: ProviderView;
  graphScrollTop: number;
}

/** Which screen the app opens on: the graph, the setup, the project selector (and why), or an error. */
export type StartupMode =
  | { kind: "graph" }
  | { kind: "setup" }
  | { kind: "selector"; message?: string; messagePath?: string; knownRepos: KnownRepoInfo[] }
  | { kind: "error"; message: string };
