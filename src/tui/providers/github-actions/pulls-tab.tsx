/**
 * GitHub's Pull requests tab: the open pull requests whose branch points at the commit (the graph's `PR #123` chips),
 * one row each with its number, title and age. Enter opens one: muted leaves with its branch and the one it would
 * merge into, its author and whether it is a draft, then the files it changed, as GitHub's Files changed shows them (between where its branch left the target's and its head, read by
 * Git); Enter on a file opens its diff. `o` opens the pull request on GitHub. Only a commit that has one has the tab
 * (as Stashes), so it never shows empty.
 *
 * Receives props directly (not via useContext): it may render during setup, before the AppStateContext.Provider
 * mounts (AGENTS.md rule 5).
 */

import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Switch, untrack } from "solid-js";
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
import { pullMark } from "./legend";

/** A pull request's files: where its branch left the target's, and what it changed since. */
export interface PullFiles {
  mergeBase: string;
  files: FileChange[];
}

export interface PullRequestsTabProps {
  sha: string;
  pullRequestsAt: (sha: string) => GitHubPullRequest[];
  /** The ones merged or closed recently whose branch pointed at it: muted rows after the open ones, no files. */
  closedPullRequestsAt?: (sha: string) => GitHubPullRequest[];
  /** The Dashboard's pull request (its number): its row marked in `targetColor`, an open one's with the cursor. */
  target?: string;
  targetColor?: string;
  /**
   * Its files from Git; null when Git hasn't both its commits even after fetching them. `onFetch` says it fetches
   * them first.
   */
  loadFiles?: (pr: GitHubPullRequest, onFetch: () => void) => Promise<PullFiles | null>;
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

/** A pull request's files read: their stat columns' widths too, measured once (not per row). */
type ReadyFiles = PullFiles & { state: "ready"; widths: { add: number; del: number } };
type Loaded = { state: "loading" } | { state: "fetching" } | { state: "missing" } | ReadyFiles;

/** The stat columns' widths: as wide as the widest count of the pull request's files. */
const statWidths = (files: readonly FileChange[]) => ({
  add: Math.max(2, ...files.map(file => `+${file.additions}`.length)),
  del: Math.max(2, ...files.map(file => `-${file.deletions}`.length)),
});

type Row =
  | { kind: "pull"; key: string; pr: GitHubPullRequest; last: boolean; open: boolean }
  | { kind: "ended"; key: string; pr: GitHubPullRequest; last: boolean }
  | { kind: "note"; key: string; lead: string; text: string; last: boolean }
  | { kind: "file"; key: string; pr: GitHubPullRequest; row: FileTreeRow; loaded: ReadyFiles; collapsed: boolean };

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
  const ended = () => props.closedPullRequestsAt?.(props.sha) ?? [];
  const [loaded, setLoaded] = createSignal<ReadonlyMap<string, Loaded>>(new Map());
  /** The versions being read now (a mutable ref: an effect run during a read must not start another). */
  const reading = new Set<string>();
  /** Versions whose provider data changed while they were read: a late "not there" is read once more. */
  const changedWhileRead = new Set<string>();
  const read = (load: NonNullable<PullRequestsTabProps["loadFiles"]>, pr: GitHubPullRequest, version: string) => {
    reading.add(version);
    void load(pr, () => setLoaded(map => new Map(map).set(version, { state: "fetching" })))
      .catch(() => null)
      .then(files => {
        reading.delete(version);
        if (!files && changedWhileRead.delete(version)) return read(load, pr, version);
        changedWhileRead.delete(version);
        const next: Loaded = files
          ? { state: "ready", ...files, widths: statWidths(files.files) }
          : { state: "missing" };
        setLoaded(map => new Map(map).set(version, next));
      });
  };
  // An opened pull request reads its files once per version (a push or a new target reads them again). One Git hadn't
  // (not fetched) is read again, quietly, with each change of the provider's data: a Reload commit, a refresh.
  createEffect(() => {
    for (const pr of pulls()) {
      const version = versionKey(pr);
      const known = untrack(loaded).get(version);
      if (!open().has(pr.number) || !props.loadFiles) continue;
      if (reading.has(version)) {
        changedWhileRead.add(version);
        continue;
      }
      if (known && known.state !== "missing") continue;
      if (!known) setLoaded(map => new Map(map).set(version, { state: "loading" }));
      read(props.loadFiles, pr, version);
    }
  });

