/**
 * The Git command line as the app's Git port. The calls go through the modules at call time, so a test's spy on one of
 * their functions sees them.
 */
import type { GitPort } from "../core/git/port";
import * as repo from "./repo";
import * as repoDashboard from "./repo-dashboard";
import * as repoDiff from "./repo-diff";
import * as repoStatus from "./repo-status";

export function gitCli(): GitPort {
  return {
    isGitAvailable: () => repo.isGitAvailable(),
    isGitRepo: path => repo.isGitRepo(path),
    getRepoRoot: (...args) => repo.getRepoRoot(...args),
    getCommits: (...args) => repo.getCommits(...args),
    getBranches: (...args) => repo.getBranches(...args),
    getCurrentBranch: (...args) => repo.getCurrentBranch(...args),
    getTagDetails: (...args) => repo.getTagDetails(...args),
    getStashList: (...args) => repo.getStashList(...args),
    getRemoteUrl: (...args) => repo.getRemoteUrl(...args),
    getLastFetchTime: repoPath => repo.getLastFetchTime(repoPath),
    getWorkingTreeStatus: (...args) => repoStatus.getWorkingTreeStatus(...args),
    getCommitDetail: (...args) => repo.getCommitDetail(...args),
    getUncommittedDetail: (...args) => repoStatus.getUncommittedDetail(...args),
    getStashFiles: (...args) => repoStatus.getStashFiles(...args),
    getPathMatchingHashes: (...args) => repo.getPathMatchingHashes(...args),
    getFileDiff: (...args) => repoDiff.getFileDiff(...args),
    getFileContent: (...args) => repoDiff.getFileContent(...args),
    getFileBlame: (...args) => repoDiff.getFileBlame(...args),
    fetchRemote: repoPath => repo.fetchRemote(repoPath),
    fastForwardBranches: repoPath => repo.fastForwardBranches(repoPath),
    getMainBranch: (...args) => repoDashboard.getMainBranch(...args),
    getMainBranchCommits: (...args) => repoDashboard.getMainBranchCommits(...args),
    getBranchWalk: (...args) => repoDashboard.getBranchWalk(...args),
    resolveCommit: (...args) => repoDashboard.resolveCommit(...args),
    getCommitInfo: (...args) => repoDashboard.getCommitInfo(...args),
  };
}
