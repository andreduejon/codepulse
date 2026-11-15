/**
 * What one provider's cache sync came to: what the dashboard asks about apps that are not open. Each provider asks
 * about the commits its view would ask about, and writes what finished into its normal cache.
 */
export interface CacheSyncResult {
  /** The provider's own message, or null when the sync worked or had nothing to ask. */
  error: string | null;
  /** The token was refused: asking again needs the user to reload. */
  authFailed: boolean;
}

export const SYNC_OK: CacheSyncResult = { error: null, authFailed: false };

export function syncFailed(error: string | null, tokenExpired: string): CacheSyncResult {
  return { error, authFailed: error === tokenExpired };
}
