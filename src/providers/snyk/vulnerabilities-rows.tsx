import type { Renderable } from "@opentui/core";
import { For, Show } from "solid-js";
import { useT } from "../../hooks/use-t";
import { highlightMatch } from "./filter";
import { isMatureExploit, type SnykVulnerabilityEntry } from "./parser";
import { type SnykRows, severityColor } from "./tab-shared";
import {
  type DetailLine,
  detailLines,
  type FlatItem,
  itemKey,
  type PackageRow,
  type Section,
  shortCoordinate,
  toneColor,
  wrapWords,
} from "./vulnerabilities-model";

/** What the rows read from the Vulnerabilities tab: cursor order, expansion, filter and widths. */
export interface VulnerabilityRowsView {
  rows: SnykRows;
  indexOf: (item: FlatItem) => number;
  rowRef: (item: FlatItem) => (element: Renderable) => void;
  mouseEnabled: () => boolean | undefined;
  query: () => string;
  copiedId: () => string | null;
  bannerOverflow: () => number;
  scrolled: (text: string, active: boolean, width: number) => string;
  metadataWidth: () => number;
  findingLabelWidth: () => number;
  sectionLabelWidth: (section: Section) => number;
  findingExpanded: (key: string) => boolean;
  sectionExpanded: (section: Section) => boolean;
  packageExpanded: (pkg: PackageRow) => boolean;
}

const scoreText = (score: number | null) => (score == null ? "" : score.toFixed(1));

function Field(fieldProps: {
  view: VulnerabilityRowsView;
  owner: string;
  line: DetailLine;
  last: boolean;
  branch: string;
}) {
  const t = useT();
  const v = fieldProps.view;
  const line = fieldProps.line;
  const item: FlatItem = { kind: "field", owner: fieldProps.owner, line };
  const key = itemKey(item);
  const index = () => (line.field ? v.indexOf(item) : -1);
  const cursored = () => v.rows.cursored(index());
  const texts = () => (line.wrap ? wrapWords(line.text, v.metadataWidth()) : [line.text]);
  const rows = () =>
    texts().map((text, textIndex) => (
      <box flexDirection="row" width="100%">
        <text selectable={!v.mouseEnabled()} flexShrink={0} wrapMode="none" fg={t().border}>
          {fieldProps.branch}
          {textIndex === 0 ? (fieldProps.last ? "└─ " : "├─ ") : fieldProps.last ? "   " : "│  "}
        </text>
        <text
          selectable={!v.mouseEnabled()}
          flexGrow={1}
          flexShrink={1}
          wrapMode="none"
          truncate={v.bannerOverflow() === 0 || !cursored()}
          fg={cursored() ? t().accent : toneColor(t(), line.tone)}
        >
          {line.wrap
            ? highlightMatch(text, v.query(), t().snykBg)
            : cursored()
              ? v.scrolled(line.full ?? text, true, v.metadataWidth())
              : highlightMatch(text, v.query(), t().snykBg)}
        </text>
        <Show when={textIndex === 0 && line.suffix}>
          <text selectable={!v.mouseEnabled()} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {` ${line.suffix}`}
          </text>
        </Show>
        <Show when={textIndex === 0 && line.field && v.copiedId() === key}>
          <text selectable={!v.mouseEnabled()} flexShrink={0} bg={t().primary} fg={t().background} wrapMode="none">
            {" \u2713 copied "}
          </text>
        </Show>
      </box>
    ));
  if (!line.field) return <>{rows()}</>;
  return (
    <box
      {...v.rows.mouseRow(key, index)}
      ref={v.rowRef(item)}
      flexDirection="column"
      width="100%"
      backgroundColor={v.rows.background(key, index())}
    >
      {rows()}
    </box>
  );
}

