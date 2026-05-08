import { basename } from "node:path";
import type { KnownRepoInfo } from "../config";

export function repoDisplayName(repo: KnownRepoInfo): string {
  return repo.appName?.trim() || basename(repo.path);
}

export function groupMembersForRepo(
  repos: KnownRepoInfo[],
  currentPath: string,
  currentRepoInfo?: Pick<KnownRepoInfo, "group" | "appName">,
): KnownRepoInfo[] {
  const current = repos.find(repo => repo.path === currentPath) ?? { path: currentPath, ...currentRepoInfo };
  const group = current?.group?.trim();
  if (!group) return [];
  const withCurrent = repos.some(repo => repo.path === currentPath) ? repos : [...repos, current];
  return withCurrent
    .filter(repo => repo.group?.trim() === group)
    .sort((a, b) => repoDisplayName(a).localeCompare(repoDisplayName(b)));
}

export function nextGroupRepoPath(
  repos: KnownRepoInfo[],
  currentPath: string,
  direction: 1 | -1,
  currentRepoInfo?: Pick<KnownRepoInfo, "group" | "appName">,
): string | null {
  const members = groupMembersForRepo(repos, currentPath, currentRepoInfo);
  if (members.length < 2) return null;
  const idx = members.findIndex(repo => repo.path === currentPath);
  if (idx < 0) return null;
  const nextIdx = idx + direction;
  if (nextIdx < 0 || nextIdx >= members.length) return null;
  return members[nextIdx].path;
}
