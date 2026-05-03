import type { GraphBadge } from "../provider";

export function collectTopSHAs(rows: readonly { commit: { hash: string } }[], limit: number): string[] {
  const shas: string[] = [];
  for (let i = 0; i < rows.length && shas.length < limit; i++) {
    shas.push(rows[i].commit.hash);
  }
  return shas;
}

export function collectRunningSHAs(badges: ReadonlyMap<string, GraphBadge>): string[] {
  const running: string[] = [];
  for (const [sha, badge] of badges) {
    if (badge.badge === "running") running.push(sha);
  }
  return running;
}
