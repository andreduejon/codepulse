export const PROVIDER_LIMIT_OPTIONS = [10, 20, 50] as const;
export type ProviderLimit = (typeof PROVIDER_LIMIT_OPTIONS)[number];
export const DEFAULT_PROVIDER_LIMIT: ProviderLimit = 20;

export const PROVIDER_AUTO_REFRESH_OPTIONS = ["off", "2m", "5m", "10m"] as const;
export const PROVIDER_AUTO_REFRESH_SECONDS = [0, 120, 300, 600] as const;
export type ProviderAutoRefreshSeconds = (typeof PROVIDER_AUTO_REFRESH_SECONDS)[number];
export const DEFAULT_PROVIDER_AUTO_REFRESH_SECONDS: ProviderAutoRefreshSeconds = 120;
export const PROVIDER_AUTO_REFRESH_MS: Record<(typeof PROVIDER_AUTO_REFRESH_OPTIONS)[number], number> = {
  off: 0,
  "2m": 120_000,
  "5m": 300_000,
  "10m": 600_000,
};
export const PROVIDER_MS_TO_LABEL: Record<number, string> = {
  0: "off",
  120000: "2m",
  300000: "5m",
  600000: "10m",
};

export function isProviderLimit(value: unknown): value is ProviderLimit {
  return value === 10 || value === 20 || value === 50;
}

export function isProviderAutoRefreshSeconds(value: unknown): value is ProviderAutoRefreshSeconds {
  return value === 0 || value === 120 || value === 300 || value === 600;
}

export function cycleProviderLimit(value: string): ProviderLimit {
  return value === "10" ? 10 : value === "50" ? 50 : 20;
}

export function cycleAutoRefreshSeconds(value: string): ProviderAutoRefreshSeconds {
  const ms = PROVIDER_AUTO_REFRESH_MS[value as keyof typeof PROVIDER_AUTO_REFRESH_MS] ?? 120_000;
  return ms === 0 ? 0 : ms === 300_000 ? 300 : ms === 600_000 ? 600 : 120;
}
