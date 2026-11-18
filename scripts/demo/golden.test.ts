import { describe, expect, test } from "bun:test";
import { GOLDEN_PLAYS, screenDifferences, withoutDemoFolder } from "./golden";
import { parseDemoOptions } from "./options";

const screen = (title: string, ...lines: string[]) => [`=== shot 1: ${title} (20x3) ===`, ...lines].join("\n");

describe("screenDifferences", () => {
  test("nothing when the screens match", () => {
    expect(screenDifferences(screen("a", "x", "y"), screen("a", "x", "y"))).toEqual([]);
  });

  test("each changed line of a screen, as kept and as printed now", () => {
    expect(screenDifferences(screen("a", "x", "y"), screen("a", "x", "z"))).toEqual([
      "=== shot 1: a (20x3) ===",
      "  line 2",
      "  - y",
      "  + z",
    ]);
  });

  test("a screen that is new or gone", () => {
    expect(screenDifferences(screen("a", "x"), screen("b", "x"))).toEqual([
      "=== shot 1: a (20x3) === is gone",
      "=== shot 1: b (20x3) === is new",
    ]);
  });
});

test("the demo's folder is masked, on every OS, so a run on another machine prints the same", () => {
  expect(withoutDemoFolder("  …lse-demo-aZysFl/home/code/shop  ")).toBe("  <demo folder>/home/code/shop  ");
  expect(withoutDemoFolder("C:\\Temp\\codepulse-demo-x1\\home\\code\\shop-web")).toBe(
    "<demo folder>/home/code/shop-web",
  );
});

test("every golden play has a unique name and options the demo takes", () => {
  expect(new Set(GOLDEN_PLAYS.map(play => play.name)).size).toBe(GOLDEN_PLAYS.length);
  for (const play of GOLDEN_PLAYS) expect(() => parseDemoOptions(play.args)).not.toThrow();
});
