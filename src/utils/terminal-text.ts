// CSI (colors, cursor moves), OSC (title, hyperlinks, clipboard), other ESC sequences, and C0 controls except tab/newline.
const TERMINAL_CONTROLS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the purpose.
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[ -/]*[0-~]?|[\x00-\x08\x0b-\x1f\x7f]/g;

/** Remove terminal escape/control sequences from remote text (CI and pod logs) before display. */
export function stripTerminalControls(text: string): string {
  return text.replace(TERMINAL_CONTROLS, "");
}
