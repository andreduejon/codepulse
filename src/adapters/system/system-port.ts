/**
 * The terminal app's system port: the platform's browser opener and the environment. Calls go through the modules at
 * call time, so a test's spy on one of their functions sees them.
 */
import type { SystemPort } from "../../core/system";
import * as browser from "./open-url";
import * as environment from "./token-env";

export function terminalSystem(): SystemPort {
  return {
    openUrl: url => browser.openUrl(url),
    tokenSource: envVar => environment.getTokenSource(envVar),
  };
}
