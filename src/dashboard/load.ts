/**
 * The terminal app's Dashboard reads: core/dashboard/load.ts with the provider caches as its sources and the Git
 * command line (or the app's Git port). Tests spy on these two functions.
 */
import type { DashboardEvent } from "../core/dashboard/events";
import { type CommitInfo, type DashboardSources, type ReadOptions, readAppEvents } from "../core/dashboard/load";
import type { GitPort } from "../core/git/port";
import { gitCli } from "../git/git-cli";
import { GitHubCache } from "../providers/github-actions/cache";
import { JenkinsCache } from "../providers/jenkins/cache";
import { OpenShiftCache } from "../providers/openshift/cache";
import { SnykCache } from "../providers/snyk/cache";

export type { CommitInfo } from "../core/dashboard/load";

export interface LoadOptions extends ReadOptions {
  /** The provider caches' folder (tests); the app's own otherwise. */
  cacheRoot?: string;
}

/** The provider caches as the Dashboard's sources. */
export function cacheSources(cacheRoot?: string): DashboardSources {
  const root = cacheRoot === undefined ? {} : { root: cacheRoot };
  return {
    github: app => new GitHubCache(root).peekAll(app),
    jenkins: app => new JenkinsCache(root).peekAll(app),
    openshift: app => new OpenShiftCache(root).peekAll(app),
    snyk: app => new SnykCache(root).peekAll(app),
  };
}

/**
 * One app's events since the window starts: the commits on its main branch, and the finished runs, builds and scans
 * its provider caches hold. Nothing is fetched: the caches are as fresh as the last time the app was open.
 */
export function loadAppEvents(app: string, options: LoadOptions, git: GitPort = gitCli()): Promise<DashboardEvent[]> {
  return readAppEvents(app, options, { git, sources: cacheSources(options.cacheRoot) });
}

/** An event's commit as the app's repository knows it; null when it does not (a commit only CI saw). */
export function loadCommitInfo(
  app: string,
  sha: string,
  signal?: AbortSignal,
  git: GitPort = gitCli(),
): Promise<CommitInfo | null> {
  return git.getCommitInfo(app, sha, signal);
}
