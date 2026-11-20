/**
 * GitHub's Pull requests tab: the open pull requests whose branch points at the commit (the graph's `PR #123` chips),
 * one row each with its title, its branch and the one it would merge into, and its author. Enter opens one on the files
 * it changed, as GitHub's Files changed shows them (between where its branch left the target's and its head, read by
 * Git); Enter on a file opens its diff. `o` opens the pull request on GitHub. Only a commit that has one has the tab
 * (as Stashes), so it never shows empty.
 *
 * Receives props directly (not via useContext): it may render during setup, before the AppStateContext.Provider
 * mounts (AGENTS.md rule 5).
 */

import { createEffect, createMemo, createSignal, For, Match, onCleanup, Switch, untrack } from "solid-js";
import type { DiffTarget, FileChange } from "../../../core/git/types";
import type { GitHubPullRequest } from "../../../core/github/types";
import type { DetailMemory } from "../../components/detail-memory";
import type { DetailNavRef } from "../../components/detail-types";
import { FileTreeEntry } from "../../components/file-tree-entry";
import type { MergePreview } from "../../graph/merge-preview";
import { useT } from "../../hooks/use-t";
import { BUSY } from "../../utils/busy-text";
import { formatRelativeDate } from "../../utils/date";
import { buildDiffTarget } from "../../utils/diff-target";
import { buildFileTree, type FileTreeRow, flattenFileTree } from "../../utils/file-tree";
import { ProviderActionRow, ProviderSummaryRow, ScrollingLabel, useDetailRowMouse } from "../shared/detail-rows";
import { useDetailTree } from "../shared/detail-tree";
import { type RowShortcut, useOpenRowShortcut } from "../shared/open-row";

/** A pull request's files: where its branch left the target's, and what it changed since. */
export interface PullFiles {
  mergeBase: string;
  files: FileChange[];
}

export interface PullRequestsTabProps {
  sha: string;
  pullRequestsAt: (sha: string) => GitHubPullRequest[];
  /** Its files from Git; null when Git hasn't both its commits (its branch or the target's isn't fetched). */
  loadFiles?: (pr: GitHubPullRequest) => Promise<PullFiles | null>;
  /** Opens a file's diff; without it the files don't open (the Dashboard's details). */
  onOpenDiff?: (target: DiffTarget) => void;
  /** Previews the selected pull request's merge in the graph beside the tab; null clears it. */
  onMergePreview?: (preview: MergePreview | null) => void;
  /** Read the commit again (`Reload commit`): its runs and the open pull requests. */
  fetchCommitData?: (sha: string, force?: boolean) => Promise<void>;
  /** Why it cannot load; null when it can. */
  unavailableReason?: string | null;
  /** The provider is fetching. */
  loading?: boolean;
  mouseEnabled?: boolean;
  onMouseFocus?: () => void;
  /** Keeps open pull requests and closed folders while the tab is not shown (another tab, the other layout). */
  memory?: DetailMemory;
  navRef?: DetailNavRef;
  detailCursorIndex: () => number;
  detailFocused: () => boolean;
  setDetailCursorAction: (action: string | null) => void;
  setDetailCursorIndex: (idx: number) => void;
  setDetailCursorShortcut?: (shortcut: RowShortcut | null) => void;
}

const RELOAD = "reload";
const pullKey = (pr: GitHubPullRequest) => `pull:${pr.number}`;
/** One version of a pull request: another head or target is another set of files. */
const versionKey = (pr: GitHubPullRequest) => `${pr.number}:${pr.headSha}:${pr.baseSha}:${pr.baseRef}`;

type Loaded = { state: "loading" } | { state: "missing" } | ({ state: "ready" } & PullFiles);

type Row =
  | { kind: "pull"; key: string; pr: GitHubPullRequest; last: boolean; open: boolean }
  | { kind: "note"; key: string; lead: string; text: string }
  | { kind: "file"; key: string; pr: GitHubPullRequest; row: FileTreeRow; loaded: PullFiles; collapsed: boolean };

/** The pull requests opened and the folders closed, in one commit. */
interface PullsMemory {
  sha: string | null;
  open: Set<number>;
  collapsed: Set<string>;
}

const newPullsMemory = (): PullsMemory => ({ sha: null, open: new Set(), collapsed: new Set() });

