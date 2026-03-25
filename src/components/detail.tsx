import { Show, For, createSignal, createEffect, createMemo, untrack } from "solid-js";
import { useAppState } from "../context/state";
import { useTheme } from "../context/theme";
import { getColorForColumn } from "../git/graph";
import type { Commit, FileChange } from "../git/types";

/** Types for interactive items in the detail panel */
type InteractiveItem =
  | { type: "section-header"; section: "children" | "parents" | "files" }
  | { type: "child"; hash: string; index: number }
  | { type: "parent"; hash: string; index: number }
  | { type: "file-dir"; dirPath: string; index: number }
  | { type: "file"; filePath: string; index: number };

/** Tree node for building the file tree structure */
interface FileTreeNode {
  name: string;          // segment name (directory name or file basename)
  fullPath: string;      // full path for identification
  file?: FileChange;     // present only for file nodes (leaves)
  children: FileTreeNode[];
}

/** A flattened row from the file tree, ready for rendering */
interface FileTreeRow {
  prefix: string;        // connector prefix chars (│, spaces from ancestors)
  connector: string;     // this row's connector (├── or └──)
  name: string;          // display name
  isDir: boolean;        // true = directory, false = file
  dirPath: string;       // for dirs: the full path; for files: parent dir path
  file?: FileChange;     // present only for file rows
  depth: number;         // nesting depth (0 = root children)
}

/** Colored badge for branch/tag labels in the detail view */
function DetailBadge(props: Readonly<{
  name: string;
  colorIndex: number;
  dimmed?: boolean;
}>) {
  const { theme } = useTheme();
  const t = () => theme();

  const bgColor = () => {
    if (props.dimmed) return t().backgroundElement;
    return getColorForColumn(props.colorIndex, t().graphColors);
  };

  const fgColor = () => {
    if (props.dimmed) return t().foregroundMuted;
    return t().background;
  };

  return (
    <text bg={bgColor()} fg={fgColor()} wrapMode="none">
      {` ${props.name} `}
    </text>
  );
}

export interface DetailViewProps {
  onJumpToCommit?: (hash: string, from: "child" | "parent") => void;
  /** Mutable ref object populated by the detail view with navigation callbacks */
  navRef?: DetailNavRef;
}

/** Mutable ref populated by CommitDetailView for app.tsx to call */
export interface DetailNavRef {
  /** Number of interactive items currently visible */
  itemCount: number;
  /** Activate the item at the current cursor index. Returns true if it was a jump-to-commit action. */
  activateCurrentItem: () => boolean;
  /** Direction of the last jump: "child" means we selected a child entry, "parent" means we selected a parent entry */
  lastJumpFrom: "child" | "parent" | null;
}

