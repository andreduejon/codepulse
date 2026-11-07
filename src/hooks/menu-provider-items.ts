import type { Accessor } from "solid-js";
import { parseGitHubRemote } from "../providers/github-actions/api";
import { isValidJenkinsJobUrl } from "../providers/jenkins/validation";
import {
  isValidOpenShiftNamespace,
  isValidOpenShiftServerUrl,
  isValidOpenShiftText,
} from "../providers/openshift/validation";
import {
  cycleAutoRefreshSeconds,
  cycleProviderCacheLimit,
  cycleProviderLimit,
  PROVIDER_AUTO_REFRESH_OPTIONS,
  PROVIDER_CACHE_LIMIT_OPTIONS,
  PROVIDER_LIMIT_OPTIONS,
  PROVIDER_MS_TO_LABEL,
} from "../providers/shared/auto-refresh";
import type {
  GitHubMenuConfig,
  JenkinsMenuConfig,
  OpenShiftMenuConfig,
  SettingItem,
  SnykMenuConfig,
} from "./menu-items-types";

const isValidEnvVarName = (value: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);

/**
 * The `Token` row every provider shares. It holds the name of an environment variable (never the secret): the
 * draft must be a valid name, an empty value falls back to the provider's default (`GITHUB_TOKEN`, …), and the row
 * is valid once that variable is set.
 */
function tokenVariableItem(opts: {
  current: string;
  fallback: string;
  save: (name: string) => void;
  isSet?: () => boolean;
}): SettingItem {
  return {
    kind: "editable",
    label: "Token",
    placeholder: "Enter variable name...",
    get: () => opts.current,
    set: value => opts.save(value.trim() || opts.fallback),
    valid: () => isValidEnvVarName(opts.current) && (opts.isSet?.() ?? !!process.env[opts.current]?.trim()),
    isDraftValid: value => isValidEnvVarName(value.trim() || opts.fallback),
  };
}

export function buildSnykProviderItems(
  cfg: SnykMenuConfig,
  branches: Accessor<{ name: string; isRemote: boolean }[]>,
  onChange?: (cfg: SnykMenuConfig) => void,
  persist?: (cfg: SnykMenuConfig) => void,
  lastScan: () => string = () => "never",
): SettingItem[] {
  const update = (next: SnykMenuConfig) => {
    onChange?.(next);
    persist?.(next);
  };
  const isValidBranch = (value: string) => {
    const branch = value.trim();
    return (
      !!branch &&
      !cfg.autoScanBranches.includes(branch) &&
      branches().some(candidate => !candidate.isRemote && candidate.name === branch)
    );
  };
  const items: SettingItem[] = [
    { kind: "header", label: "Snyk" },
    { kind: "toggle", label: "Enabled", get: () => cfg.enabled, set: enabled => update({ ...cfg, enabled }) },
    { kind: "info", label: "Last scan", get: lastScan },
  ];

  if (!cfg.enabled) return items;

  items.push(
    tokenVariableItem({
      current: cfg.tokenEnvVar,
      fallback: "SNYK_TOKEN",
      save: tokenEnvVar => update({ ...cfg, tokenEnvVar }),
    }),
    {
      kind: "cycle",
      label: "Cache count",
      options: PROVIDER_CACHE_LIMIT_OPTIONS.map(String),
      get: () => String(cfg.maxCachedScans),
      set: value => update({ ...cfg, maxCachedScans: cycleProviderCacheLimit(value) }),
    },
    {
      kind: "editable",
      label: "New branch",
      placeholder: "Enter new branch...",
      get: () => "",
      set: value => {
        const branch = value.trim();
        if (!isValidBranch(branch)) return;
        update({ ...cfg, autoScanBranches: [...cfg.autoScanBranches, branch] });
      },
      valid: () => cfg.autoScanBranches.length > 0,
      showValidity: false,
      isDraftValid: isValidBranch,
      staySelectedOnSave: true,
    },
    ...cfg.autoScanBranches.map((branch, idx) => ({
      kind: "copyable" as const,
      label: `Branch #${idx + 1}`,
      get: () => branch,
      visualPrefix: "· ",
      onForget: () =>
        update({ ...cfg, autoScanBranches: cfg.autoScanBranches.filter((_, branchIdx) => branchIdx !== idx) }),
    })),
  );

  return items;
}

