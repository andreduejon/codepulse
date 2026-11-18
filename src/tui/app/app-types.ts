import type { CacheStorePort } from "../../core/cache-store";
import type { DashboardReader } from "../../core/dashboard/load";
import type { GitPort } from "../../core/git/port";
import type { Branch, Commit, GraphRow, TagInfo } from "../../core/git/types";
import type { ProviderView } from "../../core/provider-model";
import type { ProviderSet } from "../../core/provider-set";
import type { CodepulseConfig, ConfigInfo, KnownRepoInfo } from "../../core/settings/config";
import type { SettingsPort } from "../../core/settings/port";
import type { SystemPort } from "../../core/system";
import type { CustomTheme, createThemeState } from "../context/theme";
import type { AnyProviderModule } from "../providers/module";

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
  /** The providers: their definitions and the adapters each runs on. */
  providers?: ProviderSet;
  /** Each provider's terminal module, one per provider in the set. */
  providerModules?: readonly AnyProviderModule[];
  /** The browser and the environment. */
  system?: SystemPort;
  /** The Dashboard's reads. */
  dashboard?: DashboardReader;
  startupMode: StartupMode;
  /** Each provider's settings as startup read them, by its key. */
  initialProviderSettings?: CodepulseConfig["providers"];
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
