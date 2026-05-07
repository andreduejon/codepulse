import { basename } from "node:path";
import type { KnownRepoInfo } from "../config";

export function repoDisplayName(repo: KnownRepoInfo): string {
  return repo.appName?.trim() || basename(repo.path);
}

export function groupMembersForRepo(repos: KnownRepoInfo[], currentPath: string): KnownRepoInfo[] {
  const current = repos.find(repo => repo.path === currentPath);
  const group = current?.group?.trim();
  if (!group) return [];
  return repos
    .filter(repo => repo.group?.trim() === group)
    .sort((a, b) => repoDisplayName(a).localeCompare(repoDisplayName(b)));
}

export function nextGroupRepoPath(repos: KnownRepoInfo[], currentPath: string, direction: 1 | -1): string | null {
  const members = groupMembersForRepo(repos, currentPath);
  if (members.length < 2) return null;
  const idx = members.findIndex(repo => repo.path === currentPath);
  if (idx < 0) return null;
  return members[(idx + direction + members.length) % members.length].path;
}
