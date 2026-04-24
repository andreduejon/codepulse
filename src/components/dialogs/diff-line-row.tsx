/**
 * DiffLineRow — renders a single line in the diff viewer.
 *
 * Extracted from DiffBlameDialog to keep the parent component focused on
 * orchestration while keeping the per-line rendering logic in one place.
 *
 * Handles three visual variants:
 *   - spacer: horizontal rule separator between hunks
 *   - hunk-header: @@ section header with optional blame column
 *   - continuation: overflow text from a wrapped line (indent + ↵ prefix)
 *   - regular (add/delete/context): line numbers + prefix + content
 */
import { Show } from "solid-js";
import type { Theme } from "../../context/theme";
import {
  buildGutter,
  type DisplayLine,
  type DisplayLineKind,
  diffLineBg,
  diffLineColor,
  diffLinePrefix,
  formatHunkHeader,
  gutterWidth,
} from "./diff-utils";

export const BLAME_COL_WIDTH = 22;

interface DiffLineRowProps {
  line: DisplayLine | { kind: "continuation"; content: string; originalKind: DisplayLineKind };
  showBlame: boolean;
  blameAnnotation: (line: DisplayLine) => string;
  maxOldLineNo: number;
  maxNewLineNo: number;
  dialogWidth: number;
  t: Theme;
}

export function DiffLineRow(props: Readonly<DiffLineRowProps>) {
  const colors = {
    diffAdded: props.t.diffAdded,
    diffRemoved: props.t.diffRemoved,
    accent: props.t.accent,
    foreground: props.t.foreground,
    diffAddedBg: props.t.diffAddedBg,
    diffRemovedBg: props.t.diffRemovedBg,
  };

  if (props.line.kind === "spacer") {
    const ruleWidth = props.dialogWidth - 10;
    return (
      <text wrapMode="none" fg={props.t.border}>
        {"─".repeat(ruleWidth)}
      </text>
    );
  }

  if (props.line.kind === "hunk-header") {
    const hunkLine = props.line as DisplayLine;
    return (
      <box flexDirection="row" width="100%">
        <Show when={props.showBlame}>
          <box flexShrink={0} width={BLAME_COL_WIDTH} backgroundColor={props.t.backgroundElement}>
            <text wrapMode="none" fg={props.t.foregroundMuted}>
              {props.blameAnnotation(hunkLine)}
            </text>
          </box>
        </Show>
        <text wrapMode="none" fg={props.t.accent}>
          <strong>{formatHunkHeader(hunkLine.content)}</strong>
        </text>
      </box>
    );
  }

  if (props.line.kind === "continuation") {
    const contLine = props.line as { kind: "continuation"; content: string; originalKind: DisplayLineKind };
    const gutterSpaces = " ".repeat(gutterWidth(props.maxOldLineNo) + 1 + gutterWidth(props.maxNewLineNo));
    const origKind = contLine.originalKind;
    return (
      <box flexDirection="row" width="100%" backgroundColor={diffLineBg(origKind, colors)}>
        <Show when={props.showBlame}>
          <box flexShrink={0} width={BLAME_COL_WIDTH} backgroundColor={props.t.backgroundElement}>
            <text wrapMode="none" fg={props.t.foregroundMuted}>
              {" ".repeat(BLAME_COL_WIDTH)}
            </text>
          </box>
        </Show>
        <text flexShrink={0} wrapMode="none" fg={props.t.foregroundMuted}>
          {gutterSpaces}
        </text>
        <text flexShrink={0} wrapMode="none" fg={diffLineColor(origKind, colors)}>
          {"  ↵ "}
        </text>
        <text flexGrow={1} wrapMode="none" fg={diffLineColor(origKind, colors)}>
          {contLine.content}
        </text>
      </box>
    );
  }

  // Regular line: add / delete / context
  const regularLine = props.line as DisplayLine;
  const prefix = diffLinePrefix(regularLine.kind);

  return (
    <box flexDirection="row" width="100%" backgroundColor={diffLineBg(regularLine.kind, colors)}>
      <Show when={props.showBlame}>
        <box flexShrink={0} width={BLAME_COL_WIDTH} backgroundColor={props.t.backgroundElement}>
          <text wrapMode="none" fg={props.t.foregroundMuted}>
            {props.blameAnnotation(regularLine)}
          </text>
        </box>
      </Show>
      <text flexShrink={0} wrapMode="none" fg={props.t.foregroundMuted}>
        {buildGutter(regularLine, gutterWidth(props.maxOldLineNo), gutterWidth(props.maxNewLineNo))}
      </text>
      <text flexShrink={0} wrapMode="none" fg={diffLineColor(regularLine.kind, colors)}>
        {`  ${prefix} `}
      </text>
      <text flexGrow={1} wrapMode="none" fg={diffLineColor(regularLine.kind, colors)}>
        {regularLine.content}
      </text>
    </box>
  );
}
