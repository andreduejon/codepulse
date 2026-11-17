/**
 * The cache store for the components below the app (the cache screen). The app provides the one it was started with;
 * without a provider (a component's own test) it is the registered one (context/ports.ts).
 */

import { createContext, useContext } from "solid-js";
import type { CacheStorePort } from "../core/cache-store";
import { defaultPorts } from "./ports";

export const CacheStoreContext = createContext<CacheStorePort | undefined>(undefined);

export const useCacheStore = (): CacheStorePort => useContext(CacheStoreContext) ?? defaultPorts().cacheStore;
