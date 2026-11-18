/**
 * A provider is its own files: one written only here, with a definition, adapters and a module, joins the app through
 * the same list the built-in ones are in. Nothing outside this file names it, yet it shows in the view cycle, the
 * command bar, the Menu, the detail tabs, the Dashboard and the cache, and its settings are read, checked and saved.
 */
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliRenderer } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createEffect, onCleanup } from "solid-js";
import { onProviderCacheWrite, ProviderCacheRegistry, ShaSqliteCache } from "./adapters/cache/sha-sqlite-cache";
import { fileSettings } from "./adapters/settings/settings-file";
import { buildGraph } from "./core/git/graph";
import type { Commit } from "./core/git/types";
import type { ProviderDefinition } from "./core/provider-set";
import { definedFields, type SettingsSection } from "./core/settings/provider-section";
import { startupProps } from "./main";
import { terminalPorts } from "./ports";
import { builtInProviders, modulesOf, providerPlugin } from "./providers";
import { AppContent } from "./tui/app/app-content";
import { defaultPorts, setDefaultPorts } from "./tui/context/ports";
import { defaultProviderModules, setDefaultProviderModules } from "./tui/context/provider-modules";
import type { AppActions, AppState } from "./tui/context/state";
import { createThemeState } from "./tui/context/theme";
import * as dataLoader from "./tui/hooks/use-data-loader";
import * as detailLoader from "./tui/hooks/use-detail-loader";
import { githubModule } from "./tui/providers/github-actions/module";
import { providerModule } from "./tui/providers/module";
import { detailEntry } from "./tui/providers/shared/detail-entry";

const SHA = "c0ffee".padEnd(40, "0");

/** What the fake provider keeps for a commit: one check that passed. */
interface FakeCheck {
  sha: string;
  passedAt: number;
}

interface FakeSettings extends SettingsSection {
  enabled: boolean;
  /** A setting of its own, checked by its own rules. */
  label: string;
}

interface FakeAdapters {
  checks: ShaSqliteCache<FakeCheck>;
}

const fakeProvider: ProviderDefinition<FakeAdapters, FakeSettings> = {
  id: "fake-ci",
  key: "fake",
  displayName: "Fake CI",
  detailLabel: "Checks",
  category: "ci",
  settings: {
    defaults: { enabled: false, label: "checks" },
    read: (raw, reader) =>
      definedFields({ enabled: reader.boolean("enabled", raw.enabled), label: reader.text("label", raw.label, 20) }),
  },
  storedEvents: async (adapters, app) =>
    (await adapters.checks.peekAll(app)).map(check => ({
      id: `${app}:fake:${check.sha}`,
      app,
      source: fakeProvider.id,
      time: check.passedAt,
      status: "pass" as const,
      text: `fake check on ${check.sha.slice(0, 7)} passed`,
      sha: check.sha,
    })),
};

/** What the module did, for the test to see. */
const calls = { refreshed: 0, invalidated: 0, stopped: 0 };

const fakeModule = providerModule({
  definition: fakeProvider,
  start: ({ state, actions, settings }) => {
    // Turned on, it is in the view cycle; turned off, it leaves it (and its view goes back to Git).
    createEffect(() => {
      if (settings().enabled)
        state.providers.register({
          id: fakeProvider.id,
          displayName: fakeProvider.displayName,
          isAvailable: () => true,
        });
      else {
        state.providers.unregister(fakeProvider.id);
        if (state.activeProviderView() === fakeProvider.id) actions.setActiveProviderView("git");
      }
    });
    onCleanup(() => calls.stopped++);
    return {
      instance: null,
      getCommitData: () => null,
      invalidate: () => {
        calls.invalidated++;
      },
      refresh: async () => {
        calls.refreshed++;
      },
      detailSource: { getCommitData: (sha: string) => ({ sha, label: settings().label }) },
    };
  },
  colors: theme => ({ bg: theme.accent, fg: theme.background }),
  menuItems: menu => [
    { kind: "header", label: fakeProvider.displayName },
    {
      kind: "toggle",
      label: "Enabled",
      get: () => menu.settings.enabled,
      set: enabled => menu.update({ ...menu.settings, enabled }),
    },
  ],
  detailEntries: {
    [fakeProvider.id]: detailEntry<{ getCommitData: (sha: string) => { sha: string; label: string } }>({
      Tab: props => (
        <text>{`fake ${props.source.getCommitData(props.context.sha).label} for ${props.context.sha.slice(0, 7)}`}</text>
      ),
    }),
  },
  legend: [],
});

