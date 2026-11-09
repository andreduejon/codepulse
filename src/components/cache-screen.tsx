import { join, resolve } from "node:path";
import { MouseButton, type Renderable, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, Index, onCleanup, Show } from "solid-js";
import packageJson from "../../package.json";
import { getKnownRepoInfos } from "../config";
import { useClipboard } from "../hooks/use-clipboard";
import { useT } from "../hooks/use-t";
import type { KeyboardScope } from "../keyboard/scope";
import {
  CACHE_INACTIVITY_MS,
  type CacheEvictionResult,
  type CacheRepositorySummary,
  evictRepositoryCache,
  getProviderCacheSummary,
  type ProviderCacheSummary,
  resetAllCacheTimers,
  resetRepositoryCacheTimer,
} from "../providers/shared/cache-management";
import { DEFAULT_PROVIDER_CACHE_ROOT } from "../providers/shared/sha-sqlite-cache";
import { formatGraphDate } from "../utils/date";
import { repoDisplayName } from "../utils/group-repos";
import { duplicateNameDetails } from "../utils/project-selector-rows";
import { scrollIndexedItemIntoView } from "../utils/scroll";
import { KeyHint, KeyHintSeparator } from "./key-hint";
import LogoBanner, { LOGO_HEIGHT, LOGO_WIDTH } from "./logo-banner";
import MessageBox, { type UIMessageKind } from "./message-box";

/** The list shows at most this many rows, like the repository switcher; the rest scrolls. */
const MAX_LIST_ROWS = 16;
const INACTIVITY_DAYS = Math.round(CACHE_INACTIVITY_MS / (24 * 60 * 60 * 1_000));

interface CacheScreenProps {
  onClose: () => void;
  onEvict?: (repo: CacheRepositorySummary) => Promise<CacheEvictionResult>;
  setKeyboardScopeOverride?: (scope: KeyboardScope | null) => void;
  cacheRoot?: string;
  currentRepo?: string;
}

type CacheRepository = CacheRepositorySummary & { bytes: number };
type CacheRow =
  | { kind: "header" | "spacer"; id: string; label: string }
  | { kind: "file"; id: string; name: string; path: string }
  | { kind: "repo"; id: string; label: string; repo: CacheRepository };
type Confirmation =
  | { kind: "reset"; label: string; repo: CacheRepositorySummary }
  | { kind: "reset-all"; count: number }
  | { kind: "evict"; label: string; repo: CacheRepositorySummary };

const graphDate = (timestamp: number) => formatGraphDate(new Date(timestamp).toISOString());
const cleanupDate = (timestamp: number) => (timestamp <= Date.now() ? "Due now" : graphDate(timestamp));
const selectable = (row: CacheRow) => row.kind === "file" || row.kind === "repo";
const asFile = (row: CacheRow) => (row.kind === "file" ? row : undefined);
const asRepo = (row: CacheRow) => (row.kind === "repo" ? row : undefined);
const headerLabel = (row: CacheRow) => (row.kind === "header" ? row.label : "");

