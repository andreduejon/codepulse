/**
 * The terminal's provider modules (providers/module.ts): each provider's colors, Menu rows, detail tabs and graph
 * columns. The root lists them once (src/providers.ts) and registers them; the app provides them to the components
 * below it, and a component rendered on its own (a test) reads the registered ones.
 */
import { createContext, useContext } from "solid-js";
import type { AnyProviderModule } from "../providers/module";

let defaults: readonly AnyProviderModule[] | undefined;

/** The root registers the modules the app runs with. */
export function setDefaultProviderModules(modules: readonly AnyProviderModule[]): void {
  defaults = modules;
}

export function defaultProviderModules(): readonly AnyProviderModule[] {
  if (!defaults) throw new Error("No provider modules: start the app through startupProps, or register them first.");
  return defaults;
}

export const ProviderModulesContext = createContext<readonly AnyProviderModule[] | undefined>(undefined);

export const useProviderModules = (): readonly AnyProviderModule[] =>
  useContext(ProviderModulesContext) ?? defaultProviderModules();

/** A provider's module by its view or a tab it has. */
export const moduleOf = (modules: readonly AnyProviderModule[], view: string): AnyProviderModule | undefined =>
  modules.find(module => module.definition.id === view);
