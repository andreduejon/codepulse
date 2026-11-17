/**
 * The system port for the components below the app (opening a run in the browser, the Menu's token source). The app
 * provides the one it was started with; without a provider (a component's own test) it is the registered one.
 */
import { createContext, useContext } from "solid-js";
import type { SystemPort } from "../core/system";
import { defaultPorts } from "./ports";

export const SystemContext = createContext<SystemPort | undefined>(undefined);

export const useSystem = (): SystemPort => useContext(SystemContext) ?? defaultPorts().system;
