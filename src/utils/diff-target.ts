import type { DiffSource, DiffTarget, FileChange } from "../git/types";

/**
 * Build a DiffTarget from a commit hash, file path, source, and file list.
 *
 * Handles the indexOf + Math.max(0, ...) clamp + status lookup that would
 * otherwise be repeated at each call site.
 */
export function buildDiffTarget(
  commitHash: string,
  filePath: string,
  source: DiffSource,
  files: FileChange[],
): DiffTarget {
  const fileList = files.map(f => f.path);
  const fileIndex = Math.max(0, fileList.indexOf(filePath));
  return {
    commitHash,
    filePath,
    source,
    status: files[fileIndex]?.status,
    fileList,
    fileIndex,
  };
}
