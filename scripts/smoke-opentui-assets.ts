import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTreeSitterClient } from "@opentui/core";
import { GitHubCache } from "../src/providers/github-actions/cache";
import { JenkinsCache } from "../src/providers/jenkins/cache";
import { OpenShiftCache } from "../src/providers/openshift/cache";
import {
  CACHE_INACTIVITY_MS,
  cleanupInactiveProviderCaches,
  evictProviderCache,
  evictRepositoryCache,
  getProviderCacheSummary,
  resetAllCacheTimers,
  resetRepositoryCacheTimer,
} from "../src/providers/shared/cache-management";
import { closeProviderCaches, providerCacheDatabase } from "../src/providers/shared/sha-sqlite-cache";
import { SnykCache } from "../src/providers/snyk/cache";

const client = getTreeSitterClient();
const cacheRoot = await mkdtemp(join(tmpdir(), "codepulse-sqlite-smoke-"));

try {
  const result = await client.highlightOnce("const answer: number = 42;", "typescript");
  if (result.error || !result.highlights?.length) {
    throw new Error(result.error ?? "Tree-sitter returned no highlights");
  }
  console.log(`OpenTUI asset smoke test passed (${result.highlights.length} highlights)`);
  const sha = "a".repeat(40);
  const github = new GitHubCache({ root: cacheRoot });
  const jenkins = new JenkinsCache({ root: cacheRoot });
  const openshift = new OpenShiftCache({ root: cacheRoot });
  const snyk = new SnykCache({ root: cacheRoot });
  await github.write(cacheRoot, { sha, runs: [] });
  await jenkins.write(cacheRoot, { sha, runs: [] });
  await openshift.write(cacheRoot, { sha, builds: [] });
  const scan = {
    sha,
    scannedAt: new Date().toISOString(),
    counts: { critical: 0, high: 0, medium: 0, low: 0 },
    findings: [],
  };
  await snyk.write(cacheRoot, scan);
  assert.deepEqual(await github.read(cacheRoot, sha), { sha, runs: [] });
  assert.deepEqual(await jenkins.read(cacheRoot, sha), { sha, runs: [] });
  assert.deepEqual(await openshift.read(cacheRoot, sha), { sha, builds: [] });
  assert.deepEqual(await snyk.read(cacheRoot, sha), scan);
  let db = providerCacheDatabase(cacheRoot);
  assert.equal(db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version, 2);
  assert.equal(db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys, 1);
  const snapshots = db
    .query<{ id: number; provider: string }, []>("SELECT id, provider FROM snapshots ORDER BY provider")
    .all();
  assert.equal(snapshots.length, 4);
  assert.ok(snapshots.every(snapshot => Number.isSafeInteger(snapshot.id) && snapshot.id > 0));
  assert.equal(new Set(snapshots.map(snapshot => snapshot.id)).size, 4);

  await github.writeLog(cacheRoot, sha, "job-1", "GitHub log");
  await jenkins.writeLog(cacheRoot, sha, "build-1", "Jenkins log");
  await openshift.writeLog(cacheRoot, sha, "namespace", "build-1", "OpenShift log");
  await github.write(cacheRoot, { sha, runs: [] });
  await jenkins.write(cacheRoot, { sha, runs: [] });
  await openshift.write(cacheRoot, { sha, builds: [] });
  assert.deepEqual(
    db.query<{ id: number; provider: string }, []>("SELECT id, provider FROM snapshots ORDER BY provider").all(),
    snapshots,
  );
  assert.equal(await github.readLog(cacheRoot, sha, "job-1"), "GitHub log");
  assert.equal(await jenkins.readLog(cacheRoot, sha, "build-1"), "Jenkins log");
  assert.equal(await openshift.readLog(cacheRoot, sha, "namespace", "build-1"), "OpenShift log");
  assert.equal(
    db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM artifacts WHERE kind = 'log'").get()?.count,
    3,
  );
  closeProviderCaches(cacheRoot);
  assert.deepEqual(await github.read(cacheRoot, sha), { sha, runs: [] });
  assert.deepEqual(await jenkins.read(cacheRoot, sha), { sha, runs: [] });
  assert.deepEqual(await openshift.read(cacheRoot, sha), { sha, builds: [] });
  assert.deepEqual(await snyk.read(cacheRoot, sha), scan);
  assert.equal(await github.readLog(cacheRoot, sha, "job-1"), "GitHub log");
  assert.equal(await jenkins.readLog(cacheRoot, sha, "build-1"), "Jenkins log");
  assert.equal(await openshift.readLog(cacheRoot, sha, "namespace", "build-1"), "OpenShift log");
  db = providerCacheDatabase(cacheRoot);
  assert.equal(db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys, 1);

  const githubSnapshot = snapshots.find(snapshot => snapshot.provider === github.provider);
  assert.ok(githubSnapshot);
  db.query("DELETE FROM snapshots WHERE id = ?").run(githubSnapshot.id);
  assert.equal(
    db
      .query<{ count: number }, [number]>("SELECT COUNT(*) AS count FROM artifacts WHERE snapshot_id = ?")
      .get(githubSnapshot.id)?.count,
    0,
  );
  assert.equal(await github.readLog(cacheRoot, sha, "job-1"), null);
  assert.equal(await github.read(cacheRoot, sha), null);
  assert.deepEqual(await jenkins.read(cacheRoot, sha), { sha, runs: [] });
  assert.deepEqual(await openshift.read(cacheRoot, sha), { sha, builds: [] });
  assert.deepEqual(await snyk.read(cacheRoot, sha), scan);
  assert.equal(await jenkins.readLog(cacheRoot, sha, "build-1"), "Jenkins log");
  assert.equal(await openshift.readLog(cacheRoot, sha, "namespace", "build-1"), "OpenShift log");

  const missingSha = "b".repeat(40);
  await github.writeLog(cacheRoot, sha, "job-1", "Do not recreate snapshot");
  await jenkins.writeLog(cacheRoot, missingSha, "build-1", "Do not persist orphan");
  await openshift.writeLog(cacheRoot, missingSha, "namespace", "build-1", "Do not persist orphan");
  assert.equal(await github.readLog(cacheRoot, sha, "job-1"), null);
  assert.equal(await jenkins.readLog(cacheRoot, missingSha, "build-1"), null);
  assert.equal(await openshift.readLog(cacheRoot, missingSha, "namespace", "build-1"), null);
  assert.equal(await github.read(cacheRoot, sha), null);
  assert.equal(await jenkins.read(cacheRoot, missingSha), null);
  assert.equal(await openshift.read(cacheRoot, missingSha), null);
  assert.equal(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM snapshots").get()?.count, 3);
  assert.equal(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM artifacts").get()?.count, 2);
  const summary = getProviderCacheSummary(cacheRoot);
  assert.equal(summary.groups.length, 3);
  const repoHash = summary.groups[0]?.repoHash;
  assert.ok(repoHash);
  const now = Date.now();
  const oldAccess = now - CACHE_INACTIVITY_MS - 1;
  db.query("UPDATE snapshots SET accessed_at = ?, cleanup_reset_at = 0").run(oldAccess);
  assert.equal(resetRepositoryCacheTimer(repoHash, cacheRoot, now), 1);
  assert.ok(
    getProviderCacheSummary(cacheRoot).groups.every(
      group => group.lastAccessed === oldAccess && group.cleanupAt === now + CACHE_INACTIVITY_MS,
    ),
  );
  assert.equal(cleanupInactiveProviderCaches(cacheRoot, now), 0);
  assert.equal(resetAllCacheTimers(cacheRoot, now), 1);
  assert.deepEqual(evictProviderCache(repoHash, "jenkins", cacheRoot), { snapshotCount: 1, artifactCount: 1 });
  assert.equal(getProviderCacheSummary(cacheRoot).groups.length, 2);
  const otherRepo = join(cacheRoot, "other-repository");
  await github.write(otherRepo, { sha, runs: [] });
  await github.writeLog(otherRepo, sha, "job", "protected log");
  assert.deepEqual(evictRepositoryCache(repoHash, cacheRoot), { snapshotCount: 2, artifactCount: 1 });
  assert.equal(getProviderCacheSummary(cacheRoot).groups.length, 1);
  assert.equal(await github.readLog(otherRepo, sha, "job"), "protected log");
  db.query("UPDATE snapshots SET accessed_at = ?").run(oldAccess);
  db.query("UPDATE snapshots SET cleanup_reset_at = 0").run();
  assert.equal(cleanupInactiveProviderCaches(cacheRoot, now), 1);
  assert.equal(getProviderCacheSummary(cacheRoot).groups.length, 0);
  assert.equal(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM artifacts").get()?.count, 0);
  console.log("SQLite provider cache smoke test passed (four providers, log artifacts, upsert, reopen, cascade)");
  console.log(
    "Cache management smoke passed (summary, timer resets, targeted provider/repository eviction, 90-day cleanup)",
  );
} finally {
  closeProviderCaches(cacheRoot);
  await rm(cacheRoot, { recursive: true, force: true });
  await client.destroy();
}
