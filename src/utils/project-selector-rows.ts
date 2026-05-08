import { homedir } from "node:os";
import { basename } from "node:path";
import type { KnownRepoInfo } from "../config";

export type ProjectSelectorRow =
  | { kind: "group"; label: string }
  | { kind: "spacer"; label: "" }
  | { kind: "repo"; label: string; detail?: string; repo: KnownRepoInfo; current: boolean }
  | { kind: "path-input"; label: "" };

export function buildProjectSelectorRows(repos: KnownRepoInfo[], currentRepo?: string): ProjectSelectorRow[] {
  const labelCounts = new Map<string, number>();
  const parentDetailsByPath = new Map<string, string>();
  for (const repo of repos) {
    const label = displayName(repo);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  for (const [label] of labelCounts) {
    const duplicates = repos.filter(repo => displayName(repo) === label);
    if (duplicates.length <= 1) continue;
    const paths = duplicates.map(repo => shortPath(repo.path));
    const common = commonPathPrefix(paths);
    duplicates.forEach((repo, idx) => {
      parentDetailsByPath.set(repo.path, uniquePathSuffix(paths[idx], common));
    });
  }

  const buckets = new Map<string, KnownRepoInfo[]>();
  repos.forEach(repo => {
    const group = repo.group?.trim() || "ungrouped";
    const bucket = buckets.get(group) ?? [];
    bucket.push(repo);
    buckets.set(group, bucket);
  });

  const groupRows = [...buckets.entries()]
    .sort(([a], [b]) => {
      if (a === "ungrouped") return 1;
      if (b === "ungrouped") return -1;
      return a.localeCompare(b);
    })
    .flatMap(([group, entries], groupIndex): ProjectSelectorRow[] => {
      const rows: ProjectSelectorRow[] = groupIndex === 0 ? [] : [{ kind: "spacer", label: "" }];
      rows.push({ kind: "group", label: group });
      rows.push(
        ...entries
          .sort((a, b) => displayName(a).localeCompare(displayName(b)))
          .map(repo => {
            const label = displayName(repo);
            return {
              kind: "repo" as const,
              label,
              ...(parentDetailsByPath.has(repo.path) ? { detail: parentDetailsByPath.get(repo.path) } : {}),
              repo,
              current: repo.path === currentRepo,
            };
          }),
      );
      return rows;
    });

  return [
    ...groupRows,
    ...(groupRows.length > 0 ? [{ kind: "spacer" as const, label: "" as const }] : []),
    { kind: "path-input", label: "" },
  ];
}

export function isRepoRow(row: ProjectSelectorRow): row is Extract<ProjectSelectorRow, { kind: "repo" }> {
  return row.kind === "repo";
}

export function isSelectableProjectSelectorRow(
  row: ProjectSelectorRow,
): row is Extract<ProjectSelectorRow, { kind: "repo" | "path-input" }> {
  return (row.kind === "repo" && !row.current) || row.kind === "path-input";
}

function displayName(repo: KnownRepoInfo): string {
  return repo.appName?.trim() || basename(repo.path);
}

function shortPath(path: string): string {
  return path.replace(homedir(), "~");
}

function commonPathPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  const split = paths.map(path => path.split("/"));
  const prefix: string[] = [];
  for (let i = 0; i < split[0].length; i++) {
    const segment = split[0][i];
    if (split.every(parts => parts[i] === segment)) prefix.push(segment);
    else break;
  }
  return prefix.join("/");
}

function uniquePathSuffix(path: string, common: string): string {
  if (!common || common === path) return path;
  const suffix = path.slice(common.length).replace(/^\/+/, "");
  return suffix || path;
}
