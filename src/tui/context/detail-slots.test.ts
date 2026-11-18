import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { createAppState } from "./state";

test("the graph and the Dashboard keep their own details: tab, cursor and focus stay where each was left", () => {
  createRoot(dispose => {
    const { state, actions } = createAppState();
    actions.setActiveProviderView("github-actions");
    actions.setDetailActiveTab("github-actions");
    actions.setDetailCursorIndex(3);
    actions.setDetailFocused(true);

    actions.setActiveProviderView("dashboard");
    // The Dashboard's own: nothing of the graph's.
    expect(state.detailFocused()).toBe(false);
    actions.setDetailActiveTab("info");
    actions.setDetailCursorIndex(1);

    actions.setActiveProviderView("github-actions");
    expect(state.detailActiveTab()).toBe("github-actions");
    expect(state.detailCursorIndex()).toBe(3);
    expect(state.detailFocused()).toBe(true);

    actions.setActiveProviderView("dashboard");
    expect(state.detailActiveTab()).toBe("info");
    expect(state.detailCursorIndex()).toBe(1);
    dispose();
  });
});

test("one view's details can be reached by name while the other shows", () => {
  createRoot(dispose => {
    const { state, actions } = createAppState();
    actions.setActiveProviderView("dashboard");
    // A jump from the Dashboard opens the graph's details before the graph shows.
    actions.detailFor("graph").setDetailFocused(true);
    expect(state.detailFocused()).toBe(false);
    expect(state.detailFor("graph").detailFocused()).toBe(true);
    actions.setActiveProviderView("git");
    expect(state.detailFocused()).toBe(true);
    dispose();
  });
});

test("Git and the provider views share the graph's details", () => {
  createRoot(dispose => {
    const { state, actions } = createAppState();
    actions.setActiveProviderView("git");
    actions.setDetailCursorIndex(4);
    actions.setActiveProviderView("jenkins");
    expect(state.detailCursorIndex()).toBe(4);
    dispose();
  });
});
