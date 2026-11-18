import { expect, test } from "bun:test";
import { benchHistory, newestSubject } from "./repo";

test("a bench history has about the commits asked for, merges, tags, and refs that name its commits", () => {
  const spec = benchHistory("big", 2_000, 30 * 86_400_000);
  const keys = new Set(spec.commits.map(commit => commit.key));
  expect(keys.size).toBe(spec.commits.length);
  expect(spec.commits.length).toBeGreaterThanOrEqual(1_990);
  expect(spec.commits.length).toBeLessThanOrEqual(2_000);
  expect(spec.commits.filter(commit => commit.parents.length > 1).length).toBeGreaterThan(200);
  for (const commit of spec.commits) for (const parent of commit.parents) expect(keys.has(parent)).toBe(true);
  for (const key of Object.values(spec.refs)) expect(keys.has(key)).toBe(true);
  expect(spec.tags?.length).toBeGreaterThan(0);
  // The newest commit is the last, so it shows first in the graph.
  const newest = spec.commits.at(-1);
  expect(newest?.subject).toBe(newestSubject("big"));
  expect(Math.min(...spec.commits.map(commit => commit.ago))).toBe(newest?.ago ?? Number.NaN);
});
