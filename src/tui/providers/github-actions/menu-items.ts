import type { GitHubSettings } from "../../../core/github/definition";
import { parseGitHubRemote } from "../../../core/github/host";
import {
  cycleAutoRefreshSeconds,
  cycleProviderCacheLimit,
  cycleProviderLimit,
  PROVIDER_AUTO_REFRESH_OPTIONS,
  PROVIDER_CACHE_LIMIT_OPTIONS,
  PROVIDER_LIMIT_OPTIONS,
  PROVIDER_MS_TO_LABEL,
} from "../../../core/provider-settings";
import type { SettingItem } from "../../hooks/menu-items-types";
import { tokenVariableItem } from "../shared/menu-rows";

export function buildGitHubProviderItems(
  ghCfg: GitHubSettings,
  remoteUrl: string,
  tokenSource: "env" | null,
  onChange?: (cfg: GitHubSettings) => void,
  persist?: (cfg: GitHubSettings) => void,
  lastRefresh: () => string = () => "never",
): SettingItem[] {
  const remoteRepo = parseGitHubRemote(remoteUrl);
  const remoteHost = remoteRepo?.hostname ?? null;
  const hostAllowed = remoteHost === "github.com" || (remoteHost != null && ghCfg.trustedEnterpriseHost === remoteHost);

  const items: SettingItem[] = [
    { kind: "header", label: "GitHub" },
    {
      kind: "toggle",
      label: "Enabled",
      get: () => ghCfg.enabled,
      set: v => {
        const newCfg = { ...ghCfg, enabled: v };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
    },
    { kind: "info", label: "Last refresh", get: lastRefresh },
  ];

  if (!ghCfg.enabled) return items;

  items.push(
    tokenVariableItem({
      current: ghCfg.tokenEnvVar,
      fallback: "GITHUB_TOKEN",
      save: tokenEnvVar => {
        const newCfg = { ...ghCfg, tokenEnvVar };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
      isSet: () => tokenSource === "env",
    }),
    {
      kind: "info",
      label: "Host",
      get: () => remoteHost ?? "not detected",
      valid: () => hostAllowed,
    },
    {
      kind: "toggle",
      label: "Allow host",
      get: () => hostAllowed,
      set: v => {
        const newCfg = { ...ghCfg, trustedEnterpriseHost: v ? (remoteHost ?? undefined) : undefined };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
      disabled: () => remoteHost == null || remoteHost === "github.com",
    },
    {
      kind: "cycle",
      label: "Cache count",
      options: PROVIDER_CACHE_LIMIT_OPTIONS.map(String),
      get: () => String(ghCfg.cacheLimit),
      set: v => {
        const newCfg = { ...ghCfg, cacheLimit: cycleProviderCacheLimit(v) };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
    },
    {
      kind: "cycle",
      label: "Fetch size",
      options: PROVIDER_LIMIT_OPTIONS.map(String),
      get: () => String(ghCfg.fetchDepth),
      set: v => {
        const newCfg = { ...ghCfg, fetchDepth: cycleProviderLimit(v) };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
    },
    {
      kind: "cycle",
      label: "Auto refresh",
      options: [...PROVIDER_AUTO_REFRESH_OPTIONS],
      get: () => PROVIDER_MS_TO_LABEL[ghCfg.autoRefreshSeconds * 1000] ?? "2m",
      set: v => {
        const newCfg = { ...ghCfg, autoRefreshSeconds: cycleAutoRefreshSeconds(v) };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
    },
  );

  return items;
}
