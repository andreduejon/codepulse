import { expect, mock, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type BoxRenderable,
  type Renderable,
  RGBA,
  type ScrollBoxRenderable,
  type TextRenderable,
} from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import packageJson from "../../package.json";
import * as config from "../config";
import { createThemeState, ThemeContext } from "../context/theme";
import * as clipboard from "../hooks/use-clipboard";
import type { KeyboardScope } from "../keyboard/scope";
import * as management from "../providers/shared/cache-management";
import {
  closeProviderCaches,
  DEFAULT_PROVIDER_CACHE_ROOT,
  providerCacheDatabase,
  repositoryIdentity,
  ShaSqliteCache,
} from "../providers/shared/sha-sqlite-cache";
import { formatGraphDate } from "../utils/date";
import { scrollElementIntoView } from "../utils/scroll";
import CacheScreen from "./cache-screen";
import { LOGO_HEIGHT, LOGO_WIDTH } from "./logo-banner";

const descendants = (node: Renderable): Renderable[] =>
  node.getChildren().flatMap(child => [child, ...descendants(child)]);
const ALPHA = resolve("/repo/cache-alpha");
const BETA = resolve("/repo/cache-beta");
const withoutWhitespace = (value: string) => value.replace(/[\s│]/g, "");

async function fixture(prefix = "codepulse-cache-screen-") {
  const { path: root } = await repositoryIdentity(await mkdtemp(join(tmpdir(), prefix)));
  const seed = async (repoPath: string, provider: string, accessedAt: number, index = 1) => {
    const { hash, path } = await repositoryIdentity(repoPath);
    const store = new ShaSqliteCache<{ sha: string }>({
      root,
      provider,
      isEntry: (value): value is { sha: string } =>
        !!value && typeof value === "object" && "sha" in value && typeof value.sha === "string",
      invalidMessage: "bad test snapshot",
    });
    const sha = index.toString(16).padStart(40, "0");
    await store.write(path, { sha });
    await store.writeLog(path, sha, "job", "offline log");
    const updated = providerCacheDatabase(root)
      .query("UPDATE snapshots SET accessed_at = ? WHERE provider = ? AND repo_hash = ?")
      .run(accessedAt, provider, hash);
    expect(updated.changes).toBeGreaterThan(0);
    return path;
  };
  const contents = () => ({
    snapshots: providerCacheDatabase(root)
      .query<Record<string, string | number>, []>("SELECT * FROM snapshots ORDER BY id")
      .all(),
    artifacts: providerCacheDatabase(root)
      .query("SELECT * FROM artifacts ORDER BY snapshot_id, kind, artifact_key")
      .all(),
  });
  return {
    root,
    seed,
    contents,
    dispose: async () => {
      closeProviderCaches(root);
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function screen(
  root: string | undefined,
  currentRepo = ALPHA,
  onEvict?: (repo: management.CacheRepositorySummary) => Promise<management.CacheEvictionResult>,
) {
  const theme = createThemeState();
  const scopes: (KeyboardScope | null)[] = [];
  const [open, setOpen] = createSignal(true);
  const close = mock(() => setOpen(false));
  const setup = await testRender(
    () => (
      <ThemeContext.Provider value={theme}>
        <Show when={open()}>
          <CacheScreen
            cacheRoot={root}
            onClose={close}
            onEvict={onEvict}
            currentRepo={currentRepo}
            setKeyboardScopeOverride={scope => scopes.push(scope)}
          />
        </Show>
      </ThemeContext.Provider>
    ),
    { width: 90, height: 30, useMouse: true, enableMouseMovement: true, kittyKeyboard: true },
  );
  await setup.flush();
  const frame = () => setup.captureCharFrame();
  const point = (label: string) => {
    const lines = frame().split("\n");
    const y = lines.findIndex(line => line.includes(label));
    expect(y).toBeGreaterThanOrEqual(0);
    return { x: lines[y].indexOf(label) + 1, y };
  };
  const click = async (
    label: string,
    button: typeof MouseButtons.LEFT | typeof MouseButtons.RIGHT = MouseButtons.LEFT,
  ) => {
    const { x, y } = point(label);
    await setup.mockMouse.click(x, y, button);
    await setup.flush();
  };
  const key = async (name: Parameters<typeof setup.mockInput.pressKey>[0], shift = false) => {
    setup.mockInput.pressKey(name, { shift });
    await setup.flush();
  };
  const row = (repoPath: string) => {
    const group = management.getProviderCacheSummary(root).groups.find(group => group.repoPath === repoPath);
    expect(group).toBeDefined();
    const row = descendants(setup.renderer.root).find(node => node.id === `cache-row-${group?.repoHash}`);
    expect(row).toBeDefined();
    return row as BoxRenderable;
  };
  const rowPoint = async (repoPath: string) => {
    const selected = row(repoPath);
    const list = descendants(setup.renderer.root).find(node => node.id === "cache-list") as ScrollBoxRenderable;
    scrollElementIntoView(list, selected, 0);
    await setup.flush();
    return { x: selected.x + 3, y: selected.y };
  };
  const clickRow = async (
    repoPath: string,
    button: typeof MouseButtons.LEFT | typeof MouseButtons.RIGHT = MouseButtons.LEFT,
  ) => {
    const { x, y } = await rowPoint(repoPath);
    await setup.mockMouse.click(x, y, button);
    await setup.flush();
  };
  const cells = async (repoPath: string) => {
    await rowPoint(repoPath);
    return (row(repoPath).getChildren() as TextRenderable[]).map(text => text.plainText.trim());
  };
  const expectSelected = (label: string) => {
    const span = setup.captureSpans().lines[point(label).y].spans.find(span => span.text.includes(label));
    expect(span?.fg).toEqual(RGBA.fromHex(theme.theme().accent));
  };
  return { ...setup, theme, scopes, close, frame, point, click, key, row, rowPoint, clickRow, cells, expectSelected };
}

test("compact app rows aggregate all providers; selected reset reaches every provider and preserves selection", async () => {
  const data = await fixture();
  const now = Date.now();
  await data.seed(ALPHA, "github-actions", now - management.CACHE_INACTIVITY_MS - 5000);
  await data.seed(BETA, "future/provider", now - management.CACHE_INACTIVITY_MS - 4500);
  await data.seed(ALPHA, "jenkins", now - management.CACHE_INACTIVITY_MS - 4000);
  await data.seed(ALPHA, "snyk", now - management.CACHE_INACTIVITY_MS - 3000);
  await data.seed(ALPHA, "openshift", now - management.CACHE_INACTIVITY_MS - 2000);
  const before = management.getProviderCacheSummary(data.root);
  const contents = data.contents();
  const setup = await screen(data.root);
  try {
    expect(setup.scopes).toEqual(["cache"]);
    const fullscreen = setup.renderer.root.getChildren()[0];
    expect({ x: fullscreen.x, y: fullscreen.y, width: fullscreen.width, height: fullscreen.height }).toEqual({
      x: 0,
      y: 0,
      width: 90,
      height: 30,
    });
    const card = descendants(fullscreen).find(node => node.id === "cache-card") as BoxRenderable;
    expect(card.width).toBe(LOGO_WIDTH);
    expect(card.height).toBe(9);
    expect(Math.abs(card.x * 2 + card.width - fullscreen.width)).toBeLessThanOrEqual(1);
    expect(card.border).toEqual(["left"]);
    expect(card.borderColor).toEqual(RGBA.fromHex(setup.theme.theme().accent));
    expect(card.backgroundColor).toEqual(RGBA.fromHex(setup.theme.theme().background));
    expect(card.y).toBeGreaterThanOrEqual(LOGO_HEIGHT + 2);
    expect(setup.frame()).toContain("██████");
    expect(setup.point(`v${packageJson.version}`).y).toBe(card.y + card.height - 2);
    expect(setup.point(`v${packageJson.version}`).x).toBeGreaterThan(card.x + card.width - 12);
    expect(setup.point("esc back").y).toBeGreaterThanOrEqual(card.y + card.height + 1);
    expect(setup.point("cache-beta").y).toBeLessThan(setup.point("cache-alpha (current)").y);
    expect(descendants(fullscreen).filter(node => node.id.startsWith("cache-row-"))).toHaveLength(2);
    const bytes = before.groups
      .filter(group => group.repoPath === ALPHA)
      .reduce((total, group) => total + group.payloadBytes + group.artifactBytes, 0);
    expect(await setup.cells(ALPHA)).toEqual(["cache-alpha (current)", `${(bytes / 1024).toFixed(1)} KB · Due now`]);
    for (const absent of [
      "Global Cache",
      "Provider",
      "Count",
      "Last access",
      "Cleanup eligible",
      "Physical database",
      "Working files",
      "Artifacts",
      "GitHub Actions",
      "Jenkins",
      "future/provider",
      "Repositories",
      "tab",
      "↑",
      "↓",
      ALPHA,
    ])
      expect(setup.frame()).not.toContain(absent);
    expect(descendants(fullscreen).some(node => node.id === "cache-details")).toBe(false);
    expect(setup.frame()).toContain("enter copy");
    await setup.key("r");
    await setup.key("e");
    expect(setup.frame()).not.toContain("enter confirm");
    expect(data.contents()).toEqual(contents);
    await setup.clickRow(BETA);
    expect(setup.frame()).toContain("r reset");
    expect(setup.frame()).not.toContain("reset 90 days");
    expect(setup.frame()).toContain("shift+r reset all");
    expect(setup.frame()).not.toContain("Shift+r");
    expect(setup.frame()).toContain("e evict");
    expect(setup.frame()).toContain("q quit");
    setup.expectSelected("cache-beta");
    await setup.key("TAB");
    setup.expectSelected("cache-beta");
    expect(setup.frame()).not.toContain("confirm");
    await setup.key("ARROW_DOWN");
    setup.expectSelected("cache-alpha");
    await setup.key("k");
    setup.expectSelected("cache-beta");
    await setup.key("j");
    await setup.key("ARROW_UP");
    await setup.clickRow(ALPHA, MouseButtons.RIGHT);
    setup.expectSelected("cache-beta");
    const alpha = await setup.rowPoint(ALPHA);
    await setup.mockMouse.moveTo(0, 0);
    await setup.mockMouse.moveTo(alpha.x, alpha.y);
    await setup.flush();
    expect(setup.captureSpans().lines[alpha.y].spans.find(span => span.text.includes("cache-alpha"))?.bg).toEqual(
      RGBA.fromHex(setup.theme.theme().backgroundElement),
    );
    await setup.clickRow(ALPHA);
    setup.expectSelected("cache-alpha");
    expect(data.contents()).toEqual(contents);
    const started = Date.now();
    await setup.click("r reset");
    const after = management.getProviderCacheSummary(data.root);
    for (const group of after.groups.filter(group => group.repoPath === ALPHA)) {
      expect(group.cleanupAt).toBeGreaterThanOrEqual(started + management.CACHE_INACTIVITY_MS);
      expect(group.lastAccessed).toBe(before.groups.find(old => old.provider === group.provider)?.lastAccessed ?? 0);
    }
    expect(after.groups.find(group => group.repoPath === BETA)).toEqual(
      before.groups.find(group => group.repoPath === BETA),
    );
    expect(data.contents().artifacts).toEqual(contents.artifacts);
    setup.expectSelected("cache-alpha");
    expect(setup.frame()).not.toContain("Repository timer reset");
    expect(setup.frame()).not.toContain("Cleanup:");
    expect(card.height).toBe(9);
    expect(setup.frame()).toContain(
      formatGraphDate(new Date(after.groups.find(group => group.provider === "jenkins")?.cleanupAt ?? 0).toISOString()),
    );
    await setup.key("r");
    setup.expectSelected("cache-alpha");
    expect(card.height).toBe(9);
    const beforeEviction = data.contents();
    await setup.key("e");
    expect(setup.frame()).toContain("Evict only cache-alpha (all providers)?");
    expect(setup.frame()).toContain(ALPHA);
    expect(setup.frame()).not.toContain("shift+r reset all");
    for (const key of ["j", "g", "r", "e"]) await setup.key(key);
    await setup.clickRow(BETA);
    setup.expectSelected("cache-alpha");
    await setup.key("ESCAPE");
    expect(setup.close).not.toHaveBeenCalled();
    expect(data.contents()).toEqual(beforeEviction);
    await setup.click("e evict");
    await setup.click("enter confirm", MouseButtons.RIGHT);
    expect(data.contents()).toEqual(beforeEviction);
    await setup.click("enter confirm");
    expect(management.getProviderCacheSummary(data.root).groups.map(group => group.repoPath)).toEqual([BETA]);
    expect(data.contents().snapshots).toEqual(beforeEviction.snapshots.filter(snapshot => snapshot.repo_path === BETA));
    expect(withoutWhitespace(setup.frame())).toContain("Evicted4snapshotsand4artifacts.");
    setup.expectSelected("cache-beta");
    await setup.click("esc back", MouseButtons.RIGHT);
    expect(setup.close).not.toHaveBeenCalled();
    await setup.click("esc back");
    expect(setup.close).toHaveBeenCalledTimes(1);
    expect(setup.scopes).toEqual(["cache", null]);
  } finally {
    await setup.dispose();
    await data.dispose();
  }
});

test("repo info is muted and right-aligned; KB includes all provider payloads and UTF-8 logs, not other repos", async () => {
  const data = await fixture();
  const now = Date.now();
  await data.seed(ALPHA, "github-actions", now - 6000);
  await data.seed(ALPHA, "jenkins", now - 4000);
  await data.seed(BETA, "jenkins", now - 2000);
  providerCacheDatabase(data.root)
    .query("UPDATE artifacts SET content = ? WHERE snapshot_id IN (SELECT id FROM snapshots WHERE repo_path = ?)")
    .run("界".repeat(400), ALPHA);
  const before = data.contents();
  const bytes = before.snapshots
    .filter(snapshot => snapshot.repo_path === ALPHA)
    .reduce((total, snapshot) => total + Buffer.byteLength(String(snapshot.payload)), 2400);
  const deadline = management
    .getProviderCacheSummary(data.root)
    .groups.find(group => group.repoPath === ALPHA)?.cleanupAt;
  expect(deadline).toBeDefined();
  const info = `${(bytes / 1024).toFixed(1)} KB · ${formatGraphDate(new Date(deadline ?? 0).toISOString())}`;
  const known = spyOn(config, "getKnownRepoInfos").mockReturnValue([
    { path: ALPHA, appName: "A very long application name that must truncate before its cache info" },
  ]);
  const setup = await screen(data.root);
  try {
    await setup.clickRow(ALPHA);
    for (const width of [90, 70, 40]) {
      setup.resize(width, 18);
      await setup.flush();
      await setup.rowPoint(ALPHA);
      const row = setup.row(ALPHA);
      const [label, metadata] = row.getChildren() as TextRenderable[];
      expect(label.fg).toEqual(RGBA.fromHex(setup.theme.theme().accent));
      expect(metadata.fg).toEqual(RGBA.fromHex(setup.theme.theme().foregroundMuted));
      expect(metadata.plainText.trim()).toBe(info);
      expect(metadata.x + metadata.width).toBe(row.x + row.width);
      expect(label.x + label.width).toBeLessThanOrEqual(metadata.x);
      const line = setup.frame().split("\n")[row.y];
      expect(line).toContain(info);
      expect(line).not.toContain("ago");
    }
    expect(data.contents()).toEqual(before);
  } finally {
    known.mockRestore();
    await setup.dispose();
    await data.dispose();
  }
});

test("General shows only Cache data, selectable and copyable even when its path is clipped and spaced", async () => {
  const data = await fixture("codepulse cache screen with spaces ");
  const root = join(data.root, "long cache directory ".repeat(5));
  await mkdir(root);
  const [copied, setCopied] = createSignal<string | null>(null);
  const copy = mock((_text: string, id: string) => setCopied(id));
  const clipboardSpy = spyOn(clipboard, "useClipboard").mockImplementation(<T extends string>() => ({
    copiedId: () => copied() as T | null,
    copyToClipboard: copy,
  }));
  const setup = await screen(root);
  try {
    const nodes = descendants(setup.renderer.root);
    const header = nodes.find(node => node.id === "cache-general")?.getChildren()[0] as TextRenderable;
    expect(header.selectable).toBe(false);
    expect(header.fg).toEqual(RGBA.fromHex(setup.theme.theme().foregroundMuted));
    expect(setup.frame()).toContain("General");
    expect(setup.frame()).toContain("enter copy");
    expect(setup.frame()).toContain("shift+r reset all");
    expect(setup.frame()).not.toContain("e evict");
    expect(setup.frame()).not.toMatch(/(?:^|\s)r reset(?:\s|$)/);
    expect(nodes.filter(node => node.id.startsWith("cache-file-") && !node.id.endsWith("-path"))).toHaveLength(1);
    expect(setup.frame()).not.toContain("cache.sqlite-wal");
    expect(setup.frame()).not.toContain("cache.sqlite-shm");
    const row = nodes.find(node => node.id === "cache-file-cache.sqlite") as BoxRenderable;
    const [name, path] = row.getChildren() as TextRenderable[];
    expect(name.plainText).toBe("Cache data");
    expect(name.selectable).toBe(true);
    expect(path.selectable).toBe(true);
    expect(path.plainText).toBe(join(root, "cache.sqlite"));
    expect(path.plainText.length).toBeGreaterThan(path.width);
    setup.expectSelected("Cache data");
    await setup.click("Cache data", MouseButtons.RIGHT);
    setup.expectSelected("Cache data");
    await setup.click("General");
    setup.expectSelected("Cache data");
    await setup.key("k");
    setup.expectSelected("Cache data");
    await setup.key("j");
    setup.expectSelected("Cache data");
    await setup.click("Cache data");
    setup.expectSelected("Cache data");
    expect(copy).not.toHaveBeenCalled();
    for (const key of ["r", "e"]) await setup.key(key);
    expect(setup.frame()).not.toContain("confirm");
    await setup.key("RETURN");
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenLastCalledWith(join(root, "cache.sqlite"), "cache-file-cache.sqlite");
    expect(setup.frame()).toContain("✓ copied");
    await setup.mockMouse.click(path.x + 1, path.y, MouseButtons.RIGHT);
    await setup.flush();
    expect(copy).toHaveBeenCalledTimes(1);
    setup.expectSelected("Cache data");
    await setup.mockMouse.click(path.x + 1, path.y);
    await setup.flush();
    expect(copy).toHaveBeenCalledTimes(2);
    expect(copy).toHaveBeenLastCalledWith(join(root, "cache.sqlite"), "cache-file-cache.sqlite");
    setup.expectSelected("Cache data");
    await setup.mockMouse.drag(path.x + 1, path.y, path.x + 8, path.y);
    await setup.flush();
    expect(setup.renderer.getSelection()?.getSelectedText().length).toBeGreaterThan(0);
    expect(copy).toHaveBeenCalledTimes(3);
    await setup.click("enter copy");
    expect(copy).toHaveBeenCalledTimes(4);
    expect(copy).toHaveBeenLastCalledWith(join(root, "cache.sqlite"), "cache-file-cache.sqlite");
  } finally {
    clipboardSpy.mockRestore();
    await setup.dispose();
    await data.dispose();
  }
});

test("async selected-repo eviction freezes the clone identity, blocks duplicate submits, reports errors and permits quit", async () => {
  const data = await fixture();
  const alphaPath = resolve("/repo/with a shared and unusually long parent directory/clone-one");
  const betaPath = resolve("/repo/with a shared and unusually long parent directory/clone-two");
  await data.seed(alphaPath, "jenkins", Date.now() - 6000);
  await data.seed(alphaPath, "snyk", Date.now() - 4000);
  await data.seed(betaPath, "jenkins", Date.now() - 2000);
  const before = data.contents();
  const known = spyOn(config, "getKnownRepoInfos").mockReturnValue([
    { path: alphaPath, appName: "Shared app" },
    { path: betaPath, appName: "Shared app" },
  ]);
  let pending = Promise.withResolvers<management.CacheEvictionResult>();
  const evict = mock((_repo: management.CacheRepositorySummary) => pending.promise);
  const setup = await screen(data.root, alphaPath, evict);
  const destroy = spyOn(setup.renderer, "destroy").mockImplementation(() => {});
  try {
    await setup.clickRow(alphaPath);
    await setup.key("e");
    expect(setup.frame()).toContain("Evict only Shared app (all providers)?");
    expect(withoutWhitespace(setup.frame())).toContain(withoutWhitespace(alphaPath));
    expect(withoutWhitespace(setup.frame())).not.toContain(withoutWhitespace(betaPath));
    for (const [width, height] of [
      [70, 18],
      [60, 12],
      [90, 30],
    ]) {
      setup.resize(width, height);
      await setup.flush();
      expect(withoutWhitespace(setup.frame())).toContain(withoutWhitespace(alphaPath));
      expect(setup.frame()).toContain("q quit");
      const card = descendants(setup.renderer.root).find(node => node.id === "cache-card") as BoxRenderable;
      expect(card.y + card.height).toBeLessThanOrEqual(height - 2);
      expect(setup.scopes).toEqual(["cache"]);
    }
    await setup.clickRow(betaPath);
    await setup.key("j");
    await setup.key("RETURN");
    expect(evict).toHaveBeenCalledTimes(1);
    const target = evict.mock.calls[0][0];
    expect(target).toMatchObject({ repoPath: alphaPath, snapshotCount: 2 });
    for (const key of ["RETURN", "e", "r", "j", "ESCAPE"]) await setup.key(key);
    await setup.click("enter confirm");
    await setup.click("esc cancel");
    await setup.clickRow(betaPath);
    expect(evict).toHaveBeenCalledTimes(1);
    expect(setup.close).not.toHaveBeenCalled();
    expect(withoutWhitespace(setup.frame())).toContain(withoutWhitespace(alphaPath));
    await setup.key("q");
    await setup.click("q quit");
    expect(destroy).toHaveBeenCalledTimes(2);
    pending.reject(new Error("database is locked"));
    await setup.flush();
    expect(setup.frame()).toContain("Eviction failed: database is locked");
    expect(setup.frame()).not.toContain("Evicted");
    expect(setup.frame()).not.toContain("enter confirm");
    expect(data.contents()).toEqual(before);
    const alpha = setup.row(alphaPath).getChildren()[0] as TextRenderable;
    expect(alpha.fg).toEqual(RGBA.fromHex(setup.theme.theme().accent));
    pending = Promise.withResolvers<management.CacheEvictionResult>();
    await setup.key("e");
    await setup.key("RETURN");
    expect(evict).toHaveBeenCalledTimes(2);
    expect(evict.mock.calls[1][0]).toEqual(target);
    pending.resolve(management.evictRepositoryCache(target.repoHash, data.root));
    await setup.flush();
    expect(withoutWhitespace(setup.frame())).toContain("Evicted2snapshotsand2artifacts.");
    expect(setup.frame()).not.toContain("Eviction failed");
    expect(management.getProviderCacheSummary(data.root).groups.map(group => group.repoPath)).toEqual([betaPath]);
    expect(data.contents().snapshots).toEqual(before.snapshots.filter(snapshot => snapshot.repo_path === betaPath));
    expect((setup.row(betaPath).getChildren()[0] as TextRenderable).fg).toEqual(
      RGBA.fromHex(setup.theme.theme().accent),
    );
    expect(
      descendants(setup.renderer.root).filter(node => node.id.startsWith("cache-file-") && !node.id.endsWith("-path")),
    ).toHaveLength(1);
  } finally {
    destroy.mockRestore();
    known.mockRestore();
    await setup.dispose();
    await data.dispose();
  }
});

test("actual groups sort alphabetically, ungrouped last; app names break access ties and cached sizes sum", async () => {
  const data = await fixture("codepulse cache screen ");
  const now = Date.now();
  await data.seed(ALPHA, "github-actions", now - management.CACHE_INACTIVITY_MS - 5000);
  await data.seed(ALPHA, "jenkins", now - management.CACHE_INACTIVITY_MS - 4000);
  await data.seed(ALPHA, "jenkins", now - management.CACHE_INACTIVITY_MS - 4000, 2);
  const spacedRepo = await data.seed(join(data.root, "repo with spaces"), "jenkins", now - 6000);
  await data.seed(BETA, "jenkins", now - 6000);
  const fallback = await data.seed(resolve("/repo/fallback"), "snyk", now - 7000);
  const known = spyOn(config, "getKnownRepoInfos").mockReturnValue([
    { path: ALPHA, appName: " Alpha ", group: " Z Team " },
    { path: BETA, appName: "Bravo", group: "A Team" },
    { path: spacedRepo, appName: " ", group: "A Team" },
  ]);
  const setup = await screen(data.root);
  const before = data.contents();
  try {
    expect(known).toHaveBeenCalledTimes(1);
    const groupsBefore = management.getProviderCacheSummary(data.root).groups;
    const bytes = groupsBefore
      .filter(group => group.repoPath === ALPHA)
      .reduce((total, group) => total + group.payloadBytes + group.artifactBytes, 0);
    expect(await setup.cells(ALPHA)).toEqual(["Alpha (current)", `${(bytes / 1024).toFixed(1)} KB · Due now`]);
    const future = management.getProviderCacheSummary(data.root).groups.find(group => group.repoPath === spacedRepo);
    expect(future).toBeDefined();
    expect(await setup.cells(spacedRepo)).toEqual([
      "repo with spaces",
      `${(((future?.payloadBytes ?? 0) + (future?.artifactBytes ?? 0)) / 1024).toFixed(1)} KB · ${formatGraphDate(new Date(future?.cleanupAt ?? 0).toISOString())}`,
    ]);
    expect(setup.row(ALPHA).getChildren()).toHaveLength(2);
    const nodes = descendants(setup.renderer.root);
    const groups = nodes.filter(node => node.id.startsWith("cache-group-")).map(node => node.id);
    expect(groups).toEqual(["cache-group-A Team", "cache-group-Z Team", "cache-group-ungrouped"]);
    expect(setup.row(BETA).y).toBeLessThan(setup.row(spacedRepo).y);
    expect(setup.row(spacedRepo).y).toBeLessThan(setup.row(ALPHA).y);
    expect(setup.row(ALPHA).y).toBeLessThan(setup.row(fallback).y);
    for (const node of nodes.filter(
      node => node.id.startsWith("cache-group-") || node.id.startsWith("cache-spacer-"),
    )) {
      const text = node.getChildren()[0] as TextRenderable;
      expect(text.selectable).toBe(false);
    }
    await setup.clickRow(spacedRepo);
    setup.expectSelected("repo with spaces");
    expect(setup.frame()).not.toContain(data.root);
    expect(setup.frame()).not.toContain(spacedRepo);
    expect(data.contents()).toEqual(before);
    await setup.key("g");
    setup.expectSelected("Cache data");
    await setup.key("j");
    setup.expectSelected("Bravo");
    await setup.key("k");
    setup.expectSelected("Cache data");
  } finally {
    known.mockRestore();
    await setup.dispose();
    await data.dispose();
  }
});

test("shift+r confirms repository count, cancels safely, survives resize, and resets without deleting data", async () => {
  const data = await fixture();
  await data.seed(ALPHA, "github-actions", Date.now() - 6000);
  await data.seed(ALPHA, "jenkins", Date.now() - 4000);
  await data.seed(BETA, "snyk", Date.now() - 2000);
  const before = management.getProviderCacheSummary(data.root);
  const contents = data.contents();
  const setup = await screen(data.root);
  try {
    await setup.clickRow(ALPHA);
    await setup.key("r", true);
    expect(setup.frame()).toContain("Reset timers for 2 repositories?");
    expect(setup.frame()).toContain("enter confirm");
    const card = descendants(setup.renderer.root).find(node => node.id === "cache-card") as BoxRenderable;
    expect(card.height).toBe(10);
    for (const key of ["e", "TAB", "j", "r", "g"]) await setup.key(key);
    await setup.clickRow(BETA);
    setup.expectSelected("cache-alpha");
    for (const [width, height] of [
      [80, 24],
      [70, 18],
      [90, 30],
    ]) {
      setup.resize(width, height);
      await setup.flush();
      expect(setup.frame()).toContain("Reset timers for 2 repositories?");
      expect(setup.frame()).toContain("q quit");
      expect(setup.scopes).toEqual(["cache"]);
    }
    await setup.key("ESCAPE");
    expect(setup.close).not.toHaveBeenCalled();
    expect(card.height).toBe(9);
    expect(data.contents()).toEqual(contents);
    await setup.click("shift+r reset all");
    await setup.click("esc cancel");
    expect(data.contents()).toEqual(contents);
    await setup.click("shift+r reset all");
    await setup.click("enter confirm", MouseButtons.RIGHT);
    expect(data.contents()).toEqual(contents);
    const started = Date.now();
    await setup.key("RETURN");
    const after = management.getProviderCacheSummary(data.root);
    expect(after.groups).toHaveLength(3);
    expect(after.groups.every(group => group.cleanupAt >= started + management.CACHE_INACTIVITY_MS)).toBe(true);
    expect(after.groups.map(group => group.lastAccessed)).toEqual(before.groups.map(group => group.lastAccessed));
    expect(data.contents().artifacts).toEqual(contents.artifacts);
    expect(data.contents().snapshots.map(({ cleanup_reset_at, ...snapshot }) => snapshot)).toEqual(
      contents.snapshots.map(({ cleanup_reset_at, ...snapshot }) => snapshot),
    );
    expect(setup.frame()).not.toContain("Reset 2 repository timers");
    expect(setup.frame()).not.toContain("Nothing deleted");
    expect(card.height).toBe(9);
    const date = formatGraphDate(new Date(after.groups[0].cleanupAt).toISOString());
    expect((await setup.cells(ALPHA))[1]).toEndWith(` · ${date}`);
    expect((await setup.cells(BETA))[1]).toEndWith(` · ${date}`);
    await setup.key("RETURN");
    expect(management.getProviderCacheSummary(data.root).groups).toEqual(after.groups);
    await setup.click("Cache data");
    await setup.click("shift+r reset all");
    await setup.click("enter confirm");
    expect(setup.frame()).not.toContain("enter confirm");
    setup.expectSelected("Cache data");
    await setup.key("ESCAPE");
    expect(setup.scopes).toEqual(["cache", null]);
  } finally {
    await setup.dispose();
    await data.dispose();
  }
});

test("q and its mouse footer quit normally and during confirmation without resetting timers", async () => {
  const data = await fixture();
  await data.seed(ALPHA, "jenkins", Date.now() - 6000);
  const before = data.contents();
  const setup = await screen(data.root);
  const destroy = spyOn(setup.renderer, "destroy").mockImplementation(() => {});
  try {
    await setup.click("q quit", MouseButtons.RIGHT);
    expect(destroy).not.toHaveBeenCalled();
    await setup.key("q");
    expect(destroy).toHaveBeenCalledTimes(1);
    await setup.click("q quit");
    expect(destroy).toHaveBeenCalledTimes(2);
    await setup.key("r", true);
    await setup.key("q");
    expect(destroy).toHaveBeenCalledTimes(3);
    expect(setup.frame()).toContain("enter confirm");
    await setup.click("q quit");
    expect(destroy).toHaveBeenCalledTimes(4);
    expect(setup.close).not.toHaveBeenCalled();
    expect(data.contents()).toEqual(before);
  } finally {
    destroy.mockRestore();
    await setup.dispose();
    await data.dispose();
  }
});

test("repository and reset-all errors stay visible without success or deletion", async () => {
  const data = await fixture();
  await data.seed(ALPHA, "snyk", Date.now() - 6000);
  const setup = await screen(data.root);
  const before = data.contents();
  const reset = spyOn(management, "resetRepositoryCacheTimer").mockImplementation(() => {
    throw new Error("database is locked");
  });
  const all = spyOn(management, "resetAllCacheTimers").mockImplementation(() => {
    throw new Error("database is locked");
  });
  try {
    await setup.clickRow(ALPHA);
    await setup.key("r");
    expect(setup.frame()).toContain("Reset failed: database is locked");
    expect(setup.frame()).not.toContain("Repository timer reset");
    await setup.key("r", true);
    await setup.key("RETURN");
    expect(setup.frame()).toContain("Action failed: database is locked");
    expect(setup.frame()).not.toContain("Nothing deleted");
    expect(data.contents()).toEqual(before);
  } finally {
    reset.mockRestore();
    all.mockRestore();
    await setup.dispose();
    await data.dispose();
  }
});

test("empty and corrupt databases are safe; an injected root never inspects or changes another root", async () => {
  const data = await fixture();
  const other = await fixture();
  await other.seed(resolve("/repo/not-visible"), "jenkins", Date.now() - 6000);
  const before = other.contents();
  const setup = await screen(data.root);
  try {
    expect(setup.frame()).toContain("No cached provider data");
    const card = descendants(setup.renderer.root).find(node => node.id === "cache-card") as BoxRenderable;
    expect(card.height).toBe(6);
    for (const key of ["j", "k", "r", "e", "TAB"]) await setup.key(key);
    await setup.key("r", true);
    expect(setup.frame()).not.toContain("confirm");
    expect(setup.frame()).not.toContain("not-visible");
    expect(other.contents()).toEqual(before);
    await setup.key("ESCAPE");
    expect(setup.scopes).toEqual(["cache", null]);
  } finally {
    await setup.dispose();
    await data.dispose();
    await other.dispose();
  }
  const invalid = await fixture();
  await writeFile(join(invalid.root, "cache.sqlite"), "not a SQLite database");
  const broken = await screen(invalid.root);
  try {
    expect(broken.frame()).toContain("Cache error:");
    expect(broken.frame()).toContain("Cache unavailable");
    const path = descendants(broken.renderer.root).find(
      node => node.id === "cache-file-cache.sqlite-path",
    ) as TextRenderable;
    expect(path.plainText).toBe(join(invalid.root, "cache.sqlite"));
    await broken.key("e");
    await broken.key("r");
    expect(broken.frame()).not.toContain("Repository timer reset");
    await broken.key("ESCAPE");
    expect(broken.close).toHaveBeenCalledTimes(1);
  } finally {
    await broken.dispose();
    await invalid.dispose();
  }
  const summary = spyOn(management, "getProviderCacheSummary").mockImplementation(() => {
    throw new Error("cannot inspect cache");
  });
  const fallback = await screen(undefined);
  try {
    const path = descendants(fallback.renderer.root).find(
      node => node.id === "cache-file-cache.sqlite-path",
    ) as TextRenderable;
    expect(path.plainText).toBe(join(resolve(DEFAULT_PROVIDER_CACHE_ROOT), "cache.sqlite"));
    expect(fallback.frame()).toContain("Cache error: cannot inspect cache");
  } finally {
    summary.mockRestore();
    await fallback.dispose();
  }
});

test("long lists scroll by wheel, pages, arrows, j/k and g/G; resize keeps scope, selection and footer", async () => {
  const data = await fixture();
  for (let index = 0; index < 35; index++)
    await data.seed(
      resolve(`/repo/cache-scroll-${String(index).padStart(2, "0")}`),
      "jenkins",
      Date.now() - 40000 + index * 1000,
    );
  const before = data.contents();
  const setup = await screen(data.root);
  try {
    const list = descendants(setup.renderer.root).find(node => node.id === "cache-list") as ScrollBoxRenderable;
    await setup.mockMouse.scroll(list.x + 4, list.y + 2, "down");
    await setup.flush();
    expect(list.scrollTop).toBeGreaterThan(0);
    await setup.key("g", true);
    setup.expectSelected("cache-scroll-34");
    expect(list.scrollTop).toBeGreaterThan(0);
    await setup.key("g");
    setup.expectSelected("Cache data");
    await setup.key("\u001b[6~");
    expect(setup.frame()).not.toContain("Cache data");
    await setup.key("\u001b[5~");
    setup.expectSelected("Cache data");
    await setup.key("j", true);
    setup.expectSelected("cache-scroll-09");
    await setup.key("k", true);
    setup.expectSelected("Cache data");
    await setup.key("ARROW_DOWN");
    setup.expectSelected("cache-scroll-00");
    await setup.key("ARROW_UP");
    setup.expectSelected("Cache data");
    await setup.clickRow(resolve("/repo/cache-scroll-00"));
    for (const [width, height] of [
      [90, 30],
      [70, 18],
      [60, 12],
    ]) {
      setup.resize(width, height);
      await setup.flush();
      expect(setup.frame()).toContain("esc back");
      expect(setup.frame()).toContain("q quit");
      expect(setup.scopes).toEqual(["cache"]);
      const root = setup.renderer.root.getChildren()[0];
      expect(root.width).toBe(width);
      expect(root.height).toBe(height);
      expect(list.y + list.height).toBeLessThanOrEqual(height);
    }
    setup.resize(90, 30);
    await setup.flush();
    setup.expectSelected("cache-scroll-00");
    expect(data.contents()).toEqual(before);
  } finally {
    await setup.dispose();
    await data.dispose();
  }
});
