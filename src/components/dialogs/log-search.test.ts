import { expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { useLogSearch } from "./log-search";

test("a kept search picks up the first hit as soon as matching text arrives", async () => {
  await createRoot(async dispose => {
    try {
      const [texts, setTexts] = createSignal<string[]>(["nothing here"]);
      const search = useLogSearch({ texts, rowAt: () => undefined, scrollbox: () => undefined });
      search.setQuery("needle");
      await Promise.resolve();
      expect(search.position()).toBe("0/0");
      setTexts(["nothing here", "a needle line"]);
      await Promise.resolve();
      expect(search.current()).toBe(1);
      expect(search.position()).toBe("1/1");
    } finally {
      dispose();
    }
  });
});
