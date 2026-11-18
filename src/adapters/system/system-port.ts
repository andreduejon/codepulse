/**
 * The terminal app's system port: the platform's browser opener and clipboard, the home folder, the process (to start
 * again on another repository) and the environment. Calls go through the modules at
 * call time, so a test's spy on one of their functions sees them.
 */
import type { SystemPort } from "../../core/system";
import * as clipboard from "./clipboard";
import * as browser from "./open-url";
import * as process from "./relaunch";
import * as environment from "./token-env";

export function terminalSystem(): SystemPort {
  return {
    openUrl: url => browser.openUrl(url),
    tokenSource: envVar => environment.getTokenSource(envVar),
    copyToClipboard: text => clipboard.copyToClipboard(text),
    homeDirectory: () => process.homeDirectory(),
    absolutePath: path => process.absolutePath(path),
    relaunch: repoPath => process.relaunch(repoPath),
  };
}
