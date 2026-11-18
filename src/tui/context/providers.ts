/**
 * The app's provider set for the components below it: each provider's name, tabs and settings. The app provides the
 * one it was started with; without a provider (a component's own test) it is the registered one.
 */
import { createContext, useContext } from "solid-js";
import type { ProviderSet } from "../../core/provider-set";
import { defaultPorts } from "./ports";

export const ProvidersContext = createContext<ProviderSet | undefined>(undefined);

export const useProviderSet = (): ProviderSet => useContext(ProvidersContext) ?? defaultPorts().providers;
