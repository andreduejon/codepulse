import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { useKeys } from "./dispatcher";

function Keys(props: { name: string; seen: string[]; onKey?: (name: string, stop: () => void) => void }) {
  useKeys(event => {
    props.seen.push(`${props.name}:${event.name}`);
    props.onKey?.(event.name, () => event.stopPropagation());
  });
  return null;
}

test("a handler removed while a key is handled doesn't see that key", async () => {
  const seen: string[] = [];
  const [open, setOpen] = createSignal(true);
  const setup = await testRender(
    () => (
      <>
        {/* The app's handler, mounted first: Esc closes the dialog. */}
        <Keys name="app" seen={seen} onKey={name => name === "escape" && setOpen(false)} />
        <Show when={open()}>
          <Keys name="dialog" seen={seen} />
        </Show>
      </>
    ),
    { width: 40, height: 10 },
  );
  try {
    await setup.flush();
    setup.mockInput.pressKey("j");
    // A lone Esc is only known once nothing follows it.
    setup.mockInput.pressEscape();
    await setup.flush();
    await Bun.sleep(50);
    setup.mockInput.pressKey("k");
    await setup.flush();
    expect(seen).toEqual(["app:j", "dialog:j", "app:escape", "app:k"]);
  } finally {
    setup.renderer.destroy();
  }
});

test("handlers see a key in the order they mounted, until one stops it", async () => {
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
    expect(seen).toEqual(["first:a", "second:a", "third:a", "first:x", "second:x"]);
  } finally {
    setup.renderer.destroy();
  }
});
