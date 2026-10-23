import type { Theme } from "../../context/theme";
import {
  isMatureExploit,
  type SnykFixGroup,
  type SnykFixKind,
  type SnykFixPackage,
  type SnykVulnerabilityEntry,
  snykUpgrade,
} from "./parser";
import type { SnykLegendItem } from "./tab-shared";
import type { SnykScanResult, SnykSeverity } from "./types";

export type Section = {
  key: string;
  /** Header text: `HIGH` or the short `artifact@version`. */
  label: string;
  severity?: SnykSeverity;
  /** Dependency view only: package rows, listed from the unfiltered scan. */
  packages?: PackageRow[];
  entries: SnykVulnerabilityEntry[];
  /** Unfiltered entry count, shown as `/M` while filtering. */
  original: number;
};
export type PackageRow = {
  key: string;
  name: string;
  /** The group's own dependency; shown as muted `self`. */
  self: boolean;
  entries: SnykVulnerabilityEntry[];
  original: number;
};
export type DetailField = "title" | "package" | "via" | "manifest" | "paths" | "exploit" | "fix";
export type DetailLine = {
  text: string;
  /** Shown instead of `text` while the cursor is on the row (e.g. full Maven coordinates). */
  full?: string;
  /** Right-aligned muted text (e.g. `11.0.24 → 11.0.25`). */
  suffix?: string;
  tone: "plain" | "muted" | "exploit" | SnykFixKind;
  wrap?: boolean;
  field?: DetailField;
  copy?: string;
};
export type FlatItem =
  | { kind: "scan" }
  | { kind: "copyJson" }
  | { kind: "groupBy" }
  | { kind: "filter" }
  | { kind: "section"; section: Section }
  | { kind: "package"; pkg: PackageRow }
  | { kind: "finding"; entry: SnykVulnerabilityEntry }
  | { kind: "field"; owner: string; line: DetailLine };

/** Pinned below the tab when the scan has findings. */
export const VULNERABILITY_LEGEND: SnykLegendItem[] = [
  [[["●", theme => toneColor(theme, "upgrade")]], "upgrade"],
  [[["●", theme => toneColor(theme, "override")]], "override"],
  [[["●", theme => toneColor(theme, "no fix")]], "no fix"],
  [[["!", theme => toneColor(theme, "exploit")]], "mature exploit"],
];
/** Row tail: " " + 4-char score + " " + exploit marker + " " + fix dot (colored like CI status). */
export const ROW_TAIL_WIDTH = 9;

export function toneColor(theme: Theme, tone: DetailLine["tone"]): string {
  if (tone === "upgrade") return theme.success;
  if (tone === "override") return theme.warning;
  if (tone === "plain") return theme.foreground;
  return tone === "exploit" ? theme.error : theme.foregroundMuted;
}

/** `group:artifact@version` → `artifact@version`; npm names have no group and stay as they are. */
export function shortCoordinate(value: string): string {
  return value.slice(value.lastIndexOf(":") + 1);
}

/** Package rows of a group: the dependency itself (`self`) first, then overrides. */
export function packagesOf(group: SnykFixGroup): SnykFixPackage[] {
  return [...(group.self ? [group.self] : []), ...group.packages];
}

function fixText(entry: SnykVulnerabilityEntry): string {
  const finding = entry.finding;
  const upgrade = snykUpgrade(finding);
  if (upgrade) return `Upgrade ${compactDependencyName(upgrade.name)} ${upgrade.from ?? "?"} → ${upgrade.version}`;
  if (entry.fix === "upgrade")
    return `Upgrade ${compactDependencyName(finding.dependency)} ${finding.installedVersion} → ${finding.fixedVersion}`;
  return finding.fixedVersion ? `Fixed in ${finding.fixedVersion}` : "No fixed version available";
}

export function detailLines(entry: SnykVulnerabilityEntry): DetailLine[] {
  const finding = entry.finding;
  const via = finding.dependencyType === "transitive" ? finding.dependencyPath?.[0] : undefined;
  const pkg = `${finding.dependency}@${finding.installedVersion}`;
  const exploit =
    finding.exploit && !/^(not defined|no known exploit)$/i.test(finding.exploit) ? finding.exploit : null;
  const lines: (DetailLine | null)[] = [
    { text: finding.title, tone: "muted", wrap: true, field: "title", copy: finding.title },
    { text: shortCoordinate(pkg), full: pkg, tone: "muted", field: "package", copy: pkg },
    via
      ? { text: `via ${shortCoordinate(via)}`, full: `via ${via}`, tone: "muted", field: "via", copy: via }
      : finding.dependencyType === "direct"
        ? { text: "direct dependency", tone: "muted", field: "via", copy: pkg }
        : null,
    finding.targetFile
      ? { text: finding.targetFile, tone: "muted", field: "manifest", copy: finding.targetFile }
      : null,
    entry.paths > 1
      ? { text: `${entry.paths} paths`, tone: "muted", field: "paths", copy: `${entry.paths} paths` }
      : null,
    exploit
      ? {
          text: `Exploit: ${exploit}`,
          tone: isMatureExploit(finding) ? "exploit" : "muted",
          field: "exploit",
          copy: exploit,
        }
      : null,
    { text: fixText(entry), tone: entry.fix, field: "fix", copy: fixText(entry) },
  ];
  return lines.filter((line): line is DetailLine => line !== null);
}

export function itemKey(item: FlatItem): string {
  if (item.kind === "scan" || item.kind === "copyJson" || item.kind === "groupBy" || item.kind === "filter")
    return item.kind;
  if (item.kind === "section") return `section:${item.section.key}`;
  if (item.kind === "package") return item.pkg.key;
  if (item.kind === "finding") return `finding:${item.entry.key}`;
  return `field:${item.owner}:${item.line.field}:${item.line.copy ?? item.line.text}`;
}

export function wrapWords(value: string, width: number): string[] {
  if (value.length <= width) return [value];
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/)) {
    if (!line) {
      line = word;
      continue;
    }
    if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.flatMap(entry => {
    if (entry.length <= width) return [entry];
    const chunks: string[] = [];
    for (let offset = 0; offset < entry.length; offset += width) chunks.push(entry.slice(offset, offset + width));
    return chunks;
  });
}

function compactDependencyName(value: string): string {
  const separator = value.lastIndexOf(":");
  return separator >= 0 ? value.slice(separator + 1) : value;
}

/** `partial scan · 2 projects failed: a/package.json, …`; the ellipsis marks failures Snyk did not name. */
export function partialScanText(scan: Pick<SnykScanResult, "failedProjects" | "failedTargets">): string {
  const count = scan.failedProjects ?? 0;
  const targets = scan.failedTargets ?? [];
  const names = targets.length < count && targets.length > 0 ? [...targets, "…"] : targets;
  return `partial scan · ${count} project${count === 1 ? "" : "s"} failed${names.length > 0 ? `: ${names.join(", ")}` : ""}`;
}
