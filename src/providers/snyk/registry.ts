import type { Database } from "bun:sqlite";
import { addDebugEvent } from "../../debug/events";
import { DEFAULT_PROVIDER_CACHE_ROOT, providerCacheDatabase } from "../shared/sha-sqlite-cache";
import type { SnykCommandRunner } from "./scanner";

/** Ranges a published version asks for; peers apart, since they accept what other packages resolve. */
export interface PackageRanges {
  /** dependencies and optionalDependencies */
  ranges: Record<string, string>;
  peers: Record<string, string>;
}

/** Package metadata the override check needs; null when the registry could not answer. */
export interface RegistryLookup {
  /** Published versions of a package. */
  versions(name: string): Promise<string[] | null>;
  /** The ranges `name@version` asks for. */
  dependencies(name: string, version: string): Promise<PackageRanges | null>;
}

/** Version lists change; a published version's dependencies never do. */
const VERSIONS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED_ENTRIES = 20_000;
const COMMAND_TIMEOUT_MS = 20_000;
const MAX_PARALLEL_COMMANDS = 4;

/** Registry answers shared by all repositories, in the provider cache database next to scan snapshots. */
export class RegistryCache {
  private db: Database | null;

  constructor(root = DEFAULT_PROVIDER_CACHE_ROOT) {
    try {
      this.db = providerCacheDatabase(root);
      // Its own table, so older Codepulse versions keep reading the same database.
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS registry_metadata (key TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK (json_valid(payload)), fetched_at INTEGER NOT NULL);",
      );
    } catch {
      this.db = null;
    }
  }

  read(key: string, maxAgeMs = Number.POSITIVE_INFINITY): unknown {
    try {
      const row = this.db
        ?.query<{ payload: string; fetched_at: number }, [string]>(
          "SELECT payload, fetched_at FROM registry_metadata WHERE key = ?",
        )
        .get(key);
      return row && Date.now() - row.fetched_at <= maxAgeMs ? JSON.parse(row.payload) : undefined;
    } catch {
      return undefined;
    }
  }

  write(key: string, value: unknown): void {
    try {
      this.db
        ?.query("INSERT OR REPLACE INTO registry_metadata (key, payload, fetched_at) VALUES (?, ?, ?)")
        .run(key, JSON.stringify(value), Date.now());
      this.db
        ?.query(
          "DELETE FROM registry_metadata WHERE key IN (SELECT key FROM registry_metadata ORDER BY fetched_at DESC LIMIT -1 OFFSET ?)",
        )
        .run(MAX_CACHED_ENTRIES);
    } catch {}
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const ranges = (value: unknown): Record<string, string> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};

/**
 * Registry lookups through `pnpm view` (or `npm view`), so the project's and the user's `.npmrc` registries and
 * credentials apply. Null when neither tool can be spawned directly (Windows `.cmd` shims need a shell).
 */
export function createRegistryLookup(options: {
  runCommand: SnykCommandRunner;
  cwd: string;
  /** Repositories can point at different registries, so cached answers stay per repository (its cache hash). */
  scope: string;
  signal?: AbortSignal;
  which: (command: string) => string | null;
  cache: RegistryCache;
}): RegistryLookup | null {
  const tool = ["pnpm", "npm"].find(name => {
    const path = options.which(name);
    return path && !/\.(cmd|bat)$/i.test(path);
  });
  if (!tool) {
    addDebugEvent({
      source: "Snyk",
      message: "Override check skipped: pnpm or npm not found on PATH.",
      status: "info",
    });
    return null;
  }
  let running = 0;
  const waiting: (() => void)[] = [];
  const view = async (args: string[]): Promise<unknown> => {
    if (running >= MAX_PARALLEL_COMMANDS) await new Promise<void>(resolve => waiting.push(resolve));
    running++;
    try {
      const signals = [AbortSignal.timeout(COMMAND_TIMEOUT_MS), ...(options.signal ? [options.signal] : [])];
      const result = await options.runCommand([tool, "view", ...args, "--json"], {
        cwd: options.cwd,
        signal: AbortSignal.any(signals),
      });
      return result.exitCode === 0 && result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
    } catch {
      if (options.signal?.aborted) throw options.signal.reason;
      return undefined;
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
  const remembered = new Map<string, Promise<unknown>>();
  const lookup = (entry: string, maxAgeMs: number, load: () => Promise<unknown>) => {
    const key = `${options.scope}:${entry}`;
    let pending = remembered.get(key);
    if (!pending) {
      pending = (async () => {
        const cached = options.cache.read(key, maxAgeMs);
        if (cached !== undefined) return cached;
        const loaded = await load();
        if (loaded !== undefined) options.cache.write(key, loaded);
        return loaded;
      })();
      remembered.set(key, pending);
    }
    return pending;
  };
  return {
    async versions(name) {
      const value = await lookup(`versions:${name}`, VERSIONS_TTL_MS, () => view([name, "versions"]));
      if (typeof value === "string") return [value];
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;
    },
    async dependencies(name, version) {
      const value = await lookup(`manifest:${name}@${version}`, Number.POSITIVE_INFINITY, async () => {
        const manifest = await view([`${name}@${version}`]);
        // `view` of an exact version is one manifest; keep only what the check reads.
        return isRecord(manifest)
          ? {
              ranges: { ...ranges(manifest.optionalDependencies), ...ranges(manifest.dependencies) },
              peers: ranges(manifest.peerDependencies),
            }
          : undefined;
      });
      return isRecord(value) ? { ranges: ranges(value.ranges), peers: ranges(value.peers) } : null;
    },
  };
}
