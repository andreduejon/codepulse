import { createEffect } from "solid-js";
import type { DependencyGroupBy, DependencyScopeFilter } from "./deps-model";

/** View state of one Snyk tab, valid only for the scan it was recorded on. */
interface SnykTabMemory {
  /** `sha:scannedAt`; another scan (other commit or rescan) starts from defaults. */
  identity: string;
  query: string;
  cursor: number;
}

export interface SnykDependenciesMemory extends SnykTabMemory {
  groupBy: DependencyGroupBy;
  scope: DependencyScopeFilter;
  expanded: ReadonlySet<string>;
}

export interface SnykVulnerabilitiesMemory extends SnykTabMemory {
  groupBy: "severity" | "dependency";
  expandedSections: ReadonlySet<string>;
  expandedFindings: ReadonlySet<string>;
  collapsedGroups: ReadonlySet<string>;
}

/**
 * Mutable ref owned by the detail view, which outlives tab switches: each tab restores
 * its last state when it remounts for the same scan (e.g. after a `v` jump and back).
 */
export interface SnykViewMemory {
  dependencies?: SnykDependenciesMemory;
  vulnerabilities?: SnykVulnerabilitiesMemory;
}

type TabKey = keyof SnykViewMemory;
type TabMemory<K extends TabKey> = NonNullable<SnykViewMemory[K]>;

/**
 * One tab's slot in {@link SnykViewMemory}: records the view while the tab is shown (the cursor only while it is
 * the active tab, so the reset on leaving is not kept) and returns the saved view for a scan identity.
 * Call it after the restore effect, so a restore runs before the first recording.
 */
export function useSnykTabMemory<K extends TabKey>(options: {
  memory: SnykViewMemory | undefined;
  key: K;
  identity: () => string;
  cursor: () => number;
  active: (() => boolean) | undefined;
  view: () => Omit<TabMemory<K>, "identity" | "cursor">;
}): (identity: string) => TabMemory<K> | undefined {
  const { memory, key } = options;
  createEffect(() => {
    if (!memory) return;
    const cursor = options.cursor();
    const identity = options.identity();
    const previous = memory[key];
    const kept = previous?.identity === identity ? previous.cursor : 0;
    memory[key] = {
      ...options.view(),
      identity,
      cursor: options.active?.() === false ? kept : cursor,
    } as SnykViewMemory[K];
  });
  return identity => {
    const saved = memory?.[key];
    return saved?.identity === identity ? (saved as TabMemory<K>) : undefined;
  };
}
