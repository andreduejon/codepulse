/**
 * The ports a component uses when nothing above it gave any (a component rendered on its own, in a test): the ones
 * the composition root registered when it started (startupProps), or the test preload's. The UI never builds an
 * adapter itself.
 */
import type { AppPorts } from "../../core/app-ports";

let defaults: AppPorts | undefined;

/** The root registers the ports the app runs on. */
export function setDefaultPorts(ports: AppPorts): void {
  defaults = ports;
}

export function defaultPorts(): AppPorts {
  if (!defaults)
    throw new Error("No ports: start the app through startupProps, or register them with setDefaultPorts.");
  return defaults;
}

/** The ports given, the registered ones for the others. */
export function resolvePorts(given: Partial<AppPorts>): AppPorts {
  const fallback = () => defaultPorts();
  return {
    settings: given.settings ?? fallback().settings,
    git: given.git ?? fallback().git,
    cacheStore: given.cacheStore ?? fallback().cacheStore,
    providers: given.providers ?? fallback().providers,
    system: given.system ?? fallback().system,
    dashboard: given.dashboard ?? fallback().dashboard,
  };
}
