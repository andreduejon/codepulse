/**
 * The cache store for the components below the app (the cache screen). The app provides the one it was started with;
 * without a provider (a component's own test) it is the providers' SQLite cache.
 */
import { createContext, useContext } from "solid-js";
import type { CacheStorePort } from "../core/cache-store";
import { providerCacheStore } from "../providers/shared/cache-store";

export const CacheStoreContext = createContext<CacheStorePort>(providerCacheStore());

export const useCacheStore = (): CacheStorePort => useContext(CacheStoreContext);