/** The fake provider as the root lists a provider: its module and its adapters on the app's caches. */
const fakePlugin = providerPlugin(fakeModule, ({ cacheRoot, registry }) => ({
  checks: new ShaSqliteCache<FakeCheck>({
    provider: fakeProvider.id,
    root: cacheRoot,
    registry,
    isEntry: (value): value is FakeCheck => typeof (value as FakeCheck | null)?.sha === "string",
    invalidMessage: "Cannot cache an invalid fake check.",
  }),
}));

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const finish of cleanup.splice(0).reverse()) await finish();
});

async function launch() {
  const root = await mkdtemp(join(tmpdir(), "codepulse-fake-provider-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const configPath = join(root, "config.json");
  // Every built-in provider off; the fake one on, with a label of its own and one value its rules refuse.
  await writeFile(
    configPath,
    JSON.stringify({ repos: { [repo]: { providers: { fake: { enabled: true, label: "nightly", extra: 5 } } } } }),
  );
  const registry = new ProviderCacheRegistry();
  cleanup.push(() => registry.close());
  const plugins = [...builtInProviders, fakePlugin];
  const ports = terminalPorts({ cacheRoot: join(root, "cache"), registry }, plugins);
  const settings = fileSettings(ports.providers.definitions, configPath);
  const commit: Commit = {
    hash: SHA,
    shortHash: SHA.slice(0, 7),
    parents: [],
    subject: "feat: checked",
    body: "",
    author: "Author",
    authorEmail: "author@example.com",
    authorDate: "2026-10-13T10:00:00Z",
    committer: "Author",
    committerEmail: "author@example.com",
    commitDate: "2026-10-13T10:00:00Z",
    refs: [],
  };
  let app: { state: AppState; actions: AppActions } | undefined;
  const spies = [
    spyOn(detailLoader, "useDetailLoader").mockImplementation(() => {}),
    spyOn(CliRenderer.prototype, "setTerminalTitle").mockImplementation(() => {}),
    spyOn(dataLoader, "useDataLoader").mockImplementation(options => {
      app = { state: options.state, actions: options.actions };
      options.actions.setRepoPath(repo);
      options.actions.setCommits([commit]);
      options.actions.setGraphRows(buildGraph([commit]));
      options.actions.setCurrentBranch("main");
      options.actions.setLoading(false);
      return { loadData: async () => {}, loadMoreData: async () => {}, handleFetch: async () => {} };
    }),
  ];
  cleanup.push(() => {
    for (const spy of spies) spy.mockRestore();
  });
  const setup = await testRender(
    () => (
      <AppContent
        repoPath={repo}
        startupMode={{ kind: "graph" }}
        themeState={createThemeState()}
        autoRefreshInterval={0}
        autoFetchInterval={0}
        {...ports}
        settings={settings}
        providerModules={modulesOf(plugins)}
        initialProviderSettings={settings.load(repo).config.providers}
      />
    ),
    { width: 200, height: 45, kittyKeyboard: true, useMouse: true },
  );
  // A test that fails before it stops the app still leaves no renderer behind.
  cleanup.push(() => {
    try {
      setup.renderer.destroy();
    } catch {}
  });
  await setup.flush();
  if (!app) throw new Error("The app did not start");
  const { state, actions } = app;
  const frame = () => setup.captureCharFrame();
  const settle = async (done: () => boolean) => {
    for (let tries = 0; tries < 50 && !done(); tries++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      await setup.flush();
    }
  };
  const press = async (key: string) => {
    setup.mockInput.pressKey(key);
    await setup.flush();
  };
  const command = async (text: string) => {
    await press(":");
    for (const char of text) await press(char);
    await press("RETURN");
  };
  return { repo, configPath, ports, settings, setup, state, actions, frame, settle, press, command };
}

test("a provider written only in a test joins every part of the app through the root's list", async () => {
  const app = await launch();
  const { state, actions, frame } = app;

  // Its settings are read and checked by its own definition.
  const loaded = app.settings.load(app.repo);
  expect(loaded.config.providers?.fake).toEqual({ enabled: true, label: "nightly" });
  // Turned on, it is a view after the built-in ones: Tab reaches it, and the command bar names it.
  expect(state.providers.getEnabledViews()).toEqual(["dashboard", "git", "fake-ci"]);
  expect(state.providers.nextView("git")).toBe("fake-ci");
  await app.settle(() => frame().includes("Fake CI"));
  expect(frame()).toContain("Fake CI");

  // Its view shows its detail tab, with the label from its settings.
  actions.setActiveProviderView("fake-ci");
  actions.setDetailActiveTab("fake-ci");
  await app.settle(() => frame().includes("fake nightly for"));
  expect(frame()).toContain(`fake nightly for ${SHA.slice(0, 7)}`);
  expect(frame()).toContain("Checks");
  // Reload fetches its data again, as a built-in provider's.
  const refreshed = calls.refreshed;
  await app.command("reload");
  await app.settle(() => calls.refreshed > refreshed);
  expect(calls.refreshed).toBe(refreshed + 1);

  // Its stored checks are Dashboard events, on the app's own cache; writing them told only the app's registry.
  const written: string[] = [];
  const processWide: string[] = [];
  const stop = app.ports.cacheStore.onWrite(repo => written.push(repo));
  const stopProcess = onProviderCacheWrite(repo => processWide.push(repo));
  await app.ports.providers.adapters(fakeProvider).checks.write(app.repo, { sha: SHA, passedAt: Date.now() - 60_000 });
  stop();
  stopProcess();
  expect(written).toEqual([app.repo]);
  expect(processWide).toEqual([]);
  const groups = app.ports.cacheStore.summary().groups;
  expect(groups.map(group => [group.provider, group.snapshotCount])).toEqual([["fake-ci", 1]]);
  actions.setActiveProviderView("dashboard");
  await app.settle(() => frame().includes("fake check on c0ffee0 passed"));
  expect(frame()).toContain("fake check on c0ffee0 passed");
  // `:hide fake` hides its events, by its settings key, and `:show` brings them back.
  await app.command("hide fake");
  await app.settle(() => !frame().includes("fake check on c0ffee0 passed"));
  expect(frame()).not.toContain("fake check on c0ffee0 passed");
  await app.command("show");
  await app.settle(() => frame().includes("fake check on c0ffee0 passed"));
  expect(frame()).toContain("fake check on c0ffee0 passed");

  // The cache screen lists the app by what its providers stored, this one's checks included; evicting it starts every
  // provider over, this one too.
  await app.command("cache");
  await app.settle(() => frame().includes("Cache data"));
  expect(frame()).toMatch(/repo\s.*KB/);
  const invalidated = calls.invalidated;
  await app.press("j");
  await app.press("e");
  await app.settle(() => frame().includes("Deletes its cached data"));
  await app.press("RETURN");
  await app.settle(() => calls.invalidated > invalidated);
  expect(calls.invalidated).toBe(invalidated + 1);
  expect(app.ports.cacheStore.summary().groups).toEqual([]);
  await app.press("ESCAPE");
  await app.settle(() => !frame().includes("Cache data"));

  // Menu → Providers has its section; turning it off there, while its view is open, saves it, takes it out of the
  // view cycle and goes back to Git.
  actions.setActiveProviderView("fake-ci");
  await app.setup.flush();
  await app.press("m");
  await app.setup.mockMouse.click(...point(frame(), "Providers"));
  await app.setup.flush();
  await app.settle(() => frame().includes("Snyk"));
  // Its section is the last: the cursor stops on its Enabled row, under its own header.
  for (let row = 0; row < 30; row++) await app.press("ARROW_DOWN");
  const lines = frame().split("\n");
  const header = lines.findIndex(line => line.trim() === "Fake CI" || /^\s*│?\s*Fake CI\s*│?\s*$/.test(line));
  expect(header).toBeGreaterThan(0);
  expect(lines[header + 1]).toContain("Enabled");
  expect(lines[header + 1]).toContain("[on]");
  await app.press("RETURN");
  await app.settle(() => !state.providers.getEnabledViews().includes("fake-ci"));
  expect(state.providers.getEnabledViews()).toEqual(["dashboard", "git"]);
  expect(state.activeProviderView()).toBe("git");
  const saved = JSON.parse(await readFile(app.configPath, "utf8"));
  expect(saved.repos[app.repo].providers.fake).toMatchObject({ enabled: false, label: "nightly" });
  // Read again, its section round-trips, its unknown field still in the file but not in its settings.
  expect(app.settings.load(app.repo).config.providers?.fake).toEqual({ enabled: false, label: "nightly" });

  // The app stops: so does it, once.
  const stopped = calls.stopped;
  await app.setup.dispose();
  expect(calls.stopped).toBe(stopped + 1);
});

test("a provider's own rules check its settings, with warnings that name its section", () => {
  const warnings: string[] = [];
  const read = fakeProvider.settings.read(
    { enabled: "yes", label: 7 },
    {
      warn: (field, problem) => warnings.push(`"providers.fake.${field}" ${problem}`),
      text: (field, value) => {
        if (typeof value === "string") return value;
        warnings.push(`"providers.fake.${field}" must be a string`);
        return undefined;
      },
      boolean: (field, value) => {
        if (typeof value === "boolean") return value;
        warnings.push(`"providers.fake.${field}" must be a boolean`);
        return undefined;
      },
      oneOf: () => undefined,
      list: () => undefined,
    },
  );
  expect(read).toEqual({});
  expect(warnings).toEqual(['"providers.fake.enabled" must be a boolean', '"providers.fake.label" must be a string']);
});

/** Where a label is on the screen, for a click. */
function point(screen: string, label: string): [number, number] {
  const lines = screen.split("\n");
  const y = lines.findIndex(line => line.includes(label));
  return [(lines[y]?.indexOf(label) ?? 0) + 1, y];
}

test("the root's list takes a module only with the adapters it runs on", () => {
  // @ts-expect-error GitHub's module runs on GitHub's adapters (API, cache, token), not on an empty object.
  const wrong = providerPlugin(githubModule, () => ({}));
  expect(wrong.definition.id).toBe("github-actions");
});

test("startup builds the app from the same list: its module, its settings and its adapters come along", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepulse-fake-startup-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "not-a-repository");
  const configPath = join(root, "config.json");
  await writeFile(configPath, JSON.stringify({ repos: { [repo]: { providers: { fake: { enabled: true } } } } }));
  const registry = new ProviderCacheRegistry();
  cleanup.push(() => registry.close());
  const plugins = [...builtInProviders, fakePlugin];
  const settings = fileSettings(
    plugins.map(plugin => plugin.definition),
    configPath,
  );
  const ports = terminalPorts({ cacheRoot: join(root, "cache"), registry }, plugins);
  // Startup registers its ports and modules for the whole process: the other tests get theirs back.
  const before = { ports: defaultPorts(), modules: defaultProviderModules() };
  cleanup.push(() => {
    setDefaultPorts(before.ports);
    setDefaultProviderModules(before.modules);
  });
  const props = await startupProps(["bun", "codepulse", repo], { ...ports, settings }, plugins);
  expect(props.providerModules?.map(module => module.definition.id)).toEqual([
    "github-actions",
    "jenkins",
    "openshift",
    "snyk",
    "fake-ci",
  ]);
  expect(props.providers?.views()).toEqual([
    "dashboard",
    "git",
    "github-actions",
    "jenkins",
    "openshift",
    "snyk",
    "fake-ci",
  ]);
  expect(props.initialProviderSettings?.fake).toEqual({ enabled: true });
  expect(props.providers?.adapters(fakeProvider).checks).toBeInstanceOf(ShaSqliteCache);
});

