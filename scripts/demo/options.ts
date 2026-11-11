/**
 * The options of `bun run demo`: interactive by default, headless with `--play`. Kept free of side effects so the
 * launcher, the app process and the tests read them the same way.
 */
import { themeNames } from "../../src/context/theme";

export const PROVIDERS = ["github", "jenkins", "openshift", "snyk"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

/** The failures each provider can be started with, one per message the app has for it. */
export const PROVIDER_ERRORS = {
  github: ["401", "rate-limit", "offline", "timeout", "no-token"],
  jenkins: ["401", "offline", "timeout", "no-token"],
  openshift: ["401", "offline", "timeout", "partial", "watch-denied", "no-token"],
  snyk: ["no-token", "partial", "no-cli"],
} as const satisfies Record<ProviderName, readonly string[]>;
export type ProviderError<P extends ProviderName = ProviderName> = (typeof PROVIDER_ERRORS)[P][number];

/** `default`: the normal world. `empty`: connected, nothing to show. `off`: turned off in the config. */
export type ProviderMode = "default" | "empty" | "off" | `error:${string}`;

export interface DemoOptions {
  /** The steps to play headless; null for the interactive demo. */
  play: string | null;
  size: { width: number; height: number };
  providers: Record<ProviderName, ProviderMode>;
  /** Start on a repository the config does not know yet. */
  setup: boolean;
  /** Seconds between the world's phases (interactive only); null when the world stays still. */
  live: number | null;
  /** Fake server delay in milliseconds. */
  latency: number;
  theme: string | null;
  keep: boolean;
  help: boolean;
}

export const DEFAULT_SIZE = { width: 160, height: 45 };
export const DEFAULT_LIVE_SECONDS = 60;
export const DEFAULT_LATENCY_MS = 150;

export class DemoOptionError extends Error {}

export const DEMO_HELP = `Usage: bun run demo [options]

codepulse on a throwaway repository with made-up GitHub Actions, Jenkins, OpenShift and Snyk data.
Nothing reaches the network, and your own config and cache stay untouched.

Options
  --play "STEPS"          run headless: play the steps, print the screens, exit (1 when a step fails)
  --size WxH              headless screen size (default ${DEFAULT_SIZE.width}x${DEFAULT_SIZE.height}, up to 1000x1000)
  --github MODE           default, empty, off, or error:401|rate-limit|offline|timeout|no-token
  --jenkins MODE          default, empty, off, or error:401|offline|timeout|no-token
  --openshift MODE        default, empty, off, or error:401|offline|timeout|partial|watch-denied|no-token
  --snyk MODE             default, empty, off, or error:no-token|partial|no-cli
  --setup                 start on a repository the config does not know yet
  --live [SECONDS]        interactive: the world moves on every SECONDS (default ${DEFAULT_LIVE_SECONDS}, up to 86400)
  --latency MS            fake server delay in milliseconds (default ${DEFAULT_LATENCY_MS}, up to 60000)
  --theme NAME            start with this theme
  --keep                  keep the demo folder and print where it is
  --help                  show this help

Steps (inside --play, separated by spaces or new lines, quote text with spaces)
  j  tab  enter  esc  up  pagedown  shift+tab  ctrl+d  down*3      keys (up to *1000)
  type:TEXT               type text
  wait:TEXT  gone:TEXT    wait until the text shows or is gone (30 seconds, 2 minutes with error:timeout)
  expect:TEXT  absent:TEXT fail unless the text is on screen, or unless it is not
  shot  shot:NAME         print the screen
  size:WxH                resize (up to 1000x1000)
  advance                 move the world to its next phase
  click:TEXT  click:TEXT#2  click:X,Y  hover:TEXT  scroll:down*5@TEXT    mouse
  sleep:MS                wait a fixed time (up to 600000)

Example
  bun run demo --play 'j j l tab tab wait:"full log" shot'
`;

const SIZE = /^(\d+)x(\d+)$/;

/** A whole number from `min` to `max` written in digits, or null. */
export function wholeNumber(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

/** The largest terminal a play can have, either way. */
const MAX_SIDE = 1000;

/** `160x45` as width and height, or null. */
export function parseSize(value: string): { width: number; height: number } | null {
  const match = SIZE.exec(value);
  if (!match) return null;
  const width = wholeNumber(match[1] ?? "", 1, MAX_SIDE);
  const height = wholeNumber(match[2] ?? "", 1, MAX_SIDE);
  return width !== null && height !== null ? { width, height } : null;
}

function parseMode(provider: ProviderName, value: string): ProviderMode {
  if (value === "default" || value === "empty" || value === "off") return value;
  const errors: readonly string[] = PROVIDER_ERRORS[provider];
  if (value.startsWith("error:") && errors.includes(value.slice("error:".length))) return value as ProviderMode;
  throw new DemoOptionError(`--${provider} takes default, empty, off, or error:${errors.join("|")}. Got "${value}".`);
}

/**
 * How long `wait:` and `gone:` wait: 30 seconds, or two minutes when a provider times out (the app gives a request
 * 20 seconds and tries once more, so a fetch takes 40, and the next can queue behind it).
 */
export function waitLimitMs(options: DemoOptions): number {
  return PROVIDERS.some(provider => providerError(options, provider) === "timeout") ? 120_000 : 30_000;
}

/** The error a provider was started with, or null. */
export function providerError<P extends ProviderName>(options: DemoOptions, provider: P): ProviderError<P> | null {
  const mode = options.providers[provider];
  return mode.startsWith("error:") ? (mode.slice("error:".length) as ProviderError<P>) : null;
}

export function parseDemoOptions(args: readonly string[]): DemoOptions {
  const options: DemoOptions = {
    play: null,
    size: DEFAULT_SIZE,
    providers: { github: "default", jenkins: "default", openshift: "default", snyk: "default" },
    setup: false,
    live: null,
    latency: DEFAULT_LATENCY_MS,
    theme: null,
    keep: false,
    help: false,
  };
  let sizeGiven = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const value = () => {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) throw new DemoOptionError(`${arg} needs a value.`);
      index++;
      return next;
    };
    const name = arg.slice(2);
    if ((PROVIDERS as readonly string[]).includes(name) && arg.startsWith("--")) {
      options.providers[name as ProviderName] = parseMode(name as ProviderName, value());
      continue;
    }
    switch (arg) {
      case "--play": {
        const steps = value();
        if (!steps.trim()) throw new DemoOptionError("--play needs at least one step.");
        options.play = steps;
        break;
      }
      case "--size": {
        const text = value();
        const size = parseSize(text);
        if (!size) throw new DemoOptionError(`--size takes WIDTHxHEIGHT, like 160x45. Got "${text}".`);
        options.size = size;
        sizeGiven = true;
        break;
      }
      case "--setup":
        options.setup = true;
        break;
      case "--live": {
        const next = args[index + 1];
        if (next !== undefined && !next.startsWith("--")) {
          const seconds = wholeNumber(next, 1, 86_400);
          if (seconds === null)
            throw new DemoOptionError(`--live takes whole seconds up to a day, like --live 60. Got "${next}".`);
          options.live = seconds;
          index++;
        } else options.live = DEFAULT_LIVE_SECONDS;
        break;
      }
      case "--latency": {
        const text = value();
        const latency = wholeNumber(text, 0, 60_000);
        if (latency === null)
          throw new DemoOptionError(`--latency takes milliseconds up to a minute, like --latency 150. Got "${text}".`);
        options.latency = latency;
        break;
      }
      case "--theme": {
        const theme = value();
        if (!themeNames.includes(theme))
          throw new DemoOptionError(`Unknown theme "${theme}". Themes: ${themeNames.join(", ")}.`);
        options.theme = theme;
        break;
      }
      case "--keep":
        options.keep = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new DemoOptionError(`Unknown option ${arg}. See bun run demo --help.`);
    }
  }
  if (sizeGiven && options.play === null)
    throw new DemoOptionError("--size works with --play. The interactive demo uses your terminal's size.");
  if (options.live !== null && options.play !== null)
    throw new DemoOptionError("--live is for the interactive demo. In --play, the advance step moves the world on.");
  return options;
}
