import type { OpenShiftSettings } from "../../../core/openshift/definition";
import {
  isValidOpenShiftNamespace,
  isValidOpenShiftServerUrl,
  isValidOpenShiftText,
} from "../../../core/openshift/validation";
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

export function buildOpenShiftProviderItems(
  cfg: OpenShiftSettings,
  onChange?: (cfg: OpenShiftSettings) => void,
  persist?: (cfg: OpenShiftSettings) => void,
  lastRefresh: () => string = () => "never",
  /** Whether a token variable is set. */
  tokenIsSet: (envVar: string) => boolean = () => false,
): SettingItem[] {
  const update = (next: OpenShiftSettings) => {
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
      placeholder: "Enter server URL...",
      get: () => cfg.serverUrl,
      set: v => update({ ...cfg, serverUrl: v.trim() }),
      valid: () => isValidOpenShiftServerUrl(cfg.serverUrl),
      isDraftValid: isValidOpenShiftServerUrl,
    },
    {
      kind: "editable",
      label: "Console",
      placeholder: "Enter console URL...",
      get: () => cfg.consoleUrl,
      set: v => update({ ...cfg, consoleUrl: v.trim() }),
      valid: () => !cfg.consoleUrl || isValidOpenShiftServerUrl(cfg.consoleUrl),
      isDraftValid: value => !value.trim() || isValidOpenShiftServerUrl(value),
    },
    tokenVariableItem({
      current: cfg.tokenEnvVar,
      fallback: "OPENSHIFT_TOKEN",
      isSet: () => tokenIsSet(cfg.tokenEnvVar),
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
