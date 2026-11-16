/** The dashboard's settings, per repository: whether it shows, how far back it reads, and how long one knot is. */
export const DASHBOARD_WINDOW_DAYS = [1, 3, 7, 10, 30] as const;
export type DashboardWindowDays = (typeof DASHBOARD_WINDOW_DAYS)[number];
export const DASHBOARD_KNOT_MINUTES = [15, 30, 60, 120, 240] as const;
export type DashboardKnotMinutes = (typeof DASHBOARD_KNOT_MINUTES)[number];

export interface DashboardSettings {
  /** Off: no Dashboard tab, and the repository can't start in it. On by default. */
  enabled: boolean;
  windowDays: DashboardWindowDays;
  knotMinutes: DashboardKnotMinutes;
}

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = { enabled: true, windowDays: 7, knotMinutes: 60 };

export function dashboardSettings(raw: Partial<DashboardSettings> = {}): DashboardSettings {
  return {
    enabled: raw.enabled ?? DEFAULT_DASHBOARD_SETTINGS.enabled,
    windowDays: raw.windowDays ?? DEFAULT_DASHBOARD_SETTINGS.windowDays,
    knotMinutes: raw.knotMinutes ?? DEFAULT_DASHBOARD_SETTINGS.knotMinutes,
  };
}

export const windowDaysLabel = (days: DashboardWindowDays): string => `${days}d`;
export const knotMinutesLabel = (minutes: DashboardKnotMinutes): string =>
  minutes < 60 ? `${minutes}m` : `${minutes / 60}h`;
