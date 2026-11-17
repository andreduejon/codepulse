/** The machine around the app: the browser, and where a provider's token comes from. */
export interface SystemPort {
  /** Opens an http(s) address in the browser; anything else, or no address, does nothing. */
  openUrl: (url: string | undefined) => void;
  /** Whether a token is set in its environment variable (`env`), for the Menu to say where it comes from. */
  tokenSource: (envVar: string) => "env" | null;
}