export default function CacheScreen(props: Readonly<CacheScreenProps>) {
  const t = useT();
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const knownRepos = getKnownRepoInfos();
  const { copiedId, copyToClipboard } = useClipboard();
  const [summary, setSummary] = createSignal<ProviderCacheSummary | null>(null);
  const [cursor, setCursor] = createSignal(1);
  const [hovered, setHovered] = createSignal<string | null>(null);
  const [error, setError] = createSignal("");
  const [result, setResult] = createSignal("");
  const [confirmation, setConfirmation] = createSignal<Confirmation | null>(null);
  const [busy, setBusy] = createSignal(false);
  let disposed = false;
  let listRef: ScrollBoxRenderable | undefined;
  const rowRefs: Renderable[] = [];
  const name = (repo: CacheRepositorySummary) =>
    repoDisplayName(knownRepos.find(known => known.path === repo.repoPath) ?? { path: repo.repoPath });
  const repositories = createMemo(() => {
    const repos = new Map<string, CacheRepository>();
    for (const group of summary()?.groups ?? []) {
      const repository = repos.get(group.repoHash);
      if (repository) {
        repository.snapshotCount += group.snapshotCount;
        repository.bytes += group.payloadBytes + group.artifactBytes;
        repository.lastAccessed = Math.max(repository.lastAccessed, group.lastAccessed);
        repository.cleanupAt = Math.max(repository.cleanupAt, group.cleanupAt);
      } else
        repos.set(group.repoHash, {
          repoHash: group.repoHash,
          repoPath: group.repoPath,
          snapshotCount: group.snapshotCount,
          bytes: group.payloadBytes + group.artifactBytes,
          lastAccessed: group.lastAccessed,
          cleanupAt: group.cleanupAt,
        });
    }
    return [...repos.values()].sort(
      (a, b) =>
        a.lastAccessed - b.lastAccessed || name(a).localeCompare(name(b)) || a.repoPath.localeCompare(b.repoPath),
    );
  });
  /** Same-named repositories get the path part that tells them apart, like in the repository selector. */
  const nameDetails = createMemo(() =>
    duplicateNameDetails(
      repositories().map(repo => ({ path: repo.repoPath, repo })),
      entry => name(entry.repo),
    ),
  );
  const rows = createMemo(() => {
    const path = summary()?.path ?? join(resolve(props.cacheRoot ?? DEFAULT_PROVIDER_CACHE_ROOT), "cache.sqlite");
    const rows: CacheRow[] = [
      { kind: "header", id: "cache-general", label: "General" },
      { kind: "file", id: "cache-file-cache.sqlite", name: "Cache data", path },
    ];
    const groups = new Map<string, CacheRepository[]>();
    for (const repo of repositories()) {
      const group = knownRepos.find(known => known.path === repo.repoPath)?.group?.trim() || "ungrouped";
      const members = groups.get(group) ?? [];
      members.push(repo);
      groups.set(group, members);
    }
    for (const [group, members] of [...groups].sort(([a], [b]) => {
      if (a === "ungrouped") return 1;
      if (b === "ungrouped") return -1;
      return a.localeCompare(b);
    })) {
      rows.push({ kind: "spacer", id: `cache-spacer-${group}`, label: "" });
      rows.push({ kind: "header", id: `cache-group-${group}`, label: group });
      rows.push(
        ...members.map(repo => ({ kind: "repo" as const, id: `cache-row-${repo.repoHash}`, label: name(repo), repo })),
      );
    }
    if (repositories().length === 0)
      rows.push({
        kind: "header",
        id: "cache-empty",
        label: error() ? "Cache unavailable" : "No cached provider data",
      });
    return rows;
  });
  const selectableIndexes = createMemo(() => rows().flatMap((row, index) => (selectable(row) ? [index] : [])));
  const selected = () => rows()[cursor()];
  const blocked = () => busy() || confirmation() !== null;
  /** One message at a time, above the card like the repository switcher's: a confirmation, an error, or a result. */
  const notice = (): { kind: UIMessageKind; title: string; lines: string[] } | null => {
    const action = confirmation();
    if (action?.kind === "reset") {
      return {
        kind: "warning",
        title: `Reset ${action.label}?`,
        lines: [`Starts a new ${INACTIVITY_DAYS}-day period across all providers.`, "Nothing is deleted."],
      };
    }
    if (action?.kind === "reset-all") {
      const repos = action.count === 1 ? "1 repository starts" : `${action.count} repositories start`;
      return {
        kind: "warning",
        title: "Reset all inactivity timers?",
        lines: [`${repos} a new ${INACTIVITY_DAYS}-day period.`, "Nothing is deleted."],
      };
    }
    if (action?.kind === "evict") {
      return {
        kind: "warning",
        title: `Evict ${action.label}?`,
        lines: ["Deletes its cached data from every provider; other repositories keep theirs.", action.repo.repoPath],
      };
    }
    if (error()) {
      const [title = "", ...lines] = error().split("\n");
      return { kind: "error", title, lines };
    }
    if (result()) return { kind: "info", title: result(), lines: [] };
    return null;
  };
  const showLogo = () => dimensions().height >= 26;
  const cardWidth = () => Math.max(1, Math.min(LOGO_WIDTH, dimensions().width - 2));
  /** Rows the notice takes: its padding, wrapped title and lines, and the gap below it. */
  const noticeHeight = () => {
    const current = notice();
    if (!current) return 0;
    // Text width inside the message box: border, its padding and the 4-column inset on both sides.
    const width = Math.max(1, cardWidth() - 11);
    const wrapped = (text: string) => Math.max(1, Math.ceil(text.length / width));
    return 2 + [current.title, ...current.lines].reduce((height, line) => height + wrapped(line), 0) + 1;
  };
  const availableCardHeight = () =>
    Math.max(1, dimensions().height - (showLogo() ? LOGO_HEIGHT + 2 : 0) - 2 - noticeHeight());
  const cardHeight = () => Math.min(Math.min(rows().length, MAX_LIST_ROWS) + 4, availableCardHeight());

  const refresh = () => {
    const key = selected()?.id;
    const position = selectableIndexes().indexOf(cursor());
    try {
      setSummary(getProviderCacheSummary(props.cacheRoot));
      setError("");
    } catch (cause) {
      setSummary(null);
      setError(`Cache error\n${cause instanceof Error ? cause.message : String(cause)}`);
    }
    const index = rows().findIndex(row => row.id === key);
    const indexes = selectableIndexes();
    setCursor(index >= 0 ? index : indexes[Math.max(0, Math.min(position, indexes.length - 1))]);
    setHovered(null);
  };
  refresh();

  createEffect(() => props.setKeyboardScopeOverride?.("cache"));
  createEffect(() => {
    dimensions();
    rows();
    scrollIndexedItemIntoView(listRef, rowRefs, cursor());
  });
  onCleanup(() => {
    disposed = true;
    props.setKeyboardScopeOverride?.(null);
  });

  const handleEscape = () => {
    if (busy()) return;
    if (confirmation()) setConfirmation(null);
    else props.onClose();
  };
  const move = (delta: number) => {
    if (blocked()) return;
    const indexes = selectableIndexes();
    setCursor(indexes[Math.max(0, Math.min(indexes.length - 1, indexes.indexOf(cursor()) + delta))]);
  };
  const copySelected = () => {
    const row = selected();
    if (!blocked() && row?.kind === "file") copyToClipboard(row.path, row.id);
  };
  const requestReset = () => {
    const row = selected();
    if (blocked() || row?.kind !== "repo") return;
    setResult("");
    setError("");
    setConfirmation({ kind: "reset", label: row.label, repo: { ...row.repo } });
  };
  const requestResetAll = () => {
    if (blocked() || repositories().length === 0) return;
    setError("");
    setResult("");
    setConfirmation({ kind: "reset-all", count: repositories().length });
  };
  const requestEvict = () => {
    const row = selected();
    if (blocked() || row?.kind !== "repo") return;
    setError("");
    setResult("");
    setConfirmation({ kind: "evict", label: row.label, repo: { ...row.repo } });
  };
  const confirm = async () => {
    const action = confirmation();
    if (!action || busy()) return;
    setBusy(true);
    setResult("");
    setError("");
    try {
      if (action.kind === "reset") {
        resetRepositoryCacheTimer(action.repo.repoHash, props.cacheRoot);
        refresh();
      } else if (action.kind === "evict") {
        const counts = props.onEvict
          ? await props.onEvict(action.repo)
          : evictRepositoryCache(action.repo.repoHash, props.cacheRoot);
        if (disposed) return;
        refresh();
        setResult(`Evicted ${counts.snapshotCount} snapshots and ${counts.artifactCount} artifacts.`);
      } else {
        resetAllCacheTimers(props.cacheRoot);
        refresh();
      }
    } catch (cause) {
      if (disposed) return;
      const failed = action.kind === "evict" ? "Eviction" : action.kind === "reset" ? "Reset" : "Action";
      setError(`${failed} failed\n${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      if (!disposed) {
        setConfirmation(null);
        setBusy(false);
      }
    }
  };

  useKeyboard(event => {
    if (event.eventType === "release") return;
    if (event.name === "q") {
      event.preventDefault();
      renderer.destroy();
      return;
    }
    if (blocked()) {
      event.preventDefault();
      if (event.name === "escape") handleEscape();
      else if (event.name === "return") void confirm();
      return;
    }
    switch (event.name) {
      case "escape":
        event.preventDefault();
        handleEscape();
        break;
      case "up":
      case "k":
        event.preventDefault();
        move(event.shift ? -10 : -1);
        break;
      case "down":
      case "j":
        event.preventDefault();
        move(event.shift ? 10 : 1);
        break;
      case "pageup":
        event.preventDefault();
        move(-Math.max(1, listRef?.viewport.height ?? 1));
        break;
      case "pagedown":
        event.preventDefault();
        move(Math.max(1, listRef?.viewport.height ?? 1));
        break;
      case "g":
        event.preventDefault();
        setCursor(event.shift ? (selectableIndexes().at(-1) ?? 1) : 1);
        break;
      case "return":
        event.preventDefault();
        copySelected();
        break;
      case "r":
        event.preventDefault();
        if (!event.shift) requestReset();
        break;
      case "a":
        event.preventDefault();
        requestResetAll();
        break;
      case "e":
        event.preventDefault();
        requestEvict();
        break;
    }
  });

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={t().backgroundPanel}>
      <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center">
        <Show when={showLogo()}>
          <LogoBanner />
          <box height={2} flexShrink={0} />
        </Show>
        <Show when={notice()}>
          {current => (
            <>
              <box width={cardWidth()} flexShrink={0}>
                <MessageBox
                  id="cache-message"
                  kind={current().kind}
                  title={current().title}
                  message={current().lines.join("\n")}
                />
              </box>
              <box height={1} flexShrink={0} />
            </>
          )}
        </Show>
        <box
          id="cache-card"
          width={cardWidth()}
          height={cardHeight()}
          flexShrink={0}
          flexDirection="column"
          backgroundColor={t().background}
          paddingX={1}
          paddingY={1}
          border={["left"]}
          borderStyle="single"
          borderColor={t().accent}
        >
          <scrollbox
            id="cache-list"
            ref={listRef}
            flexGrow={1}
            flexShrink={1}
            minHeight={0}
            scrollY
            scrollX={false}
            verticalScrollbarOptions={{ visible: false }}
          >
            <box flexDirection="column">
              <Index each={rows()}>
                {(row, index) => (
                  // biome-ignore lint/a11y/noStaticElementInteractions: TUI rows support keyboard navigation and Enter.
                  // biome-ignore lint/a11y/useKeyWithMouseEvents: Keyboard invokes the same actions.
                  <box
                    id={row().id}
                    ref={(el: Renderable) => {
                      rowRefs[index] = el;
                    }}
                    width="100%"
                    height={1}
                    flexShrink={0}
                    flexDirection="row"
                    paddingX={4}
                    backgroundColor={
                      selectable(row()) && (cursor() === index || hovered() === row().id)
                        ? t().backgroundElement
                        : undefined
                    }
                    onMouseOver={() => {
                      if (!blocked() && selectable(row())) setHovered(row().id);
                    }}
                    onMouseOut={() => setHovered(null)}
                    onMouseDown={event => {
                      if (event.button !== MouseButton.LEFT || blocked() || !selectable(row())) return;
                      if (row().kind !== "file") event.preventDefault();
                      event.stopPropagation();
                      setCursor(index);
                    }}
                  >
                    <Show
                      when={asFile(row())}
                      fallback={
                        <Show
                          when={asRepo(row())}
                          fallback={
                            <text selectable={false} width="100%" wrapMode="none" truncate fg={t().accent}>
                              <strong>{headerLabel(row())}</strong>
                            </text>
                          }
                        >
                          {repoRow => (
                            <>
                              <text
                                selectable={false}
                                flexGrow={1}
                                flexShrink={1}
                                minWidth={0}
                                wrapMode="none"
                                truncate
                                fg={cursor() === index ? t().accent : t().foreground}
                              >
                                {repoRow().label}
                                {props.currentRepo === repoRow().repo.repoPath ? " (current)" : ""}
                                <Show when={nameDetails().get(repoRow().repo.repoPath)}>
                                  {detail => <span style={{ fg: t().foregroundMuted }}>{` ${detail()}`}</span>}
                                </Show>
                              </text>
                              <text selectable={false} flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
                                {` ${(repoRow().repo.bytes / 1024).toFixed(1)} KB · ${cleanupDate(repoRow().repo.cleanupAt)}`}
                              </text>
                            </>
                          )}
                        </Show>
                      }
                    >
                      {file => (
                        <>
                          <text
                            selectable
                            width={17}
                            flexShrink={0}
                            wrapMode="none"
                            fg={cursor() === index ? t().accent : t().foreground}
                          >
                            {file().name}
                          </text>
                          {/* biome-ignore lint/a11y/noStaticElementInteractions: Enter copies the selected file path. */}
                          <text
                            id={`${row().id}-path`}
                            selectable
                            flexGrow={1}
                            minWidth={0}
                            wrapMode="none"
                            truncate
                            fg={t().foregroundMuted}
                            onMouseDown={event => {
                              if (event.button !== MouseButton.LEFT || blocked()) return;
                              event.stopPropagation();
                              setCursor(index);
                              copyToClipboard(file().path, row().id);
                            }}
                          >
                            {file().path}
                          </text>
                          <Show when={copiedId() === row().id}>
                            <text
                              selectable={false}
                              flexShrink={0}
                              wrapMode="none"
                              bg={t().primary}
                              fg={t().background}
                            >
                              {" ✓ copied "}
                            </text>
                          </Show>
                        </>
                      )}
                    </Show>
                  </box>
                )}
              </Index>
            </box>
          </scrollbox>
          <box height={1} flexShrink={0} />
          <box flexDirection="row" height={1} flexShrink={0} paddingX={4}>
            <box flexGrow={1} />
            <text selectable={false} wrapMode="none" fg={t().foregroundMuted}>
              {`v${packageJson.version}`}
            </text>
          </box>
        </box>
        <box height={1} flexShrink={0} />
        <box width={cardWidth()} flexShrink={0} height={1}>
          <box flexDirection="row" height={1} justifyContent="flex-end">
            <Show
              when={confirmation()}
              fallback={
                <>
                  <Show
                    when={selected()?.kind === "file"}
                    fallback={
                      <>
                        <KeyHint key="r" desc=" reset" onClick={requestReset} disabled={busy()} />
                        <KeyHintSeparator />
                      </>
                    }
                  >
                    <KeyHint key="enter" desc=" copy" onClick={copySelected} disabled={busy()} />
                    <KeyHintSeparator />
                  </Show>
                  <KeyHint
                    key="a"
                    desc=" reset all"
                    onClick={requestResetAll}
                    disabled={busy() || repositories().length === 0}
                  />
                  <Show when={selected()?.kind === "repo"}>
                    <KeyHintSeparator />
                    <KeyHint key="e" desc=" evict" onClick={requestEvict} disabled={busy()} />
                  </Show>
                </>
              }
            >
              <KeyHint key="enter" desc=" confirm" onClick={() => void confirm()} disabled={busy()} />
            </Show>
            <KeyHintSeparator />
            <KeyHint key="esc" desc={confirmation() ? " cancel" : " back"} onClick={handleEscape} disabled={busy()} />
            <KeyHintSeparator />
            <KeyHint key="q" desc=" quit" onClick={() => renderer.destroy()} />
          </box>
        </box>
      </box>
    </box>
  );
}