test("an app given its ports and modules never reaches for the process's registered ones", async () => {
  // The registered ones still answer, so the app runs as it would, but every read of them is counted.
  const before = { ports: defaultPorts(), modules: defaultProviderModules() };
  const reads: string[] = [];
  const counted = <T extends object>(target: T, name: string): T =>
    new Proxy(target, {
      get: (object, field, receiver) => {
        reads.push(`${name}.${String(field)}`);
        return Reflect.get(object, field, receiver);
      },
    });
  setDefaultPorts(counted(before.ports, "ports"));
  setDefaultProviderModules(counted([...before.modules], "modules"));
  cleanup.push(() => {
    setDefaultPorts(before.ports);
    setDefaultProviderModules(before.modules);
  });
  const app = await launch();
  const { actions, frame } = app;
  for (const view of ["fake-ci", "dashboard", "git"]) {
    actions.setActiveProviderView(view);
    await app.setup.flush();
  }
  await app.press("m");
  await app.settle(() => frame().includes("Menu"));
  await app.press("ESCAPE");
  await app.command("cache");
  await app.settle(() => frame().includes("Cache data"));
  await app.press("ESCAPE");
  await app.command("debug");
  await app.setup.flush();
  await app.press("ESCAPE");
  expect(reads).toEqual([]);
  // The count works: a read of the registered ports is seen.
  void defaultPorts().git;
  expect(reads).toEqual(["ports.git"]);
});
