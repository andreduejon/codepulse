/**
 * The steps of `bun run demo --play "…"`: keys, typed text, waits, checks, shots and mouse actions. Parsed up front,
 * so a typo fails before the demo starts instead of halfway through a play.
 */
import { parseSize, wholeNumber } from "./options";

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

/** A step as written, without its quotes; `quotedTo` is where its last quoted text ends (0 without quotes). */
interface StepSource {
  text: string;
  quotedTo: number;
}

/**
 * Splits a play into steps at spaces and new lines. Quotes group text with spaces, anywhere in a step:
 * `wait:"full log"` and `"wait:full log"` are the same step.
 */
export function splitPlay(play: string): string[] {
  return splitSources(play).map(source => source.text);
}

function splitSources(play: string): StepSource[] {
  const steps: StepSource[] = [];
  let current = "";
  let quotedTo = 0;
  let started = false;
  let quote: '"' | "'" | null = null;
  for (const char of play) {
    if (quote) {
      if (char === quote) {
        quote = null;
        quotedTo = current.length;
      } else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) steps.push({ text: current, quotedTo });
      current = "";
      quotedTo = 0;
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (quote) throw new PlayError(`A quote is not closed: ${quote}${current}`);
  if (started) steps.push({ text: current, quotedTo });
  return steps;
}

/** The most a step repeats, or the furthest place it points at. */
const MAX_COUNT = 1000;

function count(text: string, source: string): number {
  const value = wholeNumber(text, 1, MAX_COUNT);
  if (value === null) throw new PlayError(`${source}: the count after * must be 1 to ${MAX_COUNT}.`);
  return value;
}

/** What a mouse step points at. A `#N` inside quotes is part of the text; only one after them picks the nth place. */
function parseTarget(value: string, source: string, quotedTo: number): Target {
  const cell = /^(\d+),(\d+)$/.exec(value);
  if (cell && quotedTo === 0) return { kind: "cell", x: Number(cell[1]), y: Number(cell[2]) };
  const match = /^(.+)#(\d+)$/.exec(value);
  const nth = match && (match[1]?.length ?? 0) >= quotedTo ? match : null;
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

function parseStep({ text: source, quotedTo }: StepSource): Step {
  if (source === "shot") return { kind: "shot", name: null };
  if (source === "advance") return { kind: "advance" };
  const colon = source.indexOf(":");
  const command = colon > 0 ? source.slice(0, colon) : "";
  const value = source.slice(colon + 1);
  /** Where the quoted text ends within `value`, or within the part of it starting at `from`. */
  const quotedIn = (from = 0) => Math.max(0, quotedTo - (colon + 1) - from);
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
      return { kind: command, target: parseTarget(value, source, quotedIn()) };
    case "scroll": {
      const match = /^(up|down|left|right)(?:\*(\d+))?(?:@(.+))?$/.exec(value);
      if (!match) throw new PlayError(`${source}: scroll up, down, left or right, like scroll:down*5@Console.`);
      return {
        kind: "scroll",
        direction: match[1] as "up" | "down" | "left" | "right",
        repeat: match[2] ? count(match[2], source) : 1,
        target: match[3] ? parseTarget(match[3], source, quotedIn(value.length - match[3].length)) : null,
      };
    }
    case "sleep": {
      const ms = wholeNumber(value, 0, 600_000);
      if (ms === null) throw new PlayError(`${source}: sleep takes milliseconds up to ten minutes, like sleep:500.`);
      return { kind: "sleep", ms };
    }
    default:
      return parseKey(source);
  }
}

export function parsePlay(play: string): ParsedStep[] {
  const steps = splitSources(play).map(source => ({ source: source.text, step: parseStep(source) }));
  if (steps.length === 0) throw new PlayError("The play has no steps.");
  return steps;
}
