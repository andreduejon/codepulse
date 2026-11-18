import { expect, test } from "bun:test";
import { cachedBuildToResource, isOpenShiftCacheEntry } from "./merge";

const SHA = "a".repeat(40);

test("a build cached as failed before cancelled was its own status reads as cancelled from its saved object", () => {
  const resource = cachedBuildToResource({
    id: "Build:shop-dev:shop-api-13",
    name: "shop-api-13",
    namespace: "shop-dev",
    status: "fail",
    imageRefs: [],
    commitSha: SHA,
    object: { status: { phase: "Cancelled" } },
  });
  expect(resource.status).toBe("cancelled");
  expect(resource.cacheOnly).toBe(true);
});

test("a cache entry may hold a cancelled build", () => {
  const build = { id: "b", name: "b", namespace: "ns", status: "cancelled", imageRefs: [], commitSha: SHA };
  expect(isOpenShiftCacheEntry({ sha: SHA, builds: [build] })).toBe(true);
});
