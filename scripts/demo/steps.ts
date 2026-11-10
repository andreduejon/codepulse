/**
 * The steps of `bun run demo --play "…"`: keys, typed text, waits, checks, shots and mouse actions. Parsed up front,
 * so a typo fails before the demo starts instead of halfway through a play.
 */
import { parseSize } from "./options";

export interface KeyModifiers {
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

/** Where a mouse step points: the nth place a text shows (1 is the first), or a cell. */
export type Target = { kind: "text"; text: string; nth: number } | { kind: "cell"; x: number; y: number };

export type Step =
  | { kind: "key"; key: string; modifiers: KeyModifiers; repeat: number }
  | { kind: "type"; text: string }
  | { kind: "wait"; text: string }
  | { kind: "gone"; text: string }
  | { kind: "expect"; text: string }
  | { kind: "absent"; text: string }
  | { kind: "shot"; name: string | null }
  | { kind: "size"; width: number; height: number }
  | { kind: "advance" }
  | { kind: "click"; target: Target }
  | { kind: "hover"; target: Target }
  | { kind: "scroll"; direction: "up" | "down" | "left" | "right"; repeat: number; target: Target | null }
  | { kind: "sleep"; ms: number };

/** A step as written, for messages. */
export interface ParsedStep {
  source: string;
  step: Step;
}

export class PlayError extends Error {}

/** Key names, as the test renderer's mock keyboard takes them. */
const KEY_NAMES: Record<string, string> = {
  tab: "TAB",
  enter: "RETURN",
  return: "RETURN",
  esc: "ESCAPE",
  escape: "ESCAPE",
  space: " ",
  backspace: "BACKSPACE",
  delete: "DELETE",
  up: "ARROW_UP",
  down: "ARROW_DOWN",
  left: "ARROW_LEFT",
  right: "ARROW_RIGHT",
  home: "HOME",
  end: "END",
  pageup: "\u001b[5~",
  pagedown: "\u001b[6~",
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, `F${i + 1}`])),
};

/**
 * Splits a play into steps at spaces and new lines. Quotes group text with spaces, anywhere in a step:
 * `wait:"full log"` and `"wait:full log"` are the same step.
 */
export function splitPlay(play: string): string[] {
  const steps: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | null = null;
  for (const char of play) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) steps.push(current);
      current = "";
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (quote) throw new PlayError(`A quote is not closed: ${quote}${current}`);
  if (started) steps.push(current);
  return steps;
}

function count(text: string, source: string): number {
  if (!/^\d+$/.test(text) || Number(text) < 1) throw new PlayError(`${source}: the count after * must be 1 or more.`);
  return Number(text);
}

function parseTarget(value: string, source: string): Target {
  const cell = /^(\d+),(\d+)$/.exec(value);
  if (cell) return { kind: "cell", x: Number(cell[1]), y: Number(cell[2]) };
  const nth = /^(.+)#(\d+)$/.exec(value);
  const text = nth ? nth[1] : value;
  if (!text) throw new PlayError(`${source}: say what to point at, like click:Console.`);
  return { kind: "text", text, nth: nth ? count(nth[2], source) : 1 };
}

function parseKey(source: string): Step {
  const repeat = /^(.+)\*(\d+)$/.exec(source);
  const body = repeat ? repeat[1] : source;
  const parts = body.length > 1 ? body.split("+") : [body];
  const name = parts.pop() ?? "";
  const modifiers: KeyModifiers = {};
  for (const modifier of parts) {
    if (modifier === "shift") modifiers.shift = true;
    else if (modifier === "ctrl") modifiers.ctrl = true;
    else if (modifier === "alt" || modifier === "meta") modifiers.meta = true;
    else throw new PlayError(`${source}: unknown modifier ${modifier}. Use shift, ctrl or alt.`);
  }
  const key = name.length === 1 ? name : KEY_NAMES[name.toLowerCase()];
  if (!key) throw new PlayError(`Unknown step ${source}. To type text, write type:${source}.`);
  return { kind: "key", key, modifiers, repeat: repeat ? count(repeat[2], source) : 1 };
}

function parseStep(source: string): Step {
  if (source === "shot") return { kind: "shot", name: null };
  if (source === "advance") return { kind: "advance" };
  const colon = source.indexOf(":");
  const command = colon > 0 ? source.slice(0, colon) : "";
  const value = source.slice(colon + 1);
  const text = (kind: "type" | "wait" | "gone" | "expect" | "absent"): Step => {
    if (!value) throw new PlayError(`${source}: the text is missing, like ${kind}:Console.`);
    return { kind, text: value };
  };
  switch (command) {
    case "type":
    case "wait":
    case "gone":
    case "expect":
    case "absent":
      return text(command);
    case "shot":
      return { kind: "shot", name: value || null };
    case "size": {
      const size = parseSize(value);
      if (!size) throw new PlayError(`${source}: the size is WIDTHxHEIGHT, like size:120x40.`);
      return { kind: "size", ...size };
    }
    case "click":
    case "hover":
      return { kind: command, target: parseTarget(value, source) };
    case "scroll": {
      const match = /^(up|down|left|right)(?:\*(\d+))?(?:@(.+))?$/.exec(value);
      if (!match) throw new PlayError(`${source}: scroll up, down, left or right, like scroll:down*5@Console.`);
      return {
        kind: "scroll",
        direction: match[1] as "up" | "down" | "left" | "right",
        repeat: match[2] ? count(match[2], source) : 1,
        target: match[3] ? parseTarget(match[3], source) : null,
      };
    }
    case "sleep":
      if (!/^\d+$/.test(value)) throw new PlayError(`${source}: sleep takes milliseconds, like sleep:500.`);
      return { kind: "sleep", ms: Number(value) };
    default:
      return parseKey(source);
  }
}

export function parsePlay(play: string): ParsedStep[] {
  const steps = splitPlay(play).map(source => ({ source, step: parseStep(source) }));
  if (steps.length === 0) throw new PlayError("The play has no steps.");
  return steps;
}
