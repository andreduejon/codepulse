/** Rows every provider's Menu section can use. */
import type { SettingItem } from "../../hooks/menu-items-types";

const isValidEnvVarName = (value: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);

/**
 * The `Token` row every provider shares. It holds the name of an environment variable (never the secret): the
 * draft must be a valid name, an empty value falls back to the provider's default (`GITHUB_TOKEN`, …), and the row
 * is valid once that variable is set.
 */
export function tokenVariableItem(opts: {
  current: string;
  fallback: string;
  save: (name: string) => void;
  /** Whether the variable is set (the system port answers; the menu never reads the environment itself). */
  isSet: () => boolean;
}): SettingItem {
  return {
    kind: "editable",
    label: "Token",
    placeholder: "Enter variable name...",
    get: () => opts.current,
    set: value => opts.save(value.trim() || opts.fallback),
    valid: () => isValidEnvVarName(opts.current) && opts.isSet(),
    isDraftValid: value => isValidEnvVarName(value.trim() || opts.fallback),
  };
}
