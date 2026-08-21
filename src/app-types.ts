import type { ConfigInfo } from "./config";
import type { createThemeState } from "./context/theme";
import type { Branch, Commit, GraphRow, TagInfo } from "./git/types";
import type { StartupMode } from "./main";
import type { GraphBadge, ProviderView } from "./providers/provider";

export interface AppProps {
  repoPath: string;
  branch?: string;
  all?: boolean;
  maxCount?: number;
  themeName?: string;
  autoRefreshInterval?: number;
  autoFetchInterval?: number;
  configInfo?: ConfigInfo;
  startupMode: StartupMode;
  initialGithubConfig?: {
    enabled?: boolean;
    tokenEnvVar?: string;
    trustedEnterpriseHost?: string;
  };
  initialJenkinsConfig?: {
    enabled?: boolean;
    username?: string;
    tokenEnvVar?: string;
    graphBuildLimit?: 10 | 20 | 50;
    jobs?: { label?: string; url: string }[];
  };
  initialOpenShiftConfig?: {
    enabled?: boolean;
    serverUrl?: string;
    tokenEnvVar?: string;
    namespaces?: string[];
    commitShaAnnotation?: string;
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
  graphBadges: Map<ProviderView, Map<string, GraphBadge>>;
  graphScrollTop: number;
}
