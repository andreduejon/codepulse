export { buildGraph } from "./graph-build";
export {
  type BrightColumns,
  computeBrightColumns,
  type DimOptions,
  dimGraphChars,
} from "./graph-highlight";
export {
  type GraphChar,
  getColorForColumn,
  graphCharsToContent,
  type RenderOptions,
  renderConnectorRow,
  renderFanOutRow,
  renderGapRow,
  renderGraphRow,
} from "./graph-render";
export {
  buildEdgeIndicator,
  computeSingleViewportOffset,
  getMaxGraphColumns,
  MAX_GRAPH_COLUMNS,
  sliceGraphToViewport,
} from "./graph-viewport";