export function buildOpenShiftProviderItems(
  cfg: OpenShiftMenuConfig,
  onChange?: (cfg: OpenShiftMenuConfig) => void,
  persist?: (cfg: OpenShiftMenuConfig) => void,
  lastRefresh: () => string = () => "never",
): SettingItem[] {
  const update = (next: OpenShiftMenuConfig) => {
    onChange?.(next);
    persist?.(next);
  };
  const isNewNamespace = (value: string) =>
    isValidOpenShiftNamespace(value.trim()) && !cfg.namespaces.includes(value.trim());
  const items: SettingItem[] = [
    { kind: "header", label: "OpenShift" },
    { kind: "toggle", label: "Enabled", get: () => cfg.enabled, set: v => update({ ...cfg, enabled: v }) },
    { kind: "info", label: "Last refresh", get: lastRefresh },
  ];
  if (!cfg.enabled) return items;
  items.push(
    {
      kind: "editable",
      label: "Server",
      get: () => cfg.serverUrl,
      set: v => update({ ...cfg, serverUrl: v.trim() }),
      valid: () => isValidOpenShiftServerUrl(cfg.serverUrl),
      isDraftValid: isValidOpenShiftServerUrl,
    },
    tokenVariableItem({
      current: cfg.tokenEnvVar,
      fallback: "OPENSHIFT_TOKEN",
      save: tokenEnvVar => update({ ...cfg, tokenEnvVar }),
    }),
    {
      kind: "cycle",
      label: "Cache count",
      options: PROVIDER_CACHE_LIMIT_OPTIONS.map(String),
      get: () => String(cfg.cacheLimit),
      set: v => update({ ...cfg, cacheLimit: cycleProviderCacheLimit(v) }),
    },
    {
      kind: "cycle",
      label: "Fetch size",
      options: PROVIDER_LIMIT_OPTIONS.map(String),
      get: () => String(cfg.fetchDepth),
      set: v => update({ ...cfg, fetchDepth: cycleProviderLimit(v) }),
    },
    {
      kind: "cycle",
      label: "Auto refresh",
      options: [...PROVIDER_AUTO_REFRESH_OPTIONS],
      get: () => PROVIDER_MS_TO_LABEL[cfg.autoRefreshSeconds * 1000] ?? "2m",
      set: v => update({ ...cfg, autoRefreshSeconds: cycleAutoRefreshSeconds(v) }),
    },
    {
      kind: "editable",
      label: "Annotation",
      get: () => cfg.commitShaAnnotation,
      set: v => update({ ...cfg, commitShaAnnotation: v.trim() || "dev/commit-sha" }),
      valid: () => isValidOpenShiftText(cfg.commitShaAnnotation),
      isDraftValid: v => isValidOpenShiftText(v.trim() || "dev/commit-sha"),
    },
    {
      kind: "editable",
      label: "New namespace",
      placeholder: "Enter namespace...",
      get: () => "",
      set: v => {
        const namespace = v.trim();
        if (!isNewNamespace(namespace)) return;
        update({ ...cfg, namespaces: [...cfg.namespaces, namespace] });
      },
      valid: () => cfg.namespaces.length > 0,
      showValidity: false,
      // Like Snyk branches: a duplicate is an invalid draft, not a silent no-op.
      isDraftValid: isNewNamespace,
      staySelectedOnSave: true,
    },
    ...cfg.namespaces.map((namespace, idx) => ({
      kind: "copyable" as const,
      label: `Namespace #${idx + 1}`,
      get: () => namespace,
      visualPrefix: "· ",
      onForget: () => update({ ...cfg, namespaces: cfg.namespaces.filter((_, nsIdx) => nsIdx !== idx) }),
    })),
  );
  return items;
}

export function buildGitHubProviderItems(
  ghCfg: GitHubMenuConfig,
  remoteUrl: string,
  tokenSource: "env" | null,
  onChange?: (cfg: GitHubMenuConfig) => void,
  persist?: (cfg: GitHubMenuConfig) => void,
  lastRefresh: () => string = () => "never",
): SettingItem[] {
  const remoteRepo = parseGitHubRemote(remoteUrl);
  const remoteHost = remoteRepo?.hostname ?? null;
  const hostAllowed = remoteHost === "github.com" || (remoteHost != null && ghCfg.trustedEnterpriseHost === remoteHost);

  const items: SettingItem[] = [
    { kind: "header", label: "GitHub Actions" },
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
        const newCfg = { ...ghCfg, trustedEnterpriseHost: v ? remoteHost : null };
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

export function buildJenkinsProviderItems(
  jenkinsCfg: JenkinsMenuConfig,
  onChange?: (cfg: JenkinsMenuConfig) => void,
  persist?: (cfg: JenkinsMenuConfig) => void,
  lastRefresh: () => string = () => "never",
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
      label: `Job #${idx + 1} URL`,
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
