import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoot } from "solid-js";
import { createAppState } from "../src/context/state";
import { clearDebugEvents, getDebugEvents } from "../src/debug/events";
import { useGitHubCI } from "../src/providers/github-actions/use-github-ci";

test("unsupported GraphQL jobs stay disabled while runs and REST expansion still work", async () => {
  const approvedTemp = join(tmpdir(), "opencode");
  const cacheRoot = mkdtempSync(join(existsSync(approvedTemp) ? approvedTemp : tmpdir(), "codepulse-github-hook-"));
  const tokenEnvVar = "CODEPULSE_GITHUB_HOOK_TEST_TOKEN";
  const originalToken = process.env[tokenEnvVar];
  const originalFetch = globalThis.fetch;
  const shas = ["a".repeat(40), "b".repeat(40)];
  const queries: string[] = [];
  const urls: string[] = [];
  const schemaError = "Field jobs does not exist on type WorkFloRun";
  let dispose: (() => void) | undefined;
  try {
    process.env[tokenEnvVar] = "test-token";
    clearDebugEvents();
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url === "https://api.github.com/graphql") {
        const { query } = JSON.parse(String(init?.body));
        queries.push(query);
        if (queries.length === 1) {
          return Response.json({ errors: Array.from({ length: 10 }, () => ({ message: schemaError })) });
        }
        const index = query.includes(shas[0]) ? 0 : 1;
        return Response.json({
          data: {
            repository: {
              c0: {
                oid: shas[index],
                checkSuites: {
                  nodes: [
                    {
                      status: "COMPLETED",
                      conclusion: "SUCCESS",
                      workflowRun: {
                        databaseId: index + 1,
                        runNumber: index + 1,
                        event: "push",
                        createdAt: "2026-01-01T00:00:00Z",
                        updatedAt: "2026-01-01T00:01:00Z",
                        workflow: { name: "CI" },
                      },
                    },
                  ],
                },
              },
            },
          },
        });
      }
      if (url === "https://api.github.com/repos/owner/repo/actions/runs/1/jobs?per_page=100") {
        return Response.json({
          jobs: [{ id: 10, name: "build", status: "completed", conclusion: "success", steps: [] }],
        });
      }
      throw new Error(`Unexpected network request: ${url}`);
    }) as typeof fetch;
    const { ci, state } = createRoot(rootDispose => {
      dispose = rootDispose;
      const { state, actions } = createAppState(100, 0, 0);
      actions.setRepoPath(cacheRoot);
      actions.setRemoteUrl("https://github.com/owner/repo.git");
      const ci = useGitHubCI({
        state,
        actions,
        config: { enabled: true, tokenEnvVar, autoRefreshSeconds: 0 },
        cacheRoot,
      });
      return { ci, state };
    });
    expect(ci.isAvailable()).toBe(true);
    await ci.fetchCommitDataForSHA(shas[0], true);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain("jobs(first:");
    expect(queries[1]).not.toContain("jobs(");
    expect(queries[0]).toContain(shas[0]);
    expect(queries[1]).toContain(shas[0]);
    await ci.fetchCommitDataForSHA(shas[1], true);
    expect(queries).toHaveLength(3);
    expect(queries[2]).not.toContain("jobs(");
    expect(queries[2]).toContain(shas[1]);
    for (const [index, sha] of shas.entries()) {
      expect(ci.getCommitData(sha)?.runs).toHaveLength(1);
      expect(ci.getCommitData(sha)?.runs[0]).toMatchObject({
        id: index + 1,
        headSha: sha,
        name: "CI",
        status: "completed",
        conclusion: "success",
      });
    }
    expect(state.providerStatusFor("github-actions")).toEqual({ kind: "idle" });
    const run = ci.getCommitData(shas[0])?.runs[0];
    if (!run) throw new Error("Expected workflow run for REST job expansion");
    expect(await ci.fetchJobsForRun(run)).toEqual({
      jobs: [expect.objectContaining({ id: 10, name: "build", status: "completed", conclusion: "success" })],
      error: null,
    });
    expect(urls).toEqual([
      ...Array(3).fill("https://api.github.com/graphql"),
      "https://api.github.com/repos/owner/repo/actions/runs/1/jobs?per_page=100",
    ]);
    const events = getDebugEvents();
    expect(events.filter(event => event.status === "info")).toEqual([
      expect.objectContaining({
        source: "GitHub",
        status: "info",
        message: "GraphQL workflow jobs unavailable. Using REST on expand.",
      }),
    ]);
    expect(events.filter(event => event.source === "error" || event.status === "error")).toEqual([]);
    expect(events.some(event => event.message.includes(schemaError))).toBe(false);
  } finally {
    dispose?.();
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env[tokenEnvVar];
    else process.env[tokenEnvVar] = originalToken;
    clearDebugEvents();
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});
