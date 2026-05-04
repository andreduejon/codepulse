import { describe, expect, test } from "bun:test";
import {
  type AbortableRequestState,
  abortActiveRequest,
  finishAbortableRequest,
  isActiveAbortableRequest,
  startAbortableRequest,
} from "../src/utils/abortable-request";

describe("abortable-request", () => {
  test("starting new request aborts old request", () => {
    const state: AbortableRequestState = { currentId: 0, abortCtrl: null };
    const first = startAbortableRequest(state);
    const second = startAbortableRequest(state);

    expect(first.controller.signal.aborted).toBe(true);
    expect(second.controller.signal.aborted).toBe(false);
    expect(isActiveAbortableRequest(state, first)).toBe(false);
    expect(isActiveAbortableRequest(state, second)).toBe(true);
  });

  test("finishing stale request does not clear active controller", () => {
    const state: AbortableRequestState = { currentId: 0, abortCtrl: null };
    const first = startAbortableRequest(state);
    const second = startAbortableRequest(state);

    finishAbortableRequest(state, first);
    expect(state.abortCtrl).toBe(second.controller);
    expect(isActiveAbortableRequest(state, second)).toBe(true);
  });

  test("abortActiveRequest clears and aborts current controller", () => {
    const state: AbortableRequestState = { currentId: 0, abortCtrl: null };
    const request = startAbortableRequest(state);

    abortActiveRequest(state);

    expect(request.controller.signal.aborted).toBe(true);
    expect(state.abortCtrl).toBeNull();
    expect(isActiveAbortableRequest(state, request)).toBe(false);
  });
});
