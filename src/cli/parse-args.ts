import { resolve } from "node:path";
import packageJson from "../../package.json";
import { printHelp } from "./help";

/**
 * Parsed CLI options returned by {@link parseArgs}.
 *
 * Only positional repo path is supported. All other startup config lives
 * in the per-repo config file or is changed in-app.
 */
export interface CliOptions {
  repoPath: string;
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

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
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
          repoPath = resolve(arg);
        }
    }
  }

  return { repoPath };
}
