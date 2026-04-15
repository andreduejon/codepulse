import type { TextChunk } from "@opentui/core";
import { RGBA, StyledText, TextAttributes } from "@opentui/core";
import type { Connector, ConnectorType, GraphRow } from "./types";

// Fallback colors if no theme colors provided
const DEFAULT_COLORS = [
  "#f38ba8",
  "#a6e3a1",
  "#89b4fa",
  "#f9e2af",
  "#cba6f7",
  "#94e2d5",
  "#fab387",
  "#74c7ec",
  "#f2cdcd",
  "#89dceb",
  "#b4befe",
  "#eba0ac",
];

export function getColorForColumn(column: number, colors: string[] = DEFAULT_COLORS): string {
  return colors[column % colors.length];
}

/** Convenience wrapper: resolve a color index using a RenderOptions bag. */
function getBaseColor(column: number, opts: RenderOptions): string {
  return getColorForColumn(column, opts.themeColors);
}

/**
 * Render a graph row to a string with Unicode characters.
 * Returns an array of { char, color } segments.
 */
export interface GraphChar {
  char: string;
  color: string;
  bold?: boolean;
}

export interface RenderOptions {
  themeColors?: string[];
  padToColumns?: number;
  padColor?: string;
}

/**
 * Pad a GraphChar[] result to fill `padToColumns` columns (2 chars each).
 * Uses character-width tracking to handle multi-entry glyphs correctly.
 */
function padResult(result: GraphChar[], padToColumns: number | undefined, opts: RenderOptions): void {
  if (padToColumns === undefined) return;
  const targetWidth = padToColumns * 2;
  let currentWidth = 0;
  for (const gc of result) currentWidth += gc.char.length;
  const color = getBaseColor(0, opts);
  while (currentWidth < targetWidth) {
    result.push({ char: "  ", color });
    currentWidth += 2;
  }
}

/**
 * Configuration for the shared connector-to-glyph renderer.
 * The tee glyphs differ between commit rows (├/┤) and fan-out rows (█/█).
 */
interface ConnectorGlyphConfig {
  teeLeftChar: string; // "├" for commit rows, "█" for fan-out rows
  teeRightGlyph: string; // "┤ " for commit rows, "█ " for fan-out rows
  /** Extra types (besides "horizontal") to check at the next column for tee-left dash color. */
  teeLeftDashExtraTypes?: ConnectorType[];
}

/**
 * Shared connector-to-glyph rendering used by both renderGraphRow and renderFanOutRow.
 *
 * Given the connectors at a single column, pushes the appropriate glyph(s) onto `result`.
 * Handles: teeLeft, teeRight, corners (TR/TL/BR/BL), straight+horizontal crossings,
 * horizontal, straight, and empty. Does NOT handle "node" connectors — the caller
 * must check for those before calling this function.
 *
 * @returns true if glyphs were pushed, false if no known connector was found at this column
 */
