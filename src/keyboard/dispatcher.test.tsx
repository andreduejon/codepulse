import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { useKeys } from "./dispatcher";

function Keys(props: {
  name: string;
  seen: string[];
  modal?: boolean;
  onKey?: (name: string, stop: () => void) => void;
}) {
  useKeys(
    event => {
      props.seen.push(`${props.name}:${event.name}`);
      props.onKey?.(event.name, () => event.stopPropagation());
    },
    { modal: props.modal },
  );
  return null;
}

test("the newest handler sees a key first; a modal one keeps it from those below until it closes", async () => {
  const seen: string[] = [];
  const [open, setOpen] = createSignal(true);
  const setup = await testRender(
    () => (
      <>
        <Keys name="app" seen={seen} />
        <Show when={open()}>
          <Keys name="dialog" seen={seen} modal onKey={name => name === "q" && setOpen(false)} />
        </Show>
      </>
    ),
    { width: 40, height: 10 },
  );
  try {
    await setup.flush();
    setup.mockInput.pressKey("j");
    // The dialog closes on this key: it is still the dialog's, not the app's too.
    setup.mockInput.pressKey("q");
    await setup.flush();
    setup.mockInput.pressKey("k");
    expect(seen).toEqual(["dialog:j", "dialog:q", "app:k"]);
  } finally {
    setup.renderer.destroy();
  }
});

test("a handler removed while a key is handled doesn't see that key", async () => {
  const seen: string[] = [];
  const [panel, setPanel] = createSignal(true);
  const setup = await testRender(
    () => (
      <>
        <Show when={panel()}>
          <Keys name="panel" seen={seen} />
        </Show>
        {/* Mounted later, so it sees keys first: x closes the panel below it. */}
        <Keys name="overlay" seen={seen} onKey={name => name === "x" && setPanel(false)} />
      </>
    ),
    { width: 40, height: 10 },
  );
  try {
    await setup.flush();
    setup.mockInput.pressKey("a");
    setup.mockInput.pressKey("x");
    expect(seen).toEqual(["overlay:a", "panel:a", "overlay:x"]);
  } finally {
    setup.renderer.destroy();
  }
});

test("a handler that stops a key keeps it from the handlers below", async () => {
  const seen: string[] = [];
  const setup = await testRender(
    () => (
      <>
        <Keys name="first" seen={seen} />
        <Keys name="second" seen={seen} onKey={(name, stop) => name === "x" && stop()} />
        <Keys name="third" seen={seen} />
      </>
    ),
    { width: 40, height: 10 },
  );
  try {
    await setup.flush();
    setup.mockInput.pressKey("a");
    setup.mockInput.pressKey("x");
    expect(seen).toEqual(["third:a", "second:a", "first:a", "third:x", "second:x"]);
  } finally {
    setup.renderer.destroy();
  }
});
