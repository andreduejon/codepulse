/** Split a file path into directory prefix and basename. */
export function splitPath(filePath: string): { dirPrefix: string; basename: string } {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash < 0) return { dirPrefix: "", basename: filePath };
  return {
    dirPrefix: filePath.slice(0, lastSlash + 1),
    basename: filePath.slice(lastSlash + 1),
  };
}

/**
 * Middle-truncate a string to fit within `maxLen` characters.
 * Returns the original string if it already fits.
 * Uses "…" (1 char) in the middle, keeping the start and end balanced
 * but biased toward keeping the end (right side gets 1 more char).
 */
export function middleTruncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  if (maxLen <= 1) return "\u2026";
  // Reserve 1 char for the ellipsis
  const available = maxLen - 1;
  const leftLen = Math.floor(available / 2);
  const rightLen = available - leftLen;
  return `${text.slice(0, leftLen)}\u2026${text.slice(text.length - rightLen)}`;
}

/** Separator string between title segments. */
export const TITLE_SEP = " \u00b7 ";
/** Width of the separator in characters. */
const SEP_LEN = 3;

/** Width reserved for "esc close" on the right side of the title bar. */
const ESC_CLOSE_WIDTH = 9;

/** Title bar has paddingX={4}, so 4 chars on each side. */
const TITLE_PADDING = 8;

/** Minimum width we'll shrink the basename to before giving up. */
const MIN_BASENAME_LEN = 8;

/** Parts of the diff dialog title, with visibility flags based on width budget. */
export interface DiffTitleParts {
  /** File counter like "[2/5]". Empty string if single file. */
  counter: string;
  /** Source label like "abc1234", "stash:abc1234", "staged". Empty string if dropped. */
  source: string;
  /** Directory prefix (possibly middle-truncated). Empty string if dropped or no directory. */
  dirPrefix: string;
  /** File basename (possibly middle-truncated in extreme cases). */
  basename: string;
  /** Mode label like "new only", "old only". Empty string if hidden or unified. */
  mode: string;
}

/**
 * Compute the total character width of a title layout.
 * Segments in order: counter, source, dir+basename, mode.
 * Dir prefix is visually joined to basename (no separator between them).
 * Separators (" · ") go between present segment groups.
 */
function layoutWidth(cw: number, sw: number, dw: number, bw: number, mw: number): number {
  const segments: number[] = [];
  if (cw > 0) segments.push(cw);
  if (sw > 0) segments.push(sw);
  segments.push(dw + bw); // dir+basename always present (basename never zero)
  if (mw > 0) segments.push(mw);

  let total = 0;
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) total += SEP_LEN;
    total += segments[i];
  }
  return total;
}

/**
 * Build title parts for the diff dialog, applying width-based truncation.
 *
 * Truncation priority (first to go → last):
 * 1. Path prefix shrinks (middle truncation)
 * 2. Mode label hides
 * 3. Source label hides
 * 4. Basename middle-truncates (last resort)
 */
export function buildDiffTitleParts(
  filePath: string,
  sourceLabel: string,
  counter: string,
  modeLabel: string,
  dialogWidth: number,
): DiffTitleParts {
  const { dirPrefix: rawDir, basename: rawBasename } = splitPath(filePath);

  // Total usable width for title content
  const usableWidth = dialogWidth - TITLE_PADDING - ESC_CLOSE_WIDTH;

  // Measure each segment at full size
  const counterLen = counter.length;
  const sourceLen = sourceLabel.length;
  const basenameLen = rawBasename.length;
  const modeLen = modeLabel.length;
  const dirLen = rawDir.length;

  // Phase 1: Try everything at full size
  let needed = layoutWidth(counterLen, sourceLen, dirLen, basenameLen, modeLen);
  if (needed <= usableWidth) {
    return {
      counter,
      source: sourceLabel,
      dirPrefix: rawDir,
      basename: rawBasename,
      mode: modeLabel,
    };
  }

  // Phase 2: Shrink path prefix (middle truncation, then collapse)
  let curDirLen = dirLen;
  if (curDirLen > 0) {
    const minDir = 3; // e.g. "…/"
    const excess = needed - usableWidth;
    const newDirLen = Math.max(minDir, curDirLen - excess);
    curDirLen = newDirLen;
    needed = layoutWidth(counterLen, sourceLen, curDirLen, basenameLen, modeLen);
    if (needed <= usableWidth) {
      return {
        counter,
        source: sourceLabel,
        dirPrefix: middleTruncate(rawDir, curDirLen),
        basename: rawBasename,
        mode: modeLabel,
      };
    }
    // Collapse dir entirely
    curDirLen = 0;
    needed = layoutWidth(counterLen, sourceLen, 0, basenameLen, modeLen);
    if (needed <= usableWidth) {
      return {
        counter,
        source: sourceLabel,
        dirPrefix: "",
        basename: rawBasename,
        mode: modeLabel,
      };
    }
  }

  // Phase 3: Hide mode
  needed = layoutWidth(counterLen, sourceLen, 0, basenameLen, 0);
  if (needed <= usableWidth) {
    return {
      counter,
      source: sourceLabel,
      dirPrefix: "",
      basename: rawBasename,
      mode: "",
    };
  }

  // Phase 4: Hide source
  needed = layoutWidth(counterLen, 0, 0, basenameLen, 0);
  if (needed <= usableWidth) {
    return {
      counter,
      source: "",
      dirPrefix: "",
      basename: rawBasename,
      mode: "",
    };
  }

  // Phase 5: Truncate basename (last resort, middle truncation)
  let availForBasename = usableWidth;
  if (counterLen > 0) availForBasename -= counterLen + SEP_LEN;
  const truncatedLen = Math.max(MIN_BASENAME_LEN, availForBasename);

  return {
    counter,
    source: "",
    dirPrefix: "",
    basename: middleTruncate(rawBasename, truncatedLen),
    mode: "",
  };
}
