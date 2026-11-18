/**
 * The settings port for the components below the app (the menu, the project list, the cache screen). The app provides
 * the one it was started with; without a provider (a component's own test) it is the registered one (context/ports.ts).
 */

import { createContext, useContext } from "solid-js";
import type { SettingsPort } from "../../core/settings/port";
import { defaultPorts } from "./ports";

export const SettingsContext = createContext<SettingsPort | undefined>(undefined);

export const useSettings = (): SettingsPort => useContext(SettingsContext) ?? defaultPorts().settings;
