import { join, resolve } from "node:path";
import { MouseButton, type Renderable, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import packageJson from "../../package.json";
import { getKnownRepoInfos } from "../config";
import { useClipboard } from "../hooks/use-clipboard";
import { useT } from "../hooks/use-t";
import type { KeyboardScope } from "../keyboard/scope";
import {
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
import { scrollIndexedItemIntoView } from "../utils/scroll";
import { KeyHint, KeyHintSeparator } from "./key-hint";
import LogoBanner, { LOGO_HEIGHT, LOGO_WIDTH } from "./logo-banner";

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
  | { kind: "reset-all"; count: number }
  | { kind: "evict"; label: string; repo: CacheRepositorySummary };

const graphDate = (timestamp: number) => formatGraphDate(new Date(timestamp).toISOString());
const cleanupDate = (timestamp: number) => (timestamp <= Date.now() ? "Due now" : graphDate(timestamp));
const selectable = (row: CacheRow) => row.kind === "file" || row.kind === "repo";

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
  const confirmationText = () => {
    const action = confirmation();
    if (!action) return "";
    return action.kind === "reset-all"
      ? `Reset timers for ${action.count} repositories?`
      : `Evict only ${action.label} (all providers)?\n${action.repo.repoPath}`;
  };
  const showLogo = () => dimensions().height >= 26;
  const cardWidth = () => Math.max(1, Math.min(LOGO_WIDTH, dimensions().width - 2));
  const messageHeight = (message: string, limit = 3) =>
    message
      ? Math.min(
          limit,
          message
            .split("\n")
            .reduce((height, line) => height + Math.ceil(line.length / Math.max(1, cardWidth() - 3)), 0),
        )
      : 0;
  const availableCardHeight = () => Math.max(1, dimensions().height - (showLogo() ? LOGO_HEIGHT + 2 : 0) - 2);
  const confirmationHeight = () => messageHeight(confirmationText(), Math.max(1, availableCardHeight() - 4));
  const cardHeight = () =>
    Math.min(
      rows().length + 3 + confirmationHeight() + messageHeight(error()) + messageHeight(result()),
      availableCardHeight(),
    );

  const refresh = () => {
    const key = selected()?.id;
    const position = selectableIndexes().indexOf(cursor());
    try {
      setSummary(getProviderCacheSummary(props.cacheRoot));
      setError("");
    } catch (cause) {
      setSummary(null);
      setError(`Cache error: ${cause instanceof Error ? cause.message : String(cause)}`);
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
  const resetRepository = () => {
    const row = selected();
    if (blocked() || row?.kind !== "repo") return;
    setResult("");
    setError("");
    try {
      resetRepositoryCacheTimer(row.repo.repoHash, props.cacheRoot);
      refresh();
    } catch (cause) {
      setError(`Reset failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
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
      if (action.kind === "evict") {
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
      setError(
        `${action.kind === "evict" ? "Eviction" : "Action"} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
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
        if (event.shift) requestResetAll();
        else resetRepository();
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
              <For each={rows()}>
                {(row, index) => (
                  // biome-ignore lint/a11y/noStaticElementInteractions: TUI rows support keyboard navigation and Enter.
                  // biome-ignore lint/a11y/useKeyWithMouseEvents: Keyboard invokes the same actions.
                  <box
                    id={row.id}
                    ref={(el: Renderable) => {
                      rowRefs[index()] = el;
                    }}
                    width="100%"
                    height={1}
                    flexShrink={0}
                    flexDirection="row"
                    backgroundColor={
                      selectable(row) && (cursor() === index() || hovered() === row.id)
                        ? t().backgroundElement
                        : undefined
                    }
                    onMouseOver={() => {
                      if (!blocked() && selectable(row)) setHovered(row.id);
                    }}
                    onMouseOut={() => setHovered(null)}
                    onMouseDown={event => {
                      if (event.button !== MouseButton.LEFT || blocked() || !selectable(row)) return;
                      if (row.kind !== "file") event.preventDefault();
                      event.stopPropagation();
                      setCursor(index());
                    }}
                  >
                    <Show
                      when={row.kind === "file" ? row : undefined}
                      fallback={
                        <Show
                          when={row.kind === "repo" ? row : undefined}
                          fallback={
                            <text selectable={false} width="100%" wrapMode="none" truncate fg={t().foregroundMuted}>
                              <strong>{row.kind === "header" ? row.label : ""}</strong>
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
                                fg={cursor() === index() ? t().accent : t().foreground}
                              >
                                {repoRow().label}
                                {props.currentRepo === repoRow().repo.repoPath ? " (current)" : ""}
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
                            fg={cursor() === index() ? t().accent : t().foreground}
                          >
                            {file().name}
                          </text>
                          {/* biome-ignore lint/a11y/noStaticElementInteractions: Enter copies the selected file path. */}
                          <text
                            id={`${row.id}-path`}
                            selectable
                            flexGrow={1}
                            minWidth={0}
                            wrapMode="none"
                            truncate
                            fg={t().foregroundMuted}
                            onMouseDown={event => {
                              if (event.button !== MouseButton.LEFT || blocked()) return;
                              event.stopPropagation();
                              setCursor(index());
                              copyToClipboard(file().path, row.id);
                            }}
                          >
                            {file().path}
                          </text>
                          <Show when={copiedId() === row.id}>
                            <text selectable={false} flexShrink={0} fg={t().success}>
                              {" ✓ copied"}
                            </text>
                          </Show>
                        </>
                      )}
                    </Show>
                  </box>
                )}
              </For>
            </box>
          </scrollbox>
          <Show when={confirmation()}>
            <text flexShrink={0} maxHeight={Math.max(1, cardHeight() - 4)} wrapMode="word" fg={t().warning}>
              {confirmationText()}
            </text>
          </Show>
          <Show when={error()}>
            <text flexShrink={0} maxHeight={3} wrapMode="word" fg={t().error}>
              {error()}
            </text>
          </Show>
          <Show when={result()}>
            <text flexShrink={0} maxHeight={3} wrapMode="word" fg={t().success}>
              {result()}
            </text>
          </Show>
          <box flexDirection="row" height={1} flexShrink={0} paddingRight={2}>
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
                        <KeyHint key="r" desc=" reset" onClick={resetRepository} disabled={busy()} />
                        <KeyHintSeparator />
                      </>
                    }
                  >
                    <KeyHint key="enter" desc=" copy" onClick={copySelected} disabled={busy()} />
                    <KeyHintSeparator />
                  </Show>
                  <KeyHint
                    key="shift+r"
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
