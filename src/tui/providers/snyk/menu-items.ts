/** Snyk's section of Menu → Providers. */
import type { Accessor } from "solid-js";
import { cycleProviderCacheLimit, PROVIDER_CACHE_LIMIT_OPTIONS } from "../../../core/provider-settings";
import type { SnykSettings } from "../../../core/snyk/service";
import type { SettingItem } from "../../hooks/menu-items-types";
import { tokenVariableItem } from "../shared/menu-rows";

export function buildSnykProviderItems(
  cfg: SnykSettings,
  branches: Accessor<{ name: string; isRemote: boolean }[]>,
  onChange?: (cfg: SnykSettings) => void,
  persist?: (cfg: SnykSettings) => void,
  lastScan: () => string = () => "never",
  /** Whether a token variable is set. */
  tokenIsSet: (envVar: string) => boolean = () => false,
): SettingItem[] {
  const update = (next: SnykSettings) => {
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
      isSet: () => tokenIsSet(cfg.tokenEnvVar),
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
