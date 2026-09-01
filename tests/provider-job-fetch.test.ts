import { beforeEach, describe, expect, test } from "bun:test";
import { clearDebugEvents, getDebugEvents } from "../src/debug/events";
import { fetchProviderJobs } from "../src/providers/shared/provider-job-fetch";

describe("fetchProviderJobs", () => {
  beforeEach(clearDebugEvents);

  test("returns provider-classified errors without duplicate debug logging", async () => {
    const ctrl = new AbortController();
    const outcome = await fetchProviderJobs(
      async () => ({ jobs: [], error: "GitHub jobs failed." }),
      ctrl.signal,
      "GitHub",
    );

    expect(outcome).toEqual({ kind: "result", jobs: [], error: "GitHub jobs failed." });
    expect(getDebugEvents()).toEqual([]);
  });

  test("logs unexpected rejections and returns unavailable state", async () => {
    const ctrl = new AbortController();
    const outcome = await fetchProviderJobs(
      async () => {
        throw new Error("Jobs HTTP 502");
      },
      ctrl.signal,
      "GitHub",
    );

    expect(outcome).toEqual({ kind: "rejected", jobs: [], error: "Unavailable" });
    expect(getDebugEvents()).toMatchObject([{ source: "GitHub", status: "error", message: "Jobs HTTP 502" }]);
  });

  test("keeps cancellation silent", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const outcome = await fetchProviderJobs(
      async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      },
      ctrl.signal,
      "Jenkins",
    );

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(getDebugEvents()).toEqual([]);
  });

  test("allows a successful retry after rejection", async () => {
    const ctrl = new AbortController();
    let attempt = 0;
    const fetcher = async () => {
      attempt++;
      if (attempt === 1) throw new Error("temporary failure");
      return { jobs: [{ id: "job-1" }], error: null };
    };

    expect((await fetchProviderJobs(fetcher, ctrl.signal, "Jenkins")).kind).toBe("rejected");
    expect(await fetchProviderJobs(fetcher, ctrl.signal, "Jenkins")).toEqual({
      kind: "result",
      jobs: [{ id: "job-1" }],
      error: null,
    });
  });
});
