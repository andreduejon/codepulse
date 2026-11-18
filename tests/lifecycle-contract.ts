/**
 * What every provider's fetch lifecycle must keep doing, whatever runs it: today the shared Solid hook
 * (use-provider-fetch-lifecycle.ts), later a plain service. One fetch per need; the Dashboard fetching quietly and its
 * tab keeping that fetch; cancelling on leaving, switching repositories, suspending and disposing; a late answer never
 * showing where it doesn't belong; Reloads queued behind a running fetch; backoff after failures; the expired-token
 * freeze; and nothing asked while turned off.
 *
 * Each provider runs it with a fixture that fakes its list request (lifecycle-contract.test.ts). Test helper only.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as monotonic from "../src/core/monotonic";
import type { ProviderView } from "../src/core/provider-model";
import type { AppActions, AppState } from "../src/tui/context/state";

export type ContractFailure = "auth" | "server" | null;

export interface ContractRequest {
  /** The repository open when the request went out. */
  repo: string;
  signal: AbortSignal | undefined;
  /** It answered, failed or was cancelled. */
  settled: boolean;
}

/**
 * The faked list request. It answers each repository with that repository's data, and can hold every request until
 * `release()`, fail, or answer even after being cancelled (a server that ignores the cancel).
 */
export class ContractBackend {
  readonly requests: ContractRequest[] = [];
  /** Repositories whose list has the commit; the others answer with nothing. */
  readonly withData = new Set<string>();
  failure: ContractFailure = null;
  ignoreAbort = false;
  private waiting: (() => void)[] | null = null;

  hold(): void {
    this.waiting ??= [];
  }

  release(): void {
    const waiting = this.waiting ?? [];
    this.waiting = null;
    for (const go of waiting) go();
  }

  /** One request: waits while held, then answers with `answer(hasData, failure)`. */
  async request<T>(
    repo: string,
    signal: AbortSignal | undefined,
    answer: (hasData: boolean, failure: ContractFailure) => T,
  ): Promise<T> {
    const entry: ContractRequest = { repo, signal, settled: false };
    this.requests.push(entry);
    try {
      if (this.waiting) {
        const waiting = this.waiting;
        await new Promise<void>((resolve, reject) => {
          waiting.push(resolve);
          if (this.ignoreAbort) return;
          const abort = () => reject(signal?.reason ?? new DOMException("The request was cancelled.", "AbortError"));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        });
      }
      if (signal?.aborted && !this.ignoreAbort)
        throw signal.reason ?? new DOMException("The request was cancelled.", "AbortError");
      return answer(this.withData.has(repo), this.failure);
    } finally {
      entry.settled = true;
    }
  }

  requestsFor(repo: string): ContractRequest[] {
    return this.requests.filter(request => request.repo === repo);
  }
}

export interface ContractMount {
  state: AppState;
  actions: AppActions;
  /** The provider has the graph's commit in its data. */
  hasData(): boolean;
  /** Reload: the explicit refresh `f`, `r` and `:reload` run. */
  refresh(): Promise<void>;
  setEnabled(enabled: boolean): void;
  setSuspended(suspended: boolean): void;
  /** Opens another repository, as the app does: its path and graph in one update. */
  openRepo(repo: string): void;
  dispose(): void;
}

export interface ContractFixture {
  name: string;
  /** The provider's own view. */
  view: ProviderView;
  /** The provider's error text for an expired token, as its status shows it. */
  tokenExpired: string;
  /**
   * Cases the provider doesn't keep yet, with why. They run as expected failures (`test.failing`): once the gap is
   * fixed the case fails, so its entry here goes.
   */
  knownGaps?: Partial<Record<"backoff", string>>;
  mount(options: {
    backend: ContractBackend;
    repo: string;
    view: ProviderView;
    suspended?: boolean;
    enabled?: boolean;
    /** Runs after the test: restores spies, removes folders. */
    onCleanup: (finish: () => void | Promise<void>) => void;
  }): ContractMount;
}

/** Waits until `done` holds (or about half a second), then a moment longer for what follows from it. */
async function settle(done: () => boolean = () => false) {
  for (let i = 0; i < 100 && !done(); i++) await Bun.sleep(5);
  await Bun.sleep(10);
}

let repoCount = 0;