function renderConnectorGlyphs(
  connectors: Connector[],
  col: number,
  byCol: Map<number, Connector[]>,
  result: GraphChar[],
  opts: RenderOptions,
  config: ConnectorGlyphConfig,
): boolean {
  function connColor(c: { color: number }): string {
    return getBaseColor(c.color, opts);
  }

  const straight = connectors.find(c => c.type === "straight");
  const horizontal = connectors.find(c => c.type === "horizontal");
  const cornerBR = connectors.find(c => c.type === "corner-bottom-right");
  const cornerBL = connectors.find(c => c.type === "corner-bottom-left");
  const cornerTR = connectors.find(c => c.type === "corner-top-right");
  const cornerTL = connectors.find(c => c.type === "corner-top-left");
  const teeLeft = connectors.find(c => c.type === "tee-left");
  const teeRight = connectors.find(c => c.type === "tee-right");

  if (teeLeft) {
    const teeColor = connColor(teeLeft);
    const nextConns = byCol.get(col + 1);
    const extraTypes = config.teeLeftDashExtraTypes ?? [];
    const nextH = nextConns?.find(c => c.type === "horizontal" || extraTypes.includes(c.type));
    const dashColor = nextH ? connColor(nextH) : teeColor;
    // Always emit tee-left and ─ as separate 1-char entries so that
    // dimGraphChars can dim them independently (junction → │ bright,
    // ─ dimmed).
    result.push({ char: config.teeLeftChar, color: teeColor });
    result.push({ char: "─", color: dashColor });
  } else if (teeRight) {
    result.push({ char: config.teeRightGlyph, color: connColor(teeRight) });
  } else if (straight && horizontal) {
    // Crossing: ┼ uses the vertical lane's color, ─ uses the horizontal's color
    result.push({ char: "┼", color: connColor(straight) });
    result.push({ char: "─", color: connColor(horizontal) });
  } else if (cornerBR) {
    if (horizontal) {
      result.push({ char: "┴", color: connColor(cornerBR) });
      result.push({ char: "─", color: connColor(horizontal) });
    } else {
      result.push({ char: "╯ ", color: connColor(cornerBR) });
    }
  } else if (cornerBL) {
    const cornerColor = connColor(cornerBL);
    if (horizontal) {
      result.push({ char: "┴", color: cornerColor });
      result.push({ char: "─", color: connColor(horizontal) });
    } else {
      const nextConns = byCol.get(col + 1);
      const nextH = nextConns?.find(c => c.type === "horizontal");
      const dashColor = nextH ? connColor(nextH) : cornerColor;
      if (dashColor === cornerColor) {
        result.push({ char: "╰─", color: cornerColor });
      } else {
        result.push({ char: "╰", color: cornerColor });
        result.push({ char: "─", color: dashColor });
      }
    }
  } else if (cornerTR) {
    if (horizontal) {
      const cornerColor = connColor(cornerTR);
      const hColor = connColor(horizontal);
      result.push({ char: "┬", color: cornerColor });
      result.push({ char: "─", color: hColor });
    } else {
      result.push({ char: "╮ ", color: connColor(cornerTR) });
    }
  } else if (cornerTL) {
    const cornerColor = connColor(cornerTL);
    const nextConns = byCol.get(col + 1);
    const nextH = nextConns?.find(c => c.type === "horizontal");
    const dashColor = nextH ? connColor(nextH) : cornerColor;
    if (dashColor === cornerColor) {
      result.push({ char: "╭─", color: cornerColor });
    } else {
      result.push({ char: "╭", color: cornerColor });
      result.push({ char: "─", color: dashColor });
    }
  } else if (straight) {
    result.push({ char: "│ ", color: connColor(straight), bold: true });
  } else if (horizontal) {
    result.push({ char: "──", color: connColor(horizontal) });
  } else {
    return false;
  }
  return true;
}

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

/**
 * Render the connector (continuation) row that sits below a commit row.
 * This draws only vertical lines (│) for active lanes, providing visual
 * continuity so that the ● node doesn't create gaps in the graph lines.
 */
export function renderConnectorRow(row: GraphRow, opts: RenderOptions = {}): GraphChar[] {
  const padToColumns = opts.padToColumns;
  const result: GraphChar[] = [];

  for (let col = 0; col < row.columns.length; col++) {
    if (row.columns[col].active) {
      const color = getBaseColor(row.columns[col].color, opts);
      result.push({ char: "│ ", color, bold: true });
    } else {
      result.push({ char: "  ", color: getBaseColor(row.columns[col].color, opts) });
    }
  }

  padResult(result, padToColumns, opts);

  return result;
}

/**
 * Render a gap indicator row for filtered search results.
 *
 * Same layout as a connector row, but uses `┊` (light quadruple dash vertical)
 * instead of `│` for active lanes — signalling that commits were omitted between
 * two non-adjacent filtered rows. Inactive columns get empty space.
 */
export function renderGapRow(row: GraphRow, opts: RenderOptions = {}): GraphChar[] {
  const padToColumns = opts.padToColumns;
  const dimColor = opts.padColor ?? "#6c7086";
  const result: GraphChar[] = [];

  for (let col = 0; col < row.columns.length; col++) {
    if (row.columns[col].active) {
      result.push({ char: "┊ ", color: dimColor, bold: false });
    } else {
      result.push({ char: "  ", color: dimColor });
    }
  }

  padResult(result, padToColumns, opts);

  return result;
}

/**
 * Render a fan-out connector row. These are extra rows below a commit that
 * show branch-off corners for lanes that were all pointing to the same parent.
 * Each fan-out row shows one lane closing with a corner, plus straight lines
 * for active lanes and horizontals spanning from the parent's column.
 *
 * The connectors array is pre-built by buildGraph — one entry per column.
 */
