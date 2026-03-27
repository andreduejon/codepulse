const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Cache for formatRelativeDate — avoids repeated Date parsing and arithmetic.
// Entries are keyed by date string. When the cache exceeds MAX entries,
// the oldest half is evicted (Map preserves insertion order) to avoid
// cliff-eviction where the entire cache is lost at once.
const dateFormatCache = new Map<string, { result: string; cachedAt: number; isStable: boolean }>();
const DATE_CACHE_MAX = 1000;
// Recent dates (< 7 days) produce relative text ("5m ago") that needs periodic refresh
const DATE_CACHE_RECENT_TTL = 60_000;

/** Evict the oldest half of entries when the cache is full. */
function evictDateCache(): void {
  const evictCount = Math.floor(dateFormatCache.size / 2);
  let removed = 0;
  for (const key of dateFormatCache.keys()) {
    if (removed >= evictCount) break;
    dateFormatCache.delete(key);
    removed++;
  }
}

/**
 * Format a date string as a human-friendly relative or absolute date.
 *
 * Recent dates: "just now", "5m ago", "3h ago", "Yesterday", "4d ago"
 * Older dates (same year): "15. Jun 10:30"
 * Older dates (different year): "15. Jun 2023"
 *
 * Results are cached; stable dates (>7 days) are cached permanently,
 * recent dates are refreshed every 60 seconds.
 */
export function formatRelativeDate(dateStr: string): string {
  if (!dateStr) return "";

  const now = Date.now();
  const cached = dateFormatCache.get(dateStr);
  if (cached) {
    // Stable dates (>7 days old) never change — always return cached
    if (cached.isStable) return cached.result;
    // Recent dates need periodic refresh for relative text accuracy
    if (now - cached.cachedAt < DATE_CACHE_RECENT_TTL) return cached.result;
  }

  const date = new Date(dateStr);
  const nowDate = new Date(now);
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  let result: string;
  let isStable = false;

  if (diffMins < 1) result = "just now";
  else if (diffHours < 1) result = `${diffMins}m ago`;
  else if (diffDays < 1) result = `${diffHours}h ago`;
  else if (diffDays === 1) result = "Yesterday";
  else if (diffDays < 7) result = `${diffDays}d ago`;
  else {
    isStable = true; // Absolute format — won't change on subsequent calls
    const day = String(date.getDate()).padStart(2, "0");
    const month = MONTHS[date.getMonth()];
    const hours = String(date.getHours()).padStart(2, "0");
    const mins = String(date.getMinutes()).padStart(2, "0");

    if (date.getFullYear() === nowDate.getFullYear()) {
      result = `${day}. ${month} ${hours}:${mins}`;
    } else {
      result = `${day}. ${month} ${date.getFullYear()}`;
    }
  }

  // Evict oldest entries if cache is full
  if (dateFormatCache.size >= DATE_CACHE_MAX) {
    evictDateCache();
  }
  dateFormatCache.set(dateStr, { result, cachedAt: now, isStable });
  return result;
}