/** Registers the contract's tests for one provider. */
export function lifecycleContract(fixture: ContractFixture): void {
  const cleanups: (() => void | Promise<void>)[] = [];
  afterEach(async () => {
    for (const finish of cleanups.splice(0).reverse()) await finish();
  });

  /** Two repositories of their own per test: the provider caches must not carry one test's data into another. */
  const repos = () => {
    repoCount++;
    return { a: `/repo/contract-${repoCount}-a`, b: `/repo/contract-${repoCount}-b` };
  };
  const mount = (
    backend: ContractBackend,
    repo: string,
    options: { view?: ProviderView; suspended?: boolean; enabled?: boolean } = {},
  ) =>
    fixture.mount({
      backend,
      repo,
      view: options.view ?? fixture.view,
      suspended: options.suspended,
      enabled: options.enabled,
      onCleanup: finish => cleanups.push(finish),
    });
  /** Moves the monotonic clock to `ms` after the test's first move; restored after the test. */
  let clock: { spy: ReturnType<typeof spyOn>; start: number } | null = null;
  const later = (ms: number) => {
    if (!clock) {
      const start = monotonic.monotonicNow();
      clock = { spy: spyOn(monotonic, "monotonicNow"), start };
      cleanups.push(() => {
        clock?.spy.mockRestore();
        clock = null;
      });
    }
    clock.spy.mockReturnValue(clock.start + ms);
  };
  /** Away to Git and back to `view` (the provider's own by default): what a view switch does. */
  const comeBack = (app: ContractMount, view: ProviderView = fixture.view) => {
    app.actions.setActiveProviderView("git");
    app.actions.setActiveProviderView(view);
  };

  describe(`${fixture.name} fetch lifecycle (contract)`, () => {
    test("its view fetches the list once and shows the commit's data", async () => {
      const { a } = repos();
      const backend = new ContractBackend();
      backend.withData.add(a);
      const app = mount(backend, a);
      await settle(app.hasData);
      expect(app.hasData()).toBe(true);
      expect(backend.requests).toHaveLength(1);
    });

    test("the Dashboard fetches it quietly, and the provider's tab keeps that fetch instead of asking again", async () => {
      const { a } = repos();
      const backend = new ContractBackend();
      backend.withData.add(a);
      backend.hold();
      const app = mount(backend, a, { view: "dashboard" });
      await settle(() => backend.requests.length > 0);
      expect(backend.requests).toHaveLength(1);
      expect(app.state.providerStatusFor(fixture.view).kind).not.toBe("loading");
      app.actions.setActiveProviderView(fixture.view);
      await settle();
      expect(backend.requests).toHaveLength(1);
      backend.release();
      await settle(app.hasData);
      expect(app.hasData()).toBe(true);
      expect(backend.requests).toHaveLength(1);
    });

    test("leaving its view and the Dashboard cancels the fetch that runs", async () => {
      const { a } = repos();
      const backend = new ContractBackend();
      backend.hold();
      const app = mount(backend, a);
      await settle(() => backend.requests.length > 0);
      app.actions.setActiveProviderView("git");
      expect(backend.requests[0]?.signal?.aborted).toBe(true);
    });

    test("a Reload during a fetch runs after it, and its promise waits until it has run", async () => {
      const { a } = repos();
      const backend = new ContractBackend();
      backend.withData.add(a);
      backend.hold();
      const app = mount(backend, a);
      await settle(() => backend.requests.length > 0);
      let reloaded = false;
      const reload = app.refresh().then(() => {
        reloaded = true;
      });
      await settle();
      expect(backend.requests).toHaveLength(1);
      expect(reloaded).toBe(false);
      backend.release();
      await reload;
      expect(backend.requests.length).toBeGreaterThanOrEqual(2);
      expect(backend.requests.every(request => request.settled)).toBe(true);
      expect(app.hasData()).toBe(true);
    });

    test("switching repositories cancels the old one's fetch, and its late answer doesn't show in the new one", async () => {
      const { a, b } = repos();
      const backend = new ContractBackend();
      backend.withData.add(a);
      backend.ignoreAbort = true;
      backend.hold();
      const app = mount(backend, a);
      await settle(() => backend.requests.length > 0);
      app.openRepo(b);
      expect(backend.requestsFor(a)[0]?.signal?.aborted).toBe(true);
      backend.release();
      await settle(() => backend.requestsFor(b).some(request => request.settled));
      expect(app.hasData()).toBe(false);
      // Back to the first one: its data shows again.
      app.openRepo(a);
      await settle(app.hasData);
      expect(app.hasData()).toBe(true);
    });

    test("suspended it asks nothing, also for a Reload; resumed, it fetches", async () => {
      const { a } = repos();
      const backend = new ContractBackend();
      backend.withData.add(a);
      const app = mount(backend, a, { suspended: true });
      await settle();
      await app.refresh();
      await settle();
      expect(backend.requests).toHaveLength(0);
      app.setSuspended(false);
      await settle(app.hasData);
      expect(app.hasData()).toBe(true);
    });

    test("suspending cancels the fetch that runs, and its late answer doesn't show", async () => {
      const { a } = repos();
      const backend = new ContractBackend();
      backend.withData.add(a);
      backend.ignoreAbort = true;
      backend.hold();
      const app = mount(backend, a);
      await settle(() => backend.requests.length > 0);
      app.setSuspended(true);
      expect(backend.requests[0]?.signal?.aborted).toBe(true);
      backend.release();
      await settle(() => backend.requests[0]?.settled === true);
      expect(app.hasData()).toBe(false);
    });

    test("a failed fetch shows its error, and a Reload asks again at once", async () => {
      const { a } = repos();
      const backend = new ContractBackend();
      backend.withData.add(a);
      backend.failure = "server";
      const app = mount(backend, a);
      await settle(() => app.state.providerStatusFor(fixture.view).kind === "error");
      expect(app.state.providerStatusFor(fixture.view).kind).toBe("error");
      backend.failure = null;
      await app.refresh();
      await settle(app.hasData);
      expect(app.hasData()).toBe(true);
      expect(app.state.providerStatusFor(fixture.view).kind).not.toBe("error");
    });

    const backoffGap = fixture.knownGaps?.backoff;
    (backoffGap ? test.failing : test)(
      `after failures, the Dashboard's quiet fetches wait out the backoff, then ask again${backoffGap ? ` (known gap: ${backoffGap})` : ""}`,
      async () => {
        // The provider's own tab shows its status, so it asks at once; quiet fetches wait.
        const { a } = repos();
        const backend = new ContractBackend();
        backend.failure = "server";
        const app = mount(backend, a, { view: "dashboard" });
        await settle(() => backend.requests.some(request => request.settled));
        // A second failure: the backoff is now a minute.
        await app.refresh();
        await settle();
        const asked = backend.requests.length;
        // Stale after 40 seconds, but still in the backoff.
        later(40_000);
        comeBack(app, "dashboard");
        await settle();
        expect(backend.requests).toHaveLength(asked);
        // Past it.
        later(70_000);
        comeBack(app, "dashboard");
        await settle(() => backend.requests.length > asked);
        expect(backend.requests.length).toBeGreaterThan(asked);
      },
    );

    test("an expired token stops automatic fetches until a Reload", async () => {
      const { a } = repos();
      const backend = new ContractBackend();
      backend.withData.add(a);
      backend.failure = "auth";
      const app = mount(backend, a);
      await settle(() => app.state.providerStatusFor(fixture.view).kind === "error");
      expect(app.state.providerStatusFor(fixture.view)).toEqual({ kind: "error", message: fixture.tokenExpired });
      backend.failure = null;
      const asked = backend.requests.length;
      // Past the staleness and any backoff: an automatic fetch would ask now.
      later(10 * 60_000);
      comeBack(app);
      await settle();
      expect(backend.requests).toHaveLength(asked);
      await app.refresh();
      await settle(app.hasData);
      expect(app.hasData()).toBe(true);
    });

    test("turned off it asks nothing, also for a Reload; turned on, its view fetches", async () => {
      const { a } = repos();
      const backend = new ContractBackend();
      backend.withData.add(a);
      const app = mount(backend, a, { enabled: false });
      await settle();
      await app.refresh();
      await settle();
      expect(backend.requests).toHaveLength(0);
      app.setEnabled(true);
      await settle(app.hasData);
      expect(app.hasData()).toBe(true);
    });

    test("disposed, it cancels its fetch, and a late answer changes nothing", async () => {
      const { a } = repos();
      const backend = new ContractBackend();
      backend.withData.add(a);
      backend.ignoreAbort = true;
      backend.hold();
      const app = mount(backend, a);
      await settle(() => backend.requests.length > 0);
      app.dispose();
      expect(backend.requests[0]?.signal?.aborted).toBe(true);
      backend.release();
      await settle(() => backend.requests[0]?.settled === true);
      expect(app.hasData()).toBe(false);
    });
  });
}
