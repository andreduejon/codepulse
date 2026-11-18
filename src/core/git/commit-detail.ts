/**
 * The selected commit's details (its files, or the working tree's for the Uncommitted row), without any UI framework:
 * read once the cursor rests, a newer selection cancels an older read, and nothing from another repository is shown.
 * The Solid hook (hooks/use-detail-loader.ts) tells it the selection and keeps the detail tabs.
 */
import { BANNER, bannerOrFallback } from "../banner";
import type { GitPort } from "./port";
import type { Commit, CommitDetail, UncommittedDetail } from "./types";
import { isUncommittedHash } from "./types";

/** How long the cursor rests before the details are read: moving fast through the graph starts no Git. */
export const DETAIL_DEBOUNCE_MS = 150;

export interface CommitDetailPorts {
  git: GitPort;
  repoPath: () => string;
  /** The selected commit now: a working-tree read for a commit no longer selected is dropped. */
  selectedHash: () => string | undefined;
  actions: {
    setCommitDetail: (detail: CommitDetail | null) => void;
    setUncommittedDetail: (detail: UncommittedDetail | null) => void;
    setDetailLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
  };
  /** Timers: the global ones unless a test brings its own. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
}

export function createCommitDetailService(ports: CommitDetailPorts) {
  const { git, repoPath, actions } = ports;
  const later = ports.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const cancelTimer =
    ports.clearTimeout ?? ((timer: unknown) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let controller: AbortController | null = null;
  let workingTreeController: AbortController | null = null;

  const cancel = () => {
    if (timer !== null) cancelTimer(timer);
    controller?.abort();
    timer = controller = null;
  };

  /** The working tree's files as the details show them: staged, unstaged, untracked. */
  const uncommittedFiles = (commit: Commit, detail: UncommittedDetail): CommitDetail => ({
    ...commit,
    files: [...detail.staged, ...detail.unstaged, ...detail.untracked],
  });

  async function read(commit: Commit, path: string, ctrl: AbortController): Promise<void> {
    const current = () => !ctrl.signal.aborted && repoPath() === path;
    try {
      if (isUncommittedHash(commit.hash)) {
        const detail = await git.getUncommittedDetail(path, ctrl.signal);
        if (!current()) return;
        actions.setUncommittedDetail(detail);
        // A plain CommitDetail too, so what reads the commit's files still finds them.
        actions.setCommitDetail(uncommittedFiles(commit, detail));
        actions.setDetailLoading(false);
      } else {
        const detail = await git.getCommitDetail(path, commit.hash, commit, ctrl.signal);
        if (!current()) return;
        actions.setCommitDetail(detail);
        actions.setDetailLoading(false);
      }
    } catch (error) {
      if (ctrl.signal.aborted) return;
      actions.setCommitDetail(null);
      actions.setUncommittedDetail(null);
      actions.setDetailLoading(false);
      actions.setError(bannerOrFallback(error, BANNER.git.detailFailed, "Git"));
    }
  }

  return {
    /** Another commit is selected (or none): the shown details go, and its own are read once the cursor rests. */
    select(commit: Commit | null): void {
      cancel();
      actions.setCommitDetail(null);
      actions.setUncommittedDetail(null);
      if (!commit) {
        actions.setDetailLoading(false);
        return;
      }
      actions.setDetailLoading(true);
      const path = repoPath();
      timer = later(() => {
        timer = null;
        const ctrl = new AbortController();
        controller = ctrl;
        void read(commit, path, ctrl);
      }, DETAIL_DEBOUNCE_MS);
    },
    /**
     * A refresh read a dirty working tree: the selected Uncommitted row shows its files again, quietly. A failed read
     * keeps the files shown; the next refresh tries again.
     */
    reloadWorkingTree(commit: Commit): void {
      if (!isUncommittedHash(commit.hash)) return;
      const path = repoPath();
      workingTreeController?.abort();
      const ctrl = new AbortController();
      workingTreeController = ctrl;
      git
        .getUncommittedDetail(path, ctrl.signal)
        .then(detail => {
          if (ctrl.signal.aborted || repoPath() !== path || ports.selectedHash() !== commit.hash) return;
          actions.setUncommittedDetail(detail);
          actions.setCommitDetail(uncommittedFiles(commit, detail));
        })
        .catch(() => {});
    },
    /** The owner is gone: nothing is read or shown any more. */
    dispose(): void {
      cancel();
      workingTreeController?.abort();
    },
  };
}
