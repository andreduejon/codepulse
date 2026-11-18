import {
  DASHBOARD_KNOT_MINUTES,
  DASHBOARD_WINDOW_DAYS,
  type DashboardSettings,
  knotMinutesLabel,
  windowDaysLabel,
} from "../../core/dashboard-settings";
import type { SettingItem } from "./menu-items-types";

/** The dashboard's own section: whether it shows, how far back it reads and how long one knot is. Each saves at once. */
export function buildDashboardItems(cfg: DashboardSettings, save: (next: DashboardSettings) => void): SettingItem[] {
  const next = <T>(options: readonly T[], label: (value: T) => string, chosen: string, fallback: T): T =>
    options.find(option => label(option) === chosen) ?? fallback;
  const items: SettingItem[] = [
    { kind: "header", label: "Dashboard" },
    { kind: "toggle", label: "Enabled", get: () => cfg.enabled, set: enabled => save({ ...cfg, enabled }) },
  ];
  if (!cfg.enabled) return items;
  return [
    ...items,
    {
      kind: "cycle",
      label: "Time window",
      options: DASHBOARD_WINDOW_DAYS.map(windowDaysLabel),
      get: () => windowDaysLabel(cfg.windowDays),
      set: value => save({ ...cfg, windowDays: next(DASHBOARD_WINDOW_DAYS, windowDaysLabel, value, cfg.windowDays) }),
    },
    {
      kind: "cycle",
      label: "Knot size",
      options: DASHBOARD_KNOT_MINUTES.map(knotMinutesLabel),
      get: () => knotMinutesLabel(cfg.knotMinutes),
      set: value =>
        save({ ...cfg, knotMinutes: next(DASHBOARD_KNOT_MINUTES, knotMinutesLabel, value, cfg.knotMinutes) }),
    },
  ];
}
