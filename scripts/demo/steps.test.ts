import { describe, expect, test } from "bun:test";
import { PlayError, parsePlay, splitPlay } from "./steps";

const steps = (play: string) => parsePlay(play).map(({ step }) => step);

describe("splitPlay", () => {
  test("splits at spaces and new lines, and quotes keep text with spaces together", () => {
    expect(splitPlay('j  enter\nwait:"full log" "shot:two words"\tclick:\'previous stage\'')).toEqual([
      "j",
      "enter",
      "wait:full log",
      "shot:two words",
      "click:previous stage",
    ]);
  });

  test("an open quote is an error", () => {
    expect(() => splitPlay('wait:"full log')).toThrow(PlayError);
  });
});

describe("parsePlay", () => {
  test("keys: single characters, names, modifiers and repeats", () => {
    expect(steps("j : / G tab shift+tab ctrl+d down*3 pagedown esc")).toEqual([
      { kind: "key", key: "j", modifiers: {}, repeat: 1 },
      { kind: "key", key: ":", modifiers: {}, repeat: 1 },
      { kind: "key", key: "/", modifiers: {}, repeat: 1 },
      { kind: "key", key: "G", modifiers: {}, repeat: 1 },
      { kind: "key", key: "TAB", modifiers: {}, repeat: 1 },
      { kind: "key", key: "TAB", modifiers: { shift: true }, repeat: 1 },
      { kind: "key", key: "d", modifiers: { ctrl: true }, repeat: 1 },
      { kind: "key", key: "ARROW_DOWN", modifiers: {}, repeat: 3 },
      { kind: "key", key: "\u001b[6~", modifiers: {}, repeat: 1 },
      { kind: "key", key: "ESCAPE", modifiers: {}, repeat: 1 },
    ]);
  });

  test("text, waits, checks, shots, size, advance and sleep", () => {
    expect(
      steps(
        'type:/error wait:"full log" gone:Fetching expect:✗ absent:running shot shot:after size:100x30 advance sleep:250',
      ),
    ).toEqual([
      { kind: "type", text: "/error" },
      { kind: "wait", text: "full log" },
      { kind: "gone", text: "Fetching" },
      { kind: "expect", text: "✗" },
      { kind: "absent", text: "running" },
      { kind: "shot", name: null },
      { kind: "shot", name: "after" },
      { kind: "size", width: 100, height: 30 },
      { kind: "advance" },
      { kind: "sleep", ms: 250 },
    ]);
  });

  test("mouse steps point at text, its nth place, or a cell", () => {
    expect(
      steps('click:Jenkins click:"previous stage"#2 click:12,3 hover:Console scroll:down*5@Console scroll:up'),
    ).toEqual([
      { kind: "click", target: { kind: "text", text: "Jenkins", nth: 1 } },
      { kind: "click", target: { kind: "text", text: "previous stage", nth: 2 } },
      { kind: "click", target: { kind: "cell", x: 12, y: 3 } },
      { kind: "hover", target: { kind: "text", text: "Console", nth: 1 } },
      { kind: "scroll", direction: "down", repeat: 5, target: { kind: "text", text: "Console", nth: 1 } },
      { kind: "scroll", direction: "up", repeat: 1, target: null },
    ]);
  });

  test("a # inside quotes is part of the text; only a #N after the quotes picks the nth place", () => {
    expect(steps('click:"CI #812" click:"CI #812"#2 "click:CI #812" scroll:down*2@"CI #812"')).toEqual([
      { kind: "click", target: { kind: "text", text: "CI #812", nth: 1 } },
      { kind: "click", target: { kind: "text", text: "CI #812", nth: 2 } },
      { kind: "click", target: { kind: "text", text: "CI #812", nth: 1 } },
      { kind: "scroll", direction: "down", repeat: 2, target: { kind: "text", text: "CI #812", nth: 1 } },
    ]);
  });

  test.each([
    ["details", "Unknown step details. To type text, write type:details."],
    ["super+x", "unknown modifier super"],
    ["down*0", "the count after * must be 1 to 1000"],
    ["wait:", "the text is missing"],
    ["size:big", "the size is WIDTHxHEIGHT"],
    ["scroll:sideways", "scroll up, down, left or right"],
    ["sleep:1s", "sleep takes milliseconds"],
    ["click:", "say what to point at"],
    [
      "down*9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999",
      "the count after * must be 1 to 1000",
    ],
    [
      "sleep:9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999",
      "sleep takes milliseconds",
    ],
    [
      "size:9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999x40",
      "the size is WIDTHxHEIGHT",
    ],
    ["", "The play has no steps."],
  ])("explains a wrong step (%j)", (play, message) => {
    expect(() => parsePlay(play)).toThrow(PlayError);
    expect(() => parsePlay(play)).toThrow(message);
  });
});