export default function CommitDetailView(props: Readonly<DetailViewProps>) {
  const { state, actions } = useAppState();
  const { theme } = useTheme();
  const t = () => theme();

  const commit = () => state.selectedCommit();
  const detail = () => state.commitDetail();
  const row = () => state.selectedRow();

  // Hash → Commit lookup for tag fallback on parent/child badges
  const commitMap = createMemo(() => {
    const map = new Map<string, Commit>();
    for (const r of state.graphRows()) {
      map.set(r.commit.hash, r.commit);
    }
    return map;
  });

  /** Get the first tag name for a commit hash, or null if none */
  const getTagForHash = (hash: string): string | null => {
    const c = commitMap().get(hash);
    if (!c) return null;
    const tag = c.refs.find((r) => r.type === "tag");
    return tag?.name ?? null;
  };

  // Collapsible section state — reset to expanded when commit changes
  const [childrenExpanded, setChildrenExpanded] = createSignal(true);
  const [parentsExpanded, setParentsExpanded] = createSignal(true);
  const [filesExpanded, setFilesExpanded] = createSignal(true);

  createEffect(() => {
    // Reset collapse state when selected commit changes
    commit();
    row();
    setChildrenExpanded(true);
    setParentsExpanded(true);
    setFilesExpanded(true);
  });

  // ── Build flat list of interactive items ──
  const interactiveItems = createMemo((): InteractiveItem[] => {
    const r = row();
    const c = commit();
    if (!r || !c) return [];

    const items: InteractiveItem[] = [];

    // Children section (only if children exist)
    if (r.children.length > 0) {
      items.push({ type: "section-header", section: "children" });
      if (childrenExpanded()) {
        for (let i = 0; i < r.children.length; i++) {
          items.push({ type: "child", hash: r.children[i], index: i });
        }
      }
    }

    // Parents section (only if parents exist)
    if (r.parentHashes.length > 0) {
      items.push({ type: "section-header", section: "parents" });
      if (parentsExpanded()) {
        for (let i = 0; i < r.parentHashes.length; i++) {
          items.push({ type: "parent", hash: r.parentHashes[i], index: i });
        }
      }
    }

    // Files section (only if files exist)
    const d = detail();
    if (d && d.files.length > 0) {
      items.push({ type: "section-header", section: "files" });
      if (filesExpanded()) {
        const rows = fileTreeRows();
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (row.isDir) {
            items.push({ type: "file-dir", dirPath: row.dirPath, index: i });
          } else {
            items.push({ type: "file", filePath: row.file!.path, index: i });
          }
        }
      }
    }

    return items;
  });

  // Clamp cursor when interactive items change, and position cursor after jump
  createEffect(() => {
    const items = interactiveItems();
    const count = items.length;

    // If we navigated from another commit, position cursor based on jump direction.
    // Read origin without tracking so this effect only fires when interactiveItems changes
    // (not when originHash is set before the commit has changed).
    const origin = untrack(() => state.detailOriginHash());
    if (origin && count > 0 && props.navRef) {
      const direction = props.navRef.lastJumpFrom;
      actions.setDetailOriginHash(null);
      props.navRef.lastJumpFrom = null;

      // When jumping from a parent entry → continue walking parents (first parent)
      // When jumping from a child entry → continue walking children (first child)
      const targetType = direction === "parent" ? "parent" : "child";
      for (let i = 0; i < items.length; i++) {
        if (items[i].type === targetType) {
          actions.setDetailCursorIndex(i);
          return;
        }
      }
      // Fallback: try the other type
      const fallbackType = targetType === "parent" ? "child" : "parent";
      for (let i = 0; i < items.length; i++) {
        if (items[i].type === fallbackType) {
          actions.setDetailCursorIndex(i);
          return;
        }
      }
      // No entries — fall back to first item
      actions.setDetailCursorIndex(0);
      return;
    }

    // Normal clamping: keep cursor in bounds when items change (e.g., section collapse)
    const cursor = state.detailCursorIndex();
    if (count === 0) {
      actions.setDetailCursorIndex(0);
    } else if (cursor >= count) {
      actions.setDetailCursorIndex(count - 1);
    }
  });

  /** Execute the action for the currently-cursor'd item */
  const activateItem = (item: InteractiveItem) => {
    switch (item.type) {
      case "section-header":
        if (item.section === "children") setChildrenExpanded(!childrenExpanded());
        else if (item.section === "parents") setParentsExpanded(!parentsExpanded());
        else if (item.section === "files") setFilesExpanded(!filesExpanded());
        break;
      case "child":
      case "parent":
        if (props.onJumpToCommit) props.onJumpToCommit(item.hash, item.type);
        break;
      case "file-dir":
        toggleDir(item.dirPath);
        break;
      case "file":
        // No action for files — just highlight
        break;
    }
  };

  /** Activate the item at the current cursor index. Returns true if it was a jump. */
  const activateCurrentItem = (): boolean => {
    const items = interactiveItems();
    const idx = state.detailCursorIndex();
    if (idx >= 0 && idx < items.length) {
      const item = items[idx];
      activateItem(item);
      return item.type === "child" || item.type === "parent";
    }
    return false;
  };

  // Keep navRef updated whenever interactive items change
  createEffect(() => {
    if (props.navRef) {
      props.navRef.itemCount = interactiveItems().length;
      props.navRef.activateCurrentItem = activateCurrentItem;
    }
  });

  // Split refs into branches (branch/remote/head) and tags
  const branchRefs = () => {
    const c = commit();
    if (!c) return [];
    return c.refs.filter((r) => r.type !== "tag");
  };

  const tagRefs = () => {
    const c = commit();
    if (!c) return [];
    return c.refs.filter((r) => r.type === "tag");
  };

  // The node color index for this commit's lane
  const nodeColorIndex = () => row()?.nodeColor ?? 0;

  // For non-tip commits: find the remote counterpart of branchName
  const remoteName = () => {
    const bn = row()?.branchName;
    if (!bn) return null;
    const remote = state.branches().find(
      (b) => b.isRemote && b.name.endsWith("/" + bn)
    );
    return remote?.name ?? null;
  };

  // Whether to show committer info (only when different from author)
  const showCommitter = () => {
    const c = commit();
    if (!c) return false;
    return c.committer !== c.author || c.committerEmail !== c.authorEmail;
  };

  // Column widths for file changes — derived from totals (always >= per-file values)
  const fileWidths = createMemo(() => {
    const d = detail();
    if (!d) return { totalAdd: 0, totalDel: 0, addColWidth: 2, delColWidth: 2 };
    const totalAdd = d.files.reduce((sum, f) => sum + f.additions, 0);
    const totalDel = d.files.reduce((sum, f) => sum + f.deletions, 0);
    return {
      totalAdd,
      totalDel,
      addColWidth: ("+" + totalAdd).length,
      delColWidth: ("-" + totalDel).length,
    };
  });

  // Build file tree from flat file paths
  const fileTree = createMemo((): FileTreeNode => {
    const d = detail();
    const root: FileTreeNode = { name: "/", fullPath: "/", children: [] };
    if (!d) return root;

    for (const file of d.files) {
      const parts = file.path.split("/");
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;
        const fullPath = parts.slice(0, i + 1).join("/") + (isFile ? "" : "/");
        if (isFile) {
          node.children.push({ name: part, fullPath: file.path, file, children: [] });
        } else {
          let child = node.children.find((c) => !c.file && c.name === part);
          if (!child) {
            child = { name: part, fullPath, children: [] };
            node.children.push(child);
          }
          node = child;
        }
      }
    }

    // Sort: directories first (alphabetical), then files (alphabetical)
    const sortNode = (n: FileTreeNode) => {
      n.children.sort((a, b) => {
        const aIsDir = !a.file;
        const bIsDir = !b.file;
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const child of n.children) {
        if (!child.file) sortNode(child);
      }
    };
    sortNode(root);

    // Compact single-child directory chains (e.g. src/ → components/ → dialogs/ becomes src/components/dialogs/)
    const compact = (n: FileTreeNode) => {
      for (let i = 0; i < n.children.length; i++) {
        const child = n.children[i];
        if (child.file) continue;
        while (child.children.length === 1 && !child.children[0].file) {
          const grandchild = child.children[0];
          child.name = child.name + "/" + grandchild.name;
          child.fullPath = grandchild.fullPath;
          child.children = grandchild.children;
        }
        compact(child);
      }
    };
    compact(root);

    return root;
  });

  // Collapsed directory paths (tracked by fullPath)
  const [collapsedDirs, setCollapsedDirs] = createSignal(new Set<string>());

  // Reset collapsed dirs when commit changes
  createEffect(() => {
    commit();
    setCollapsedDirs(new Set<string>());
  });

  /** Toggle a directory's collapsed state */
  const toggleDir = (dirPath: string) => {
    const next = new Set(collapsedDirs());
    if (next.has(dirPath)) next.delete(dirPath);
    else next.add(dirPath);
    setCollapsedDirs(next);
  };

  // Flatten tree into renderable rows with connector prefixes
  const fileTreeRows = createMemo((): FileTreeRow[] => {
    const rows: FileTreeRow[] = [];
    const collapsed = collapsedDirs();

    const walk = (node: FileTreeNode, prefix: string, depth: number) => {
      const visibleChildren = node.children;
      for (let i = 0; i < visibleChildren.length; i++) {
        const child = visibleChildren[i];
        const isLast = i === visibleChildren.length - 1;
        const connector = isLast ? "└─ " : "├─ ";
        const isDir = !child.file;

        rows.push({
          prefix,
          connector,
          name: isDir ? child.name + "/" : child.name,
          isDir,
          dirPath: isDir ? child.fullPath : node.fullPath,
          file: child.file,
          depth,
        });

        if (isDir && !collapsed.has(child.fullPath)) {
          const childPrefix = prefix + (isLast ? "   " : "│  ");
          walk(child, childPrefix, depth + 1);
        }
      }
    };

    walk(fileTree(), "", 0);
    return rows;
  });

  // Highlight color for the cursor'd interactive item
  const highlightBgFocused = () => t().backgroundElementActive;

  /** Check if a given interactive item index should be highlighted, and return its bg color */
  const itemHighlightBg = (itemIndex: number): string | undefined => {
    if (state.detailFocused() && state.detailCursorIndex() === itemIndex) {
      return highlightBgFocused();
    }
    return undefined;
  };

  /** Check if item is the focused cursor (for accent text color) */
  const isCursored = (itemIndex: number) =>
    state.detailFocused() && state.detailCursorIndex() === itemIndex;

  /** Find the interactive item index for a given item */
  const findItemIndex = (type: InteractiveItem["type"], section?: string, idx?: number): number => {
    const items = interactiveItems();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type === type) {
        if (type === "section-header" && item.type === "section-header" && item.section === section) return i;
        if ((type === "child" || type === "parent") && (item.type === "child" || item.type === "parent") && item.index === idx) return i;
        if ((type === "file-dir" || type === "file") && (item.type === "file-dir" || item.type === "file") && item.index === idx) return i;
      }
    }
    return -1;
  };

  // Track interactive item indices for each rendered section/entry
  // These are derived from the interactiveItems memo

  /** Render a collapsible section header with interactive highlight */
  function InteractiveSectionHeader(headerProps: Readonly<{
    title: string;
    count: number;
    expanded: boolean;
    section: "children" | "parents" | "files";
  }>) {
    const itemIdx = () => findItemIndex("section-header", headerProps.section);

    return (
      <box
        backgroundColor={itemHighlightBg(itemIdx())}
      >
        <text fg={t().accent} wrapMode="none">
          <strong>{headerProps.expanded ? "▾" : "▸"} {headerProps.title} ({headerProps.count})</strong>
        </text>
      </box>
    );
  }

  /** Render a child/parent entry row with interactive highlight */
  function InteractiveCommitEntry(entryProps: Readonly<{
    hash: string;
    entryIndex: number;
    type: "child" | "parent";
    branchName: string;
    colorIndex: number;
  }>) {
    const itemIdx = () => findItemIndex(entryProps.type, undefined, entryProps.entryIndex);
    const cursored = () => isCursored(itemIdx());

    const tag = () => getTagForHash(entryProps.hash);

    return (
      <box
        flexDirection="row"
        flexWrap="wrap"
        gap={1}
        paddingLeft={2}
        backgroundColor={itemHighlightBg(itemIdx())}
      >
        <text fg={cursored() ? t().accent : t().foreground} wrapMode="none">
          {entryProps.hash.substring(0, 7)}
        </text>
        <Show
          when={entryProps.branchName !== ""}
          fallback={
            <Show
              when={tag()}
              fallback={
                <DetailBadge
                  name="deleted"
                  colorIndex={0}
                  dimmed
                />
              }
            >
              <DetailBadge
                name={tag()!}
                colorIndex={entryProps.colorIndex}
              />
            </Show>
          }
        >
          <DetailBadge
            name={entryProps.branchName}
            colorIndex={entryProps.colorIndex}
          />
        </Show>
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <Show
        when={commit()}
        fallback={
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={t().foregroundMuted}>No commit selected</text>
          </box>
        }
      >
        {(c) => (
          <>
            {/* ── Branch ── */}
            <text fg={t().accent} wrapMode="none">
              <strong>Branch</strong>
            </text>
            <box flexDirection="row" flexWrap="wrap" gap={1}>
              <Show
                when={branchRefs().length > 0}
                fallback={
                  <Show
                    when={(row()?.branchName ?? "") !== ""}
                    fallback={
                      (() => {
                        const tag = getTagForHash(c().hash);
                        return tag ? (
                          <DetailBadge
                            name={tag}
                            colorIndex={nodeColorIndex()}
                          />
                        ) : (
                          <DetailBadge
                            name="deleted"
                            colorIndex={0}
                            dimmed
                          />
                        );
                      })()
                    }
                  >
                    <DetailBadge
                      name={row()!.branchName}
                      colorIndex={nodeColorIndex()}
                    />
                    <Show when={remoteName()}>
                      <DetailBadge
                        name={remoteName()!}
                        colorIndex={nodeColorIndex()}
                      />
                    </Show>
                  </Show>
                }
              >
                <For each={branchRefs()}>
                  {(ref) => (
                    <DetailBadge
                      name={ref.name}
                      colorIndex={nodeColorIndex()}
                    />
                  )}
                </For>
              </Show>
            </box>
            <box height={1} />

            {/* ── Tags ── */}
            <Show when={tagRefs().length > 0}>
              <text fg={t().accent} wrapMode="none">
                <strong>Tags</strong>
              </text>
              <box flexDirection="row" flexWrap="wrap" gap={1}>
                <For each={tagRefs()}>
                  {(ref) => (
                    <DetailBadge
                      name={ref.name}
                      colorIndex={nodeColorIndex()}
                    />
                  )}
                </For>
              </box>
              <box height={1} />
            </Show>

            {/* ── Metadata block (subheaders with values below) ── */}
            <text fg={t().accent} wrapMode="none">
              <strong>Commit</strong>
            </text>
            <text fg={t().foreground} wrapMode="none" truncate>
              {c().hash}
            </text>

            <box height={1} />
            <text fg={t().accent} wrapMode="none">
              <strong>Author</strong>
            </text>
            <text fg={t().foreground} wrapMode="none" truncate>
              {c().author} {"<"}{c().authorEmail}{">"}
            </text>

            <box height={1} />
            <text fg={t().accent} wrapMode="none">
              <strong>Date</strong>
            </text>
            <text fg={t().foreground} wrapMode="none">
              {formatDate(c().authorDate)}
            </text>

            <Show when={showCommitter()}>
              <box height={1} />
              <text fg={t().accent} wrapMode="none">
                <strong>Committer</strong>
              </text>
              <text fg={t().foreground} wrapMode="none" truncate>
                {c().committer} {"<"}{c().committerEmail}{">"}
              </text>

              <box height={1} />
              <text fg={t().accent} wrapMode="none">
                <strong>Commit Date</strong>
              </text>
              <text fg={t().foreground} wrapMode="none">
                {formatDate(c().commitDate)}
              </text>
            </Show>

            <box height={1} />

            {/* ── Message (subject + body) ── */}
            <text fg={t().accent} wrapMode="none">
              <strong>Message</strong>
            </text>
            <text fg={t().foreground} wrapMode="word">
              {c().subject}
            </text>

            <Show when={detail()?.body}>
              <box height={1} />
              <text fg={t().foregroundMuted} wrapMode="word">
                {detail()!.body}
              </text>
            </Show>

            <box height={1} />

            {/* ── Children (collapsible) ── */}
            <Show when={row()!.children.length > 0}>
              <InteractiveSectionHeader
                title="Children"
                count={row()!.children.length}
                expanded={childrenExpanded()}
                section="children"
              />
              <Show when={childrenExpanded()}>
                <For each={row()!.children}>
                  {(childHash, i) => (
                    <InteractiveCommitEntry
                      hash={childHash}
                      entryIndex={i()}
                      type="child"
                      branchName={row()!.childBranches[i()]}
                      colorIndex={row()!.childColors[i()]}
                    />
                  )}
                </For>
              </Show>
              <box height={1} />
            </Show>

            {/* ── Parents (collapsible) ── */}
            <Show when={row()!.parentHashes.length > 0}>
              <InteractiveSectionHeader
                title="Parents"
                count={row()!.parentHashes.length}
                expanded={parentsExpanded()}
                section="parents"
              />
              <Show when={parentsExpanded()}>
                <For each={row()!.parentHashes}>
                  {(parentHash, i) => (
                    <InteractiveCommitEntry
                      hash={parentHash}
                      entryIndex={i()}
                      type="parent"
                      branchName={row()!.parentBranches[i()]}
                      colorIndex={row()!.parentColors[i()]}
                    />
                  )}
                </For>
              </Show>
              <box height={1} />
            </Show>

            {/* ── Modified files (collapsible) ── */}
            <Show when={detail() && detail()!.files.length > 0}>
              <InteractiveSectionHeader
                title="Modified Files"
                count={detail()!.files.length}
                expanded={filesExpanded()}
                section="files"
              />
              <Show when={filesExpanded()}>
                <box flexDirection="row" paddingLeft={2}>
                  <box flexGrow={1}>
                    <text fg={t().foregroundMuted} wrapMode="none">
                      total lines changed
                    </text>
                  </box>
                  <box flexShrink={0} paddingLeft={2}>
                    <text fg={t().diffAdded} wrapMode="none">
                      +{fileWidths().totalAdd}
                    </text>
                  </box>
                  <box flexShrink={0} paddingLeft={1}>
                    <text fg={t().diffRemoved} wrapMode="none">
                      -{fileWidths().totalDel}
                    </text>
                  </box>
                </box>
                <box height={1} />
                <For each={fileTreeRows()}>
                  {(treeRow, i) => {
                    const itemIdx = () => findItemIndex(treeRow.isDir ? "file-dir" : "file", undefined, i());
                    const cursored = () => isCursored(itemIdx());
                    const collapsed = () => treeRow.isDir && collapsedDirs().has(treeRow.dirPath);

                    return (
                      <box
                        flexDirection="row"
                        width="100%"
                        paddingLeft={2}
                        backgroundColor={itemHighlightBg(itemIdx())}
                      >
                        <box flexShrink={0}>
                          <text fg={t().foregroundMuted} wrapMode="none">
                            {treeRow.prefix}{treeRow.connector}
                          </text>
                        </box>
                        <Show when={treeRow.isDir}>
                          <box flexShrink={0}>
                            <text fg={cursored() ? t().accent : t().foregroundMuted} wrapMode="none">
                              {collapsed() ? "▸ " : "▾ "}
                            </text>
                          </box>
                        </Show>
                        <box flexGrow={1}>
                          <text
                            fg={treeRow.isDir
                              ? (cursored() ? t().accent : t().foregroundMuted)
                              : (cursored() ? t().accent : t().foreground)}
                            wrapMode="none"
                            truncate
                          >
                            {treeRow.name}
                          </text>
                        </box>
                        <Show when={treeRow.file}>
                          <box flexShrink={0} paddingLeft={2}>
                            <text fg={t().diffAdded} wrapMode="none">
                              {("+" + treeRow.file!.additions).padStart(fileWidths().addColWidth)}
                            </text>
                          </box>
                          <box flexShrink={0} paddingLeft={1}>
                            <text fg={t().diffRemoved} wrapMode="none">
                              {("-" + treeRow.file!.deletions).padStart(fileWidths().delColWidth)}
                            </text>
                          </box>
                        </Show>
                      </box>
                    );
                  }}
                </For>
              </Show>
            </Show>

            {/* Loading indicator for detail */}
            <Show when={!detail() && commit()}>
              <box height={1} />
              <text fg={t().foregroundMuted}>Loading commit details...</text>
            </Show>
          </>
        )}
      </Show>
    </box>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