export function PullRequestsTab(props: Readonly<PullRequestsTabProps>) {
  const t = useT();
  const kept = props.memory?.("pulls", newPullsMemory) ?? newPullsMemory();
  const sameCommit = kept.sha === untrack(() => props.sha);
  const [open, setOpen] = createSignal<ReadonlySet<number>>(sameCommit ? kept.open : new Set());
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(sameCommit ? kept.collapsed : new Set());
  // Another commit starts with every pull request closed.
  createEffect(() => {
    const sha = props.sha;
    if (kept.sha === sha) return;
    kept.sha = sha;
    kept.open = new Set();
    kept.collapsed = new Set();
    setOpen(kept.open);
    setCollapsed(kept.collapsed);
  });
  const toggle = <T,>(set: ReadonlySet<T>, item: T) => {
    const next = new Set(set);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    return next;
  };

  const pulls = () => props.pullRequestsAt(props.sha);
  const [loaded, setLoaded] = createSignal<ReadonlyMap<string, Loaded>>(new Map());
  // An opened pull request reads its files once per version (a push or a new target reads them again).
  createEffect(() => {
    for (const pr of pulls()) {
      const version = versionKey(pr);
      if (!open().has(pr.number) || untrack(loaded).has(version) || !props.loadFiles) continue;
      setLoaded(map => new Map(map).set(version, { state: "loading" }));
      void props
        .loadFiles(pr)
        .catch(() => null)
        .then(files =>
          setLoaded(map => new Map(map).set(version, files ? { state: "ready", ...files } : { state: "missing" })),
        );
    }
  });

  const rows = createMemo<Row[]>(() =>
    pulls().flatMap((pr, index): Row[] => {
      const last = index === pulls().length - 1;
      const isOpen = open().has(pr.number);
      const head: Row = { kind: "pull", key: pullKey(pr), pr, last, open: isOpen };
      if (!isOpen) return [head];
      const lead = last ? "   " : "│  ";
      const files = loaded().get(versionKey(pr));
      if (!files || files.state === "loading")
        return [head, { kind: "note", key: `${head.key}:note`, lead, text: BUSY.readingFiles }];
      if (files.state === "missing")
        return [
          head,
          { kind: "note", key: `${head.key}:note`, lead, text: "Its commits aren't fetched here: f fetches them." },
        ];
      const dirs = new Set(
        [...collapsed()].flatMap(key => (key.startsWith(`${pr.number}:`) ? [key.slice(`${pr.number}:`.length)] : [])),
      );
      return [
        head,
        ...flattenFileTree(buildFileTree(files.files), dirs).map(
          (row): Row => ({
            kind: "file",
            key: `${head.key}:${row.isDir ? `dir:${row.dirPath}` : `file:${row.file?.path}`}`,
            pr,
            row: { ...row, prefix: lead + row.prefix },
            loaded: files,
            collapsed: row.isDir && dirs.has(row.dirPath),
          }),
        ),
      ];
    }),
  );
  const reloadEnabled = () => !props.unavailableReason;
  const keys = createMemo(() => [
    ...(reloadEnabled() ? [RELOAD] : []),
    ...rows().flatMap(row => (row.kind === "note" ? [] : [row.key])),
  ]);
  const indexes = createMemo(() => new Map(keys().map((key, index) => [key, index])));
  const indexOf = (key: string) => indexes().get(key) ?? -1;
  const cursored = (key: string) => props.detailFocused() && props.detailCursorIndex() === indexOf(key);
  const current = () => {
    const key = keys()[props.detailCursorIndex()];
    return key === RELOAD ? RELOAD : rows().find(row => row.key === key);
  };

  const activate = () => {
    const row = current();
    if (row === RELOAD) {
      if (reloadEnabled() && !props.loading) void props.fetchCommitData?.(props.sha, true);
    } else if (row?.kind === "pull") {
      kept.open = toggle(open(), row.pr.number);
      setOpen(kept.open);
    } else if (row?.kind === "file" && row.row.isDir) {
      kept.collapsed = toggle(collapsed(), `${row.pr.number}:${row.row.dirPath}`);
      setCollapsed(kept.collapsed);
    } else if (row?.kind === "file" && row.row.file)
      props.onOpenDiff?.(
        buildDiffTarget(row.pr.headSha, row.row.file.path, "range", row.loaded.files, row.loaded.mergeBase),
      );
    return false;
  };
  const mouse = useDetailRowMouse({
    mouseEnabled: () => props.mouseEnabled,
    onMouseFocus: props.onMouseFocus,
    setDetailCursorIndex: props.setDetailCursorIndex,
    activate,
    inert: key => key === RELOAD && (!reloadEnabled() || !!props.loading),
  });
  const tree = useDetailTree({
    navRef: props.navRef,
    keys,
    activate,
    detailCursorIndex: props.detailCursorIndex,
    setDetailCursorIndex: props.setDetailCursorIndex,
  });
  useOpenRowShortcut({
    navRef: props.navRef,
    detailFocused: props.detailFocused,
    url: () => {
      const row = current();
      return row && row !== RELOAD && row.kind !== "note" ? row.pr.url : null;
    },
    setDetailCursorShortcut: props.setDetailCursorShortcut,
  });
  createEffect(() => {
    const row = current();
    if (!props.detailFocused() || !row) props.setDetailCursorAction(null);
    else if (row === RELOAD) props.setDetailCursorAction(reloadEnabled() && !props.loading ? "reload" : null);
    else if (row.kind === "pull") props.setDetailCursorAction(row.open ? "collapse" : "files");
    else if (row.kind === "file" && row.row.isDir) props.setDetailCursorAction(row.collapsed ? "expand" : "collapse");
    else props.setDetailCursorAction(props.onOpenDiff ? "view diff" : null);
  });

  // The graph previews one merge: the pull request under the cursor (on it or its files), else the first.
  createEffect(() => {
    const row = current();
    const pr = row && row !== RELOAD && row.kind !== "note" ? row.pr : pulls()[0];
    props.onMergePreview?.(pr ? { head: pr.headSha, base: pr.baseSha, baseRef: pr.baseRef } : null);
  });
  onCleanup(() => props.onMergePreview?.(null));

  /** The stat columns' widths: as wide as the widest count of the pull request's files. */
  const statWidths = (files: readonly FileChange[]) => ({
    add: Math.max(2, ...files.map(file => `+${file.additions}`.length)),
    del: Math.max(2, ...files.map(file => `-${file.deletions}`.length)),
  });

  const renderPull = (row: Extract<Row, { kind: "pull" }>) => {
    const pr = row.pr;
    // A draft is not ready for review: muted, as its chip in the graph.
    const fg = () => (cursored(row.key) ? t().accent : pr.draft ? t().foregroundMuted : t().foreground);
    return (
      <box
        {...mouse.mouseRow(row.key, () => indexOf(row.key))}
        ref={tree.ref(row.key)}
        flexDirection="row"
        width="100%"
        backgroundColor={cursored(row.key) ? t().backgroundElementActive : mouse.hoverBg(row.key)}
      >
        <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().border}>
          {row.last ? "└─ " : "├─ "}
        </text>
        <text
          selectable={!props.mouseEnabled}
          flexShrink={0}
          wrapMode="none"
          fg={cursored(row.key) ? t().accent : t().foregroundMuted}
        >
          {row.open ? "▾ " : "▸ "}
        </text>
        <ScrollingLabel
          selectable={!props.mouseEnabled}
          text={`PR #${pr.number} ${pr.title}`}
          tail={[
            ` · ${pr.headRef} → ${pr.baseRef}`,
            pr.author ? ` · @${pr.author}` : "",
            pr.draft ? " · draft" : "",
          ].join("")}
          tailFg={t().foregroundMuted}
          active={cursored(row.key)}
          fg={fg()}
          grow={false}
        />
        <box flexGrow={1} />
        <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
          {pr.updatedAt ? `  ${formatRelativeDate(pr.updatedAt)}` : ""}
        </text>
      </box>
    );
  };

  return (
    <box flexDirection="column" width="100%">
      <ProviderActionRow
        label="Reload commit"
        status={props.loading ? BUSY.fetchingRuns : ""}
        disabled={!reloadEnabled()}
        cursored={cursored(RELOAD)}
        mouseEnabled={props.mouseEnabled}
        rows={mouse}
        rowKey={RELOAD}
        index={() => indexOf(RELOAD)}
        rowRef={tree.ref(RELOAD)}
      />
      <ProviderSummaryRow label="total pull requests" count={pulls().length} />
      <For each={rows()}>
        {row => (
          <Switch>
            <Match when={row.kind === "pull" && row}>{pull => renderPull(pull())}</Match>
            <Match when={row.kind === "note" && row}>
              {note => (
                <text selectable={!props.mouseEnabled} wrapMode="none" fg={t().foregroundMuted}>
                  <span style={{ fg: t().border }}>{`${note().lead}└─ `}</span>
                  {note().text}
                </text>
              )}
            </Match>
            <Match when={row.kind === "file" && row}>
              {file => {
                const widths = () => statWidths(file().loaded.files);
                return (
                  <FileTreeEntry
                    row={file().row}
                    cursored={cursored(file().key)}
                    collapsed={file().collapsed}
                    highlightBg={cursored(file().key) ? t().backgroundElementActive : undefined}
                    scrolledName={null}
                    addColWidth={widths().add}
                    delColWidth={widths().del}
                    mouseEnabled={props.mouseEnabled}
                    itemIndex={indexOf(file().key)}
                    onActivate={index => {
                      props.onMouseFocus?.();
                      props.setDetailCursorIndex(index);
                      activate();
                    }}
                    ref={tree.ref(file().key)}
                  />
                );
              }}
            </Match>
          </Switch>
        )}
      </For>
    </box>
  );
}
