/** The graph's characters as the terminal draws them: colored, the commit's block bold. */
import type { TextChunk } from "@opentui/core";
import { RGBA, StyledText, TextAttributes } from "@opentui/core";
import type { GraphChar } from "../../core/git/graph-render";

/**
 * Cache of RGBA objects keyed by hex color string. Graph colors come from
 * a small, fixed theme palette so this avoids repeated hex→RGBA parsing
 * inside the hot graphCharsToContent path.
 */
const rgbaCache = new Map<string, RGBA>();

function cachedRGBA(color: string): RGBA {
  let rgba = rgbaCache.get(color);
  if (!rgba) {
    rgba = RGBA.fromHex(color);
    rgbaCache.set(color, rgba);
  }
  return rgba;
}

/**
 * Convert an array of GraphChars into a StyledText object using the
 * OpenTUI core API. This bypasses JSX <span> modifiers which don't
 * work reliably inside <For>/<Show> control flow.
 *
 * Constructs TextChunk objects directly instead of routing through
 * fg()/bold() helper closures to avoid intermediate allocations.
 */
export function graphCharsToContent(chars: GraphChar[]): StyledText {
  const chunks: TextChunk[] = new Array(chars.length);
  for (let i = 0; i < chars.length; i++) {
    const gc = chars[i];
    chunks[i] = {
      __isChunk: true,
      text: gc.char,
      fg: cachedRGBA(gc.color),
      attributes: gc.bold ? TextAttributes.BOLD : 0,
    };
  }
  return new StyledText(chunks);
}