function Entry(entryProps: {
  view: VulnerabilityRowsView;
  entry: SnykVulnerabilityEntry;
  last: boolean;
  indent?: string;
}) {
  const t = useT();
  const v = entryProps.view;
  const indent = entryProps.indent ?? "";
  const entry = entryProps.entry;
  const item: FlatItem = { kind: "finding", entry };
  const key = itemKey(item);
  const index = () => v.indexOf(item);
  const cursored = () => v.rows.cursored(index());
  const expanded = () => v.findingExpanded(entry.key);
  const lines = () => detailLines(entry);
  return (
    <box flexDirection="column" width="100%">
      <box
        {...v.rows.mouseRow(key, index)}
        ref={v.rowRef(item)}
        flexDirection="row"
        width="100%"
        backgroundColor={v.rows.background(key, index())}
      >
        <text selectable={!v.mouseEnabled()} flexShrink={0} wrapMode="none" fg={t().border}>
          {indent}
          {entryProps.last ? "└─ " : "├─ "}
        </text>
        <text
          selectable={!v.mouseEnabled()}
          flexShrink={0}
          wrapMode="none"
          fg={cursored() ? t().accent : t().foregroundMuted}
        >
          {expanded() ? "▾ " : "▸ "}
        </text>
        <text
          selectable={!v.mouseEnabled()}
          flexGrow={1}
          flexShrink={1}
          wrapMode="none"
          truncate={v.bannerOverflow() === 0 || !cursored()}
          fg={cursored() ? t().accent : t().foreground}
        >
          {cursored()
            ? v.scrolled(entry.label, true, v.findingLabelWidth())
            : highlightMatch(entry.label, v.query(), t().snykBg)}
        </text>
        {/* "!" sits right before the score: padding + marker + space, then the score (7 columns total). */}
        <text selectable={!v.mouseEnabled()} flexShrink={0} wrapMode="none" fg={t().error}>
          {`${" ".repeat(5 - scoreText(entry.finding.cvssScore).length)}${isMatureExploit(entry.finding) ? "!" : " "} `}
        </text>
        {/* Score carries the severity color in both views; labels stay plain. */}
        <text
          selectable={!v.mouseEnabled()}
          flexShrink={0}
          wrapMode="none"
          fg={severityColor(t(), entry.finding.severity)}
        >
          {scoreText(entry.finding.cvssScore)}
        </text>
        <text selectable={!v.mouseEnabled()} flexShrink={0} wrapMode="none" fg={toneColor(t(), entry.fix)}>
          {" ●"}
        </text>
      </box>
      <Show when={expanded()}>
        <box flexDirection="column" width="100%">
          <For each={lines()}>
            {(line, lineIndex) => (
              <Field
                view={v}
                owner={entry.key}
                line={line}
                last={lineIndex() === lines().length - 1}
                branch={indent + (entryProps.last ? "   " : "│  ")}
              />
            )}
          </For>
        </box>
      </Show>
    </box>
  );
}

/** Right-aligned muted count, `current/original` while filtering. */
function Count(countProps: { view: VulnerabilityRowsView; current: number; original: number; selectable: boolean }) {
  const t = useT();
  return (
    <text selectable={countProps.selectable} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
      {` ${countProps.current}${countProps.view.query().trim() && countProps.original > 0 ? `/${countProps.original}` : ""}`}
    </text>
  );
}

