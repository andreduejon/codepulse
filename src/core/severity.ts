/** How severe a finding is, as scan and quality providers rate it (Snyk's, a new scanner's), and counts of each. */
export type Severity = "critical" | "high" | "medium" | "low";

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}
