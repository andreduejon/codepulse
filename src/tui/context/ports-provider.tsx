/** Gives the components below the app's ports: every screen reads Git, the settings, the cache and the system here. */
import type { JSX } from "solid-js";
import type { AppPorts } from "../../core/app-ports";
import { CacheStoreContext } from "./cache-store";
import { GitContext } from "./git";
import { ProvidersContext } from "./providers";
import { SettingsContext } from "./settings";
import { SystemContext } from "./system";

export function PortsProvider(props: { ports: AppPorts; children: JSX.Element }) {
  return (
    <SettingsContext.Provider value={props.ports.settings}>
      <GitContext.Provider value={props.ports.git}>
        <SystemContext.Provider value={props.ports.system}>
          <CacheStoreContext.Provider value={props.ports.cacheStore}>
            <ProvidersContext.Provider value={props.ports.providers}>{props.children}</ProvidersContext.Provider>
          </CacheStoreContext.Provider>
        </SystemContext.Provider>
      </GitContext.Provider>
    </SettingsContext.Provider>
  );
}
