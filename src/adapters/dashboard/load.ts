/**
 * The terminal app's Dashboard reads: core/dashboard/load.ts with each provider's stored events (through its adapters,
 * on the provider caches) and the Git command line (or the app's Git port). Tests spy on these two functions.
 */
import type { DashboardEvent } from "../../core/dashboard/events";
import { type CommitInfo, type ReadOptions, readAppEvents } from "../../core/dashboard/load";
import type { GitPort } from "../../core/git/port";
import type { ProviderSet } from "../../core/provider-set";
import { gitCli } from "../git/git-cli";

export type { CommitInfo } from "../../core/dashboard/load";

/**
 * One app's events since the window starts: the commits on its main branch, and the finished runs, builds and scans
 * its provider caches hold. Nothing is fetched: the caches are as fresh as the last time the app was open.
 */
export function loadAppEvents(
  app: string,
  options: ReadOptions,
  providers: ProviderSet,
  git: GitPort = gitCli(),
): Promise<DashboardEvent[]> {
  return readAppEvents(app, options, { git, sources: providers.storedEvents() });
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
