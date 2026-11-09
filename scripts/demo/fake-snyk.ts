/**
 * Stands in for the Snyk CLI in `bun run demo` (scripts/demo/bin/snyk calls it): `snyk test --json` prints the
 * made-up findings for the checked-out commit, after a short pause so the scanning state shows.
 */
import { loadDemoState, snykVulnerabilities } from "./scenario";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("1.1300.0 (demo)");
  process.exit(0);
}
if (!args.includes("--json")) {
  // `--print-graph` only runs for dependency projects, and the demo repository has none.
  process.exit(0);
}

const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: process.cwd() });
const sha = head.stdout.toString().trim();
const vulnerabilities = snykVulnerabilities(loadDemoState(), sha);
await Bun.sleep(1200);
console.log(
  JSON.stringify([
    {
      projectName: "shop",
      displayTargetFile: "package.json",
      targetFile: "package.json",
      packageManager: "npm",
      vulnerabilities,
      ok: vulnerabilities.length === 0,
    },
  ]),
);
process.exit(vulnerabilities.length > 0 ? 1 : 0);
