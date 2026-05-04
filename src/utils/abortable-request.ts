export interface AbortableRequestState {
  currentId: number;
  abortCtrl: AbortController | null;
}

export interface AbortableRequestToken {
  id: number;
  controller: AbortController;
}

export function startAbortableRequest(state: AbortableRequestState): AbortableRequestToken {
  state.abortCtrl?.abort();
  const controller = new AbortController();
  state.abortCtrl = controller;
  state.currentId += 1;
  return { id: state.currentId, controller };
}

export function isActiveAbortableRequest(state: AbortableRequestState, request: AbortableRequestToken): boolean {
  return state.currentId === request.id && state.abortCtrl === request.controller && !request.controller.signal.aborted;
}

export function finishAbortableRequest(state: AbortableRequestState, request: AbortableRequestToken): void {
  if (state.abortCtrl === request.controller) {
    state.abortCtrl = null;
  }
}

export function abortActiveRequest(state: AbortableRequestState): void {
  state.abortCtrl?.abort();
  state.abortCtrl = null;
}