function PackageView(packageProps: { view: VulnerabilityRowsView; pkg: PackageRow; last: boolean }) {
  const t = useT();
  const v = packageProps.view;
  const pkg = packageProps.pkg;
  const item: FlatItem = { kind: "package", pkg };
  const key = itemKey(item);
  const index = () => v.indexOf(item);
  const isEmpty = () => pkg.entries.length === 0;
  const cursored = () => !isEmpty() && v.rows.cursored(index());
  const expanded = () => !isEmpty() && v.packageExpanded(pkg);
  return (
    <box flexDirection="column" width="100%">
      <box
        {...v.rows.mouseRow(key, index)}
        ref={element => {
          if (!isEmpty()) v.rowRef(item)(element);
        }}
        flexDirection="row"
        width="100%"
        backgroundColor={v.rows.background(key, index())}
      >
        <text selectable={!v.mouseEnabled() || isEmpty()} flexShrink={0} wrapMode="none" fg={t().border}>
          {packageProps.last ? "└─ " : "├─ "}
        </text>
        <text
          selectable={!v.mouseEnabled() || isEmpty()}
          flexShrink={0}
          wrapMode="none"
          fg={cursored() ? t().accent : t().foregroundMuted}
        >
          {isEmpty() ? "· " : expanded() ? "▾ " : "▸ "}
        </text>
        <text
          selectable={!v.mouseEnabled() || isEmpty()}
          flexGrow={1}
          flexShrink={1}
          wrapMode="none"
          truncate
          fg={cursored() ? t().accent : pkg.self || isEmpty() ? t().foregroundMuted : t().foreground}
        >
          {pkg.self || cursored()
            ? pkg.self
              ? "self"
              : shortCoordinate(pkg.name)
            : highlightMatch(shortCoordinate(pkg.name), v.query(), t().snykBg)}
        </text>
        <Count
          view={v}
          current={pkg.entries.length}
          original={pkg.original}
          selectable={!v.mouseEnabled() || isEmpty()}
        />
      </box>
      <Show when={expanded()}>
        <For each={pkg.entries}>
          {(entry, entryIndex) => (
            <Entry
              view={v}
              entry={entry}
              last={entryIndex() === pkg.entries.length - 1}
              indent={packageProps.last ? "   " : "│  "}
            />
          )}
        </For>
      </Show>
    </box>
  );
}

export function SectionView(sectionProps: { view: VulnerabilityRowsView; section: Section }) {
  const t = useT();
  const v = sectionProps.view;
  const section = sectionProps.section;
  const item: FlatItem = { kind: "section", section };
  const key = itemKey(item);
  const index = () => v.indexOf(item);
  const isEmpty = () => section.entries.length === 0;
  const cursored = () => !isEmpty() && v.rows.cursored(index());
  const expanded = () => v.sectionExpanded(section);
  const severity = section.severity;
  // Always the short name: swapping to full coordinates on the cursor made the header jump.
  const label = () => (severity ? section.label : v.scrolled(section.label, cursored(), v.sectionLabelWidth(section)));
  return (
    <box flexDirection="column" width="100%">
      <box
        {...v.rows.mouseRow(key, index)}
        ref={element => {
          if (!isEmpty()) v.rowRef(item)(element);
        }}
        flexDirection="row"
        width="100%"
        backgroundColor={v.rows.background(key, index())}
      >
        <text
          selectable={!v.mouseEnabled() || isEmpty()}
          flexShrink={0}
          wrapMode="none"
          fg={cursored() ? t().accent : t().foregroundMuted}
        >
          {isEmpty() ? "· " : expanded() ? "▾ " : "▸ "}
        </text>
        <text
          selectable={!v.mouseEnabled() || isEmpty()}
          flexGrow={1}
          flexShrink={1}
          wrapMode="none"
          truncate={v.bannerOverflow() === 0 || !cursored()}
          fg={
            isEmpty()
              ? t().foregroundMuted
              : severity
                ? severityColor(t(), severity)
                : cursored()
                  ? t().accent
                  : t().foreground
          }
        >
          {!isEmpty() ? <strong>{label()}</strong> : label()}
        </text>
        <Count
          view={v}
          current={section.entries.length}
          original={section.original}
          selectable={!v.mouseEnabled() || isEmpty()}
        />
      </box>
      <Show when={expanded()}>
        <Show
          when={section.packages}
          fallback={
            <For each={section.entries}>
              {(entry, entryIndex) => (
                <Entry view={v} entry={entry} last={entryIndex() === section.entries.length - 1} />
              )}
            </For>
          }
        >
          {packages => (
            <For each={packages()}>
              {(pkg, pkgIndex) => <PackageView view={v} pkg={pkg} last={pkgIndex() === packages().length - 1} />}
            </For>
          )}
        </Show>
      </Show>
    </box>
  );
}