  const rows = createMemo<Row[]>(() => [
    ...pulls().flatMap((pr, index): Row[] => {
      const last = index === pulls().length - 1 && ended().length === 0;
      const isOpen = open().has(pr.number);
      const head: Row = { kind: "pull", key: pullKey(pr), pr, last, open: isOpen };
      if (!isOpen) return [head];
      const lead = last ? "   " : "│  ";
      const files = loaded().get(versionKey(pr));
      const note = (key: string, text: string, isLast: boolean): Row => ({
        kind: "note",
        key: `${head.key}:${key}`,
        lead,
        text,
        last: isLast,
      });
      // What the closed row leaves out, a leaf each (branch names run long): its branch and the one it would merge
      // into, its author, and that it is a draft.
      const facts = [
        `${pr.headRef} → ${pr.baseRef}`,
        ...(pr.author ? [`@${pr.author}`] : []),
        ...(pr.draft ? ["draft"] : []),
      ];
      const info = (more: boolean) =>
        facts.map((text, index) => note(`info:${index}`, text, !more && index === facts.length - 1));
      if (!files || files.state === "loading") return [head, ...info(true), note("note", BUSY.readingFiles, true)];
      if (files.state === "fetching") return [head, ...info(true), note("note", BUSY.fetchingCommits, true)];
      if (files.state === "missing")
        return [head, ...info(true), note("note", "Its commits couldn't be fetched. Reload commit tries again.", true)];
      const dirs = new Set(
        [...collapsed()].flatMap(key => (key.startsWith(`${pr.number}:`) ? [key.slice(`${pr.number}:`.length)] : [])),
      );
      return [
        head,
        ...info(files.files.length > 0),
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
    // Merged or closed: a row each, muted, no files and no cursor stop.
    ...ended().map(
      (pr, index): Row => ({ kind: "ended", key: `ended:${pr.number}`, pr, last: index === ended().length - 1 }),
    ),
  ]);
  const reloadEnabled = () => !props.unavailableReason;
  const keys = createMemo(() => [
    ...(reloadEnabled() ? [RELOAD] : []),
    ...rows().flatMap(row => (row.kind === "note" || row.kind === "ended" ? [] : [row.key])),
  ]);
  const indexes = createMemo(() => new Map(keys().map((key, index) => [key, index])));
  const indexOf = (key: string) => indexes().get(key) ?? -1;
  const cursored = (key: string) => props.detailFocused() && props.detailCursorIndex() === indexOf(key);
  const current = () => {
    const key = keys()[props.detailCursorIndex()];
    return key === RELOAD ? RELOAD : rows().find(row => row.key === key);
  };

  // The Dashboard's open pull request: the tab's focus starts on it, once per commit (kept in the memory).
  const targetFocus = props.memory?.("targetFocus", () => ({ key: null as string | null })) ?? { key: null };
  createEffect(() => {
    const pr = pulls().find(isTarget);
    if (!pr || !props.detailFocused()) return;
    const key = `${props.sha}\u0000${pr.number}`;
    if (targetFocus.key === key) return;
    targetFocus.key = key;
    props.setDetailCursorIndex(indexOf(pullKey(pr)));
    props.navRef?.scrollToCursor?.();
  });

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

  // The graph previews the merge of the pull request the mouse is over or the cursor is on (it or its files), whichever
  // moved last: the mouse stays over a row after a click while the keys move on. None while neither is on one (the
  // cursor on Reload commit, the keyboard in the graph).
  const [byMouse, setByMouse] = createSignal(false);
  createEffect(on(mouse.hovered, () => setByMouse(true), { defer: true }));
  createEffect(on(props.detailCursorIndex, () => setByMouse(false), { defer: true }));
  createEffect(() => {
    const hovered = byMouse() ? pulls().find(pr => mouse.hovered() === pullKey(pr)) : undefined;
    const row = props.detailFocused() ? current() : undefined;
    const pr = hovered ?? (row && row !== RELOAD && row.kind !== "note" ? row.pr : undefined);
    props.onMergePreview?.(pr ? { head: pr.headSha, base: pr.baseSha, baseRef: pr.baseRef } : null);
  });
  onCleanup(() => props.onMergePreview?.(null));

  /** Its age (an open one's last update, an ended one's end) and its mark after it, as a run shows when and how. */
  const when = (pr: GitHubPullRequest) => {
    const at = pr.state === "open" ? pr.updatedAt : (pr.closedAt ?? "");
    const mark = pullMark(pr.state, pr.draft);
    return (
      <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
        {at ? `  ${formatRelativeDate(at)} ` : "  "}
        <span style={{ fg: mark.color(t()) }}>{mark.icon}</span>
      </text>
    );
  };
  /** The Dashboard's pull request: its row in the Dashboard's colour. */
  const isTarget = (pr: GitHubPullRequest) => !!props.target && props.target === String(pr.number);

  const renderEnded = (row: Extract<Row, { kind: "ended" }>) => (
    <box flexDirection="row" width="100%">
      <text selectable={!props.mouseEnabled} flexShrink={0} wrapMode="none" fg={t().border}>
        {row.last ? "└─ " : "├─ "}
      </text>
      <ScrollingLabel
        selectable={!props.mouseEnabled}
        text={`PR #${row.pr.number} ${row.pr.title}`}
        active={false}
        fg={isTarget(row.pr) && props.targetColor ? props.targetColor : t().foregroundMuted}
        grow={false}
      />
      <box flexGrow={1} />
      {when(row.pr)}
    </box>
  );

  const renderPull = (row: Extract<Row, { kind: "pull" }>) => {
    const pr = row.pr;
    // A draft is not ready for review: muted, as its chip in the graph. The Dashboard's: in its colour.
    const fg = () =>
      cursored(row.key)
        ? t().accent
        : isTarget(pr) && props.targetColor
          ? props.targetColor
          : pr.draft
            ? t().foregroundMuted
            : t().foreground;
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
          active={cursored(row.key)}
          fg={fg()}
          grow={false}
        />
        <box flexGrow={1} />
        {when(pr)}
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
      <ProviderSummaryRow label="total pull requests" count={pulls().length + ended().length} />
      <For each={rows()}>
        {row => (
          <Switch>
            <Match when={row.kind === "pull" && row}>{pull => renderPull(pull())}</Match>
            <Match when={row.kind === "ended" && row}>{done => renderEnded(done())}</Match>
            <Match when={row.kind === "note" && row}>
              {note => (
                <text selectable={!props.mouseEnabled} wrapMode="none" fg={t().foregroundMuted}>
                  {/* A leaf of the pull request, like its files: its branch and author, or why its files aren't there. */}
                  <span style={{ fg: t().border }}>{`${note().lead}${note().last ? "└─ " : "├─ "}`}</span>
                  {note().text}
                </text>
              )}
            </Match>
            <Match when={row.kind === "file" && row}>
              {file => {
                return (
                  <FileTreeEntry
                    row={file().row}
                    cursored={cursored(file().key)}
                    collapsed={file().collapsed}
                    highlightBg={cursored(file().key) ? t().backgroundElementActive : undefined}
                    scrolledName={null}
                    addColWidth={file().loaded.widths.add}
                    delColWidth={file().loaded.widths.del}
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
