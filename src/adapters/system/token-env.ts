/** Whether a provider's token is set in its environment variable (the menu shows where the token comes from). */

/**
 * Determine whether a token is available for display purposes.
 *
 * @returns `"env"` when the env var is set, or `null` when no token is available.
 */
export function getTokenSource(envVarName: string): "env" | null {
  const envVal = process.env[envVarName];
  return envVal?.trim() ? "env" : null;
}
