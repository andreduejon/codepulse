import type { JenkinsSettings } from "../../../core/jenkins/definition";
import { isValidJenkinsJobUrl } from "../../../core/jenkins/validation";
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

export function buildJenkinsProviderItems(
  jenkinsCfg: JenkinsSettings,
  onChange?: (cfg: JenkinsSettings) => void,
  persist?: (cfg: JenkinsSettings) => void,
  lastRefresh: () => string = () => "never",
  /** Whether a token variable is set. */
  tokenIsSet: (envVar: string) => boolean = () => false,
): SettingItem[] {
  const sameJob = (url: string) => url.trim().replace(/\/+$/, "");
  const isNewJob = (value: string) =>
    isValidJenkinsJobUrl(value.trim()) && !jenkinsCfg.jobs.some(job => sameJob(job.url) === sameJob(value));
  const items: SettingItem[] = [
    { kind: "header", label: "Jenkins" },
    {
      kind: "toggle",
      label: "Enabled",
      get: () => jenkinsCfg.enabled,
      set: v => {
        const newCfg = { ...jenkinsCfg, enabled: v };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
    },
    { kind: "info", label: "Last refresh", get: lastRefresh },
  ];

  if (!jenkinsCfg.enabled) return items;

  items.push(
    {
      kind: "editable",
      label: "Username",
      placeholder: "Enter username...",
      get: () => jenkinsCfg.username ?? "",
      set: v => {
        const username = v.trim() || undefined;
        const newCfg = { ...jenkinsCfg, username };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
      valid: () => !!jenkinsCfg.username?.trim(),
    },
    tokenVariableItem({
      current: jenkinsCfg.tokenEnvVar,
      fallback: "JENKINS_TOKEN",
      isSet: () => tokenIsSet(jenkinsCfg.tokenEnvVar),
      save: tokenEnvVar => {
        const newCfg = { ...jenkinsCfg, tokenEnvVar };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
    }),
    {
      kind: "cycle",
      label: "Cache count",
      options: PROVIDER_CACHE_LIMIT_OPTIONS.map(String),
      get: () => String(jenkinsCfg.cacheLimit),
      set: v => {
        const newCfg = { ...jenkinsCfg, cacheLimit: cycleProviderCacheLimit(v) };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
    },
    {
      kind: "cycle",
      label: "Fetch size",
      options: PROVIDER_LIMIT_OPTIONS.map(String),
      get: () => String(jenkinsCfg.fetchDepth),
      set: v => {
        const newCfg = { ...jenkinsCfg, fetchDepth: cycleProviderLimit(v) };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
    },
    {
      kind: "cycle",
      label: "Auto refresh",
      options: [...PROVIDER_AUTO_REFRESH_OPTIONS],
      get: () => PROVIDER_MS_TO_LABEL[jenkinsCfg.autoRefreshSeconds * 1000] ?? "2m",
      set: v => {
        const newCfg = { ...jenkinsCfg, autoRefreshSeconds: cycleAutoRefreshSeconds(v) };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
    },
    {
      kind: "editable",
      label: "New job",
      placeholder: "Enter job URL...",
      get: () => "",
      set: v => {
        const url = v.trim();
        if (!isNewJob(url)) return;
        const newCfg = { ...jenkinsCfg, jobs: [...jenkinsCfg.jobs, { url }] };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
      valid: () => jenkinsCfg.jobs.length > 0,
      showValidity: false,
      // A job already in the list (same URL, ignoring a trailing slash) is an invalid draft, like a duplicate branch.
      isDraftValid: isNewJob,
      staySelectedOnSave: true,
    },
  );

  items.push(
    ...jenkinsCfg.jobs.map((job, idx) => ({
      kind: "copyable" as const,
      label: `Job #${idx + 1}`,
      get: () => job.url,
      visualPrefix: "· ",
      onForget: () => {
        const newCfg = { ...jenkinsCfg, jobs: jenkinsCfg.jobs.filter((_, jobIdx) => jobIdx !== idx) };
        onChange?.(newCfg);
        persist?.(newCfg);
      },
    })),
  );

  return items;
}
