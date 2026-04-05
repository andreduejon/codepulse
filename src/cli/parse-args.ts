import packageJson from "../../package.json";
import { printHelp } from "./help";

/**
 * Parsed CLI options returned by {@link parseArgs}.
 *
 * Fields are optional so that {@link mergeOptions} in `config.ts` can
 * distinguish "user explicitly passed this flag" from "not specified".
 * Only `repoPath` is always set (defaults to cwd).
 */
export interface CliOptions {
  repoPath: string;
  branch?: string;
  all?: boolean;
  maxCount?: number;
  themeName?: string;
}

/**
 * Parse process.argv into a typed {@link CliOptions} object.
 *
 * Handles `--help` / `--version` internally (prints and exits).
 * Exits with code 1 on invalid input.
 */
export function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);

  let repoPath = process.cwd();
  let branch: string | undefined;
  let all: boolean | undefined;
  let maxCount: number | undefined;
  let themeName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--branch":
      case "-b":
        if (i + 1 >= args.length) {
          console.error(`${arg} requires a value`);
          process.exit(1);
        }
        branch = args[++i];
        all = false;
        break;
      case "--max-count":
      case "-n": {
        if (i + 1 >= args.length) {
          console.error(`${arg} requires a value`);
          process.exit(1);
        }
        const raw = args[++i];
        const parsed = parseInt(raw, 10);
        if (Number.isNaN(parsed) || parsed < 1) {
          console.error(`${arg} must be a positive integer, got: ${raw}`);
          process.exit(1);
        }
        maxCount = parsed;
        break;
      }
      case "--theme":
        if (i + 1 >= args.length) {
          console.error(`${arg} requires a value`);
          process.exit(1);
        }
        themeName = args[++i];
        break;
      case "--no-all":
        all = false;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      case "--version":
      case "-v":
        console.log(`codepulse v${packageJson.version}`);
        process.exit(0);
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown option: ${arg}`);
          printHelp();
          process.exit(1);
        } else {
          repoPath = arg.startsWith("/") ? arg : `${process.cwd()}/${arg}`;
        }
    }
  }

  return { repoPath, branch, all, maxCount, themeName };
}
