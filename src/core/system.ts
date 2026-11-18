/** The machine around the app: the browser, the clipboard, the home folder, the process, and the environment. */
export interface SystemPort {
  /** Opens an http(s) address in the browser; anything else, or no address, does nothing. */
  openUrl: (url: string | undefined) => void;
  /** Whether a token is set in its environment variable (`env`), for the Menu to say where it comes from. */
  tokenSource: (envVar: string) => "env" | null;
  /** Copies text to the clipboard; false when the platform has no tool for it. */
  copyToClipboard: (text: string) => boolean;
  /** The user's home folder, for `~` in paths typed or shown. */
  homeDirectory: () => string;
  /** A typed path made absolute, against the folder codepulse started in. */
  absolutePath: (path: string) => string;
  /** Starts codepulse again on another repository in place of this one; call it once the screen is given back. */
  relaunch: (repoPath: string) => Promise<void>;
}
