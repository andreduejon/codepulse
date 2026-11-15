import { githubSettings, jenkinsSettings, openShiftSettings } from "../app-provider-config";
import { type CodepulseConfig, loadConfig } from "../config";
import { getRemoteUrl, getTopCommitHashes } from "../git/repo";
import { runGit } from "../git/repo-git";
import { getGitHubToken } from "../providers/github-actions/api";
import { syncGitHubCache } from "../providers/github-actions/sync";
import { DEFAULT_GITHUB_CONFIG } from "../providers/github-actions/types";
import { getJenkinsToken } from "../providers/jenkins/api";
import { syncJenkinsCache } from "../providers/jenkins/sync";
import { DEFAULT_JENKINS_CONFIG } from "../providers/jenkins/types";
import { getOpenShiftToken } from "../providers/openshift/api";
import { syncOpenShiftCache } from "../providers/openshift/sync";
import { DEFAULT_OPENSHIFT_CONFIG } from "../providers/openshift/types";
import { type CacheSyncResult, SYNC_OK } from "../providers/shared/cache-sync";
import { mainBranch } from "./load";

/** The providers the dashboard asks. Snyk scans rather than asks a server, so it is left out. */
export type SyncSource = "github-actions" | "jenkins" | "openshift";

/** One provider of one app the dashboard keeps fresh. */
export interface SyncTarget {
  app: string;
  source: SyncSource;
  /** The provider's auto refresh: 0 asks only when the dashboard is shown or refreshed. */
  intervalMs: number;
}

const providersOf = (config: CodepulseConfig) => ({
  github: { ...DEFAULT_GITHUB_CONFIG, ...githubSettings(config.providers?.github) },
  jenkins: { ...DEFAULT_JENKINS_CONFIG, ...jenkinsSettings(config.providers?.jenkins) },
  openshift: { ...DEFAULT_OPENSHIFT_CONFIG, ...openShiftSettings(config.providers?.openshift) },
});

/** An app's providers that can be asked: enabled in its settings, set up and with a token. */
export function syncTargets(app: string): SyncTarget[] {
  const { github, jenkins, openshift } = providersOf(loadConfig(app).config);
  const targets: SyncTarget[] = [];
  if (github.enabled && getGitHubToken(github.tokenEnvVar))
    targets.push({ app, source: "github-actions", intervalMs: github.autoRefreshSeconds * 1000 });
  if (jenkins.enabled && jenkins.jobs.length > 0 && getJenkinsToken(jenkins.tokenEnvVar))
    targets.push({ app, source: "jenkins", intervalMs: jenkins.autoRefreshSeconds * 1000 });
  if (
    openshift.enabled &&
    openshift.serverUrl &&
    openshift.namespaces.length > 0 &&
    getOpenShiftToken(openshift.tokenEnvVar)
  )
    targets.push({ app, source: "openshift", intervalMs: openshift.autoRefreshSeconds * 1000 });
  return targets;
}

/** A branch name without its remote: `origin/main` is the `main` Jenkins has a job for. */
const branchName = (ref: string) => ref.replace(/^[^/]+\//, "");

/**
 * Asks one provider about the app's newest commits, as many as its fetch size, in the graph's order: the commits its
 * view asks about when the app is open. What finished goes into the provider's normal cache.
 */
export async function syncTarget(
  target: SyncTarget,
  opts: { cacheRoot?: string; signal?: AbortSignal } = {},
): Promise<CacheSyncResult> {
  const { config } = loadConfig(target.app);
  const providers = providersOf(config);
  const { signal, cacheRoot } = opts;
  const depth =
    target.source === "github-actions"
      ? providers.github.fetchDepth
      : target.source === "jenkins"
        ? providers.jenkins.fetchDepth
        : providers.openshift.fetchDepth;
  const shas = await getTopCommitHashes(
    target.app,
    depth,
    { all: config.showAllBranches ?? true, branch: config.branch },
    signal,
  );
  if (signal?.aborted || shas.length === 0) return SYNC_OK;
  const app = target.app;
  switch (target.source) {
    case "github-actions":
      return syncGitHubCache({
        app,
        config: providers.github,
        remoteUrl: await getRemoteUrl(app, signal),
        shas,
        cacheRoot,
        signal,
      });
    case "jenkins": {
      const main = await mainBranch(app, signal);
      const current = await runGit(app, ["rev-parse", "--abbrev-ref", "HEAD"], signal);
      const branches = [main, current.exitCode === 0 ? current.stdout.trim() : ""]
        .filter(ref => ref && ref !== "HEAD")
        .map(branchName);
      return syncJenkinsCache({ app, config: providers.jenkins, shas, branches, cacheRoot, signal });
    }
    case "openshift":
      return syncOpenShiftCache({ app, config: providers.openshift, shas, cacheRoot, signal });
  }
}
