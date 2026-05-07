import { homedir } from "node:os";
import type { KnownRepoInfo } from "../config";

export type ProjectSelectorRow =
  | { kind: "group"; label: string }
  | { kind: "spacer"; label: "" }
  | { kind: "repo"; label: string; repoIndex: number };

export function buildProjectSelectorRows(repos: KnownRepoInfo[]): ProjectSelectorRow[] {
  const buckets = new Map<string, { repo: KnownRepoInfo; repoIndex: number }[]>();
  repos.forEach((repo, repoIndex) => {
    const group = repo.group?.trim() || "ungrouped";
    const bucket = buckets.get(group) ?? [];
    bucket.push({ repo, repoIndex });
    buckets.set(group, bucket);
  });

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([group, entries], groupIndex): ProjectSelectorRow[] => {
      const rows: ProjectSelectorRow[] = groupIndex === 0 ? [] : [{ kind: "spacer", label: "" }];
      rows.push({ kind: "group", label: group });
      rows.push(
        ...entries
          .sort((a, b) => displayName(a.repo).localeCompare(displayName(b.repo)))
          .map(({ repo, repoIndex }) => ({ kind: "repo" as const, label: displayName(repo), repoIndex })),
      );
      return rows;
    });
}

export function isRepoRow(row: ProjectSelectorRow): row is Extract<ProjectSelectorRow, { kind: "repo" }> {
  return row.kind === "repo";
}

function displayName(repo: KnownRepoInfo): string {
  return repo.appName?.trim() || repo.path.replace(homedir(), "~");
}