export function renderFanOutRow(
  fanOutConnectors: Connector[],
  opts: RenderOptions = {},
  nodeColumn?: number,
): GraphChar[] {
  const padToColumns = opts.padToColumns;
  const result: GraphChar[] = [];

  // Group by column — may have multiple connectors at the same column (crossing)
  const byCol = new Map<number, Connector[]>();
  let maxCol = 0;
  for (const c of fanOutConnectors) {
    const list = byCol.get(c.column) ?? [];
    list.push(c);
    byCol.set(c.column, list);
    if (c.column >= maxCol) maxCol = c.column + 1;
  }

  // Node column uses █ for the commit's block glyph.
  // Other columns (e.g. absorbed merge connectors) use ├/┤ so they
  // don't look like a second commit on the same row.
  const nodeConfig: ConnectorGlyphConfig = {
    teeLeftChar: "█",
    teeRightGlyph: "█ ",
    teeLeftDashExtraTypes: ["corner-bottom-right"],
  };
  const mergeConfig: ConnectorGlyphConfig = {
    teeLeftChar: "├",
    teeRightGlyph: "┤ ",
    teeLeftDashExtraTypes: ["corner-bottom-right"],
  };

  for (let col = 0; col < maxCol; col++) {
    const connectors = byCol.get(col);
    if (!connectors || connectors.length === 0) {
      result.push({ char: "  ", color: getBaseColor(col, opts) });
      continue;
    }

    // Use █ only at the node column; ├/┤ at absorbed merge tee columns
    const config =
      (nodeColumn !== undefined && col === nodeColumn) || nodeColumn === undefined ? nodeConfig : mergeConfig;

    if (!renderConnectorGlyphs(connectors, col, byCol, result, opts, config)) {
      result.push({ char: "  ", color: getBaseColor(col, opts) });
    }
  }

  padResult(result, padToColumns, opts);

  return result;
}

export function renderGraphRow(row: GraphRow, opts: RenderOptions = {}): GraphChar[] {
  const padToColumns = opts.padToColumns;
  const nodeChar = "█";
  const result: GraphChar[] = [];

  // Determine the max column we need to render
  let maxCol = 0;
  for (const c of row.connectors) {
    if (c.column >= maxCol) maxCol = c.column + 1;
  }
  maxCol = Math.max(maxCol, row.columns.length);

  // Group connectors by column for easy lookup
  const connectorsByCol = new Map<number, Connector[]>();
  for (const c of row.connectors) {
    const list = connectorsByCol.get(c.column) ?? [];
    list.push(c);
    connectorsByCol.set(c.column, list);
  }

  // Check if the node column has a horizontal connection going to the right
  // (i.e. the column right of the node has a horizontal, tee, or corner connector)
  const nodeConnector = row.connectors.find(c => c.type === "node");
  const nodeCol = nodeConnector?.column ?? -1;
  const hasRightConnection =
    nodeCol >= 0 &&
    connectorsByCol.has(nodeCol + 1) &&
    (connectorsByCol.get(nodeCol + 1) ?? []).some(
      c =>
        c.type === "horizontal" ||
        c.type === "tee-right" ||
        c.type === "corner-top-right" ||
        c.type === "corner-bottom-right",
    );

  function connColor(c: { color: number }): string {
    return getBaseColor(c.color, opts);
  }

  const config: ConnectorGlyphConfig = {
    teeLeftChar: "├",
    teeRightGlyph: "┤ ",
  };

  for (let col = 0; col < maxCol; col++) {
    const colConnectors = connectorsByCol.get(col) ?? [];

    if (colConnectors.length === 0) {
      result.push({ char: "  ", color: getBaseColor(col, opts) });
      continue;
    }

    // Handle node connector (only in commit rows, not fan-out rows)
    const node = colConnectors.find(c => c.type === "node");
    if (node) {
      const nodeColor = getBaseColor(node.color, opts);
      if (col === nodeCol && hasRightConnection) {
        // The ─ right after █ uses the OTHER branch's color (same as horizontals).
        // For merges: source branch color. For branch-offs: new branch color.
        result.push({ char: nodeChar, color: nodeColor, bold: true });
        // Find the horizontal, corner, or tee connector at col+1 to pick up the other branch's color
        const nextConnectors = connectorsByCol.get(col + 1) ?? [];
        const nextHoriz = nextConnectors.find(c => c.type === "horizontal");
        const nextCorner = nextConnectors.find(
          c =>
            c.type === "corner-top-right" ||
            c.type === "corner-bottom-right" ||
            c.type === "corner-top-left" ||
            c.type === "corner-bottom-left",
        );
        const nextTee = nextConnectors.find(c => c.type === "tee-left" || c.type === "tee-right");
        const hConn = nextHoriz ?? nextCorner ?? nextTee;
        const dashColor = hConn ? connColor(hConn) : getBaseColor(node.color, opts);
        result.push({ char: "─", color: dashColor });
      } else if (col === nodeCol) {
        result.push({ char: `${nodeChar} `, color: nodeColor, bold: true });
      }
      continue;
    }

    // Delegate all non-node connectors to the shared glyph renderer
    if (!renderConnectorGlyphs(colConnectors, col, connectorsByCol, result, opts, config)) {
      result.push({ char: "  ", color: getBaseColor(col, opts) });
    }
  }

  padResult(result, padToColumns, opts);

  return result;
}
