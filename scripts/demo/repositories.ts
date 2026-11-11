/**
 * The demo repositories' histories (built by history.ts). shop's graph is meant to show every shape at once: wide
 * fan-outs, long lanes crossing them, merges of all kinds, three roots, a revert, release backports, open and
 * remote-only branches, and more lanes than the graph shows, so it scrolls sideways.
 *
 * The newest commits (`metrics`, `health`, `readme`, `retry`, `payments`) stay the top five rows: the provider data
 * in scenario.ts and the docs' example plays count on them.
 */
import type { CommitSpec, HistorySpec } from "./history";
import { ADMIN_MANIFEST, lockfile, type Manifest, SHOP_MANIFESTS } from "./packages";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (days: number, hours = 0, minutes = 0) => days * DAY + hours * HOUR + minutes * MIN;

const DEV = "Demo Dev";
const ANA = "Ana Lima";
const JONAS = "Jonas Weber";
const MEI = "Mei Chen";
const NOAH = "Noah Park";
const PRIYA = "Priya Natarajan";
const SAM = "Sam O'Brien";
const LENA = "Lena Fischer";
const TOM = "Tom Becker";

export const FEATURE_BRANCH = "feature/payments-retry-with-a-really-long-branch-name";
export const LANE_BRANCHES = Array.from({ length: 11 }, (_, i) => `lane/${String(i + 1).padStart(2, "0")}`);

function manifestFiles(manifest: Manifest, directory = ""): Record<string, string> {
  const prefix = directory ? `${directory}/` : "";
  return {
    [`${prefix}package.json`]: `${JSON.stringify(manifest, null, 2)}\n`,
    [`${prefix}package-lock.json`]: lockfile(manifest),
  };
}

const c = (
  key: string,
  parents: string[],
  ago: number,
  author: string,
  subject: string,
  extra: Partial<CommitSpec> = {},
): CommitSpec => ({ key, parents, ago, author, subject, ...extra });

const merge = (key: string, parents: string[], ago: number, author: string, subject: string) =>
  c(key, parents, ago, author, subject);

export const SHOP_README = "# shop\n\nThe cart flow: add, discount, pay.\n";

export function shopHistory(): HistorySpec {
  const lanes = LANE_BRANCHES.map((_, i) =>
    c(
      `lane${i + 1}`,
      ["cart"],
      at(10) - (i + 1) * HOUR,
      DEV,
      `chore(lane ${i + 1}): a parallel branch so the graph needs many lanes`,
    ),
  );
  const commits: CommitSpec[] = [
    // ── The start: three roots in the end (main, gh-pages, and legacy scripts merged in later) ──
    c("initial", [], at(12), DEV, "chore: initial commit", {
      files: { ...manifestFiles(SHOP_MANIFESTS.initial), "README.md": "# shop\n", "src/index.ts": "export {};\n" },
    }),
    c("ci", ["initial"], at(11, 22), DEV, "ci: run the tests on every push", {
      files: { ".github/workflows/ci.yml": "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n" },
    }),
    c("exp1", ["ci"], at(11, 20), LENA, "experiment: try a vertical graph layout"),
    c("pages1", [], at(11, 18), PRIYA, "docs: start the documentation site", {
      files: { "index.html": "<h1>shop</h1>\n" },
    }),
    c("search1", ["ci"], at(11, 12), MEI, "feat(search): index product names"),
    c("cart", ["ci"], at(11), ANA, "feat(cart): add the cart service", {
      files: { ...manifestFiles(SHOP_MANIFESTS.cart), ...manifestFiles(ADMIN_MANIFEST, "admin") },
    }),
    // ── Eleven lanes from one commit, crossed by the long-lived search and experiment branches ──
    ...lanes,
    c("exp2", ["exp1"], at(10, 6), LENA, "experiment: draw merges as curves"),
    c("search2", ["search1"], at(9, 20), MEI, "feat(search): rank results by popularity"),
    c("rounding", ["cart"], at(9), JONAS, "fix(cart): round discounts to cents", {
      files: manifestFiles(SHOP_MANIFESTS.rounding),
    }),
    // ── A release branch, a hotfix merged into both, backports later ──
    c("rel140", ["rounding"], at(8, 20), DEV, "chore(release): 1.4.0"),
    c("hotfix", ["rel140"], at(8, 16), JONAS, "fix(cart): do not overflow the discount total"),
    merge(
      "relHotfix",
      ["rel140", "hotfix"],
      at(8, 14),
      JONAS,
      "Merge branch 'hotfix/discount-overflow' into release/1.x",
    ),
    c("rel141", ["relHotfix"], at(8, 13), DEV, "chore(release): 1.4.1"),
    merge("mainHotfix", ["rounding", "hotfix"], at(8, 12), JONAS, "Merge branch 'hotfix/discount-overflow'"),
    c("exp3", ["exp2"], at(8), LENA, "experiment: compare both layouts side by side"),
    // ── Stacked branches: checkout-ui on checkout-api, merged into it, then into main ──
    c("api1", ["mainHotfix"], at(7, 22), TOM, "feat(checkout): add the checkout endpoint"),
    c("api2", ["api1"], at(7, 20), TOM, "feat(checkout): validate the cart before paying"),
    c("ui1", ["api2"], at(7, 18), SAM, "feat(checkout): add the checkout page"),
    c("api3", ["api2"], at(7, 16), TOM, "test(checkout): cover empty carts"),
    c("ui2", ["ui1"], at(7, 14), SAM, "feat(checkout): show the order summary"),
    merge("apiUi", ["api3", "ui2"], at(7, 10), TOM, "Merge branch 'feature/checkout-ui' into feature/checkout-api"),
    merge("mainApi", ["mainHotfix", "apiUi"], at(7, 6), TOM, "Merge pull request #12 from demo/feature/checkout-api"),
    c("pages2", ["pages1"], at(7), PRIYA, "docs: add the getting started page", {
      files: { "getting-started.html": "<h1>Getting started</h1>\n" },
    }),
    c("search3", ["search2"], at(6, 22), MEI, "feat(search): highlight matching words"),
    merge("searchSync", ["search3", "mainApi"], at(6, 20), MEI, "Merge branch 'main' into feature/search"),
    // ── Criss-cross: inventory and pricing merge each other, then both go into main ──
    c("inv1", ["mainApi"], at(6, 16), ANA, "feat(inventory): reserve items while paying"),
    c("price1", ["mainApi"], at(6, 14), JONAS, "feat(pricing): price lists per country"),
    merge("invX", ["inv1", "price1"], at(6, 12), ANA, "Merge branch 'feature/pricing' into feature/inventory"),
    merge("priceX", ["price1", "inv1"], at(6, 10), JONAS, "Merge branch 'feature/inventory' into feature/pricing"),
    c("inv2", ["invX"], at(6, 8), ANA, "feat(inventory): release reservations after 15 minutes"),
    c("price2", ["priceX"], at(6, 6), JONAS, "feat(pricing): round prices per currency"),
    merge("mainInv", ["mainApi", "inv2"], at(5, 22), ANA, "Merge pull request #15 from demo/feature/inventory"),
    merge("mainPrice", ["mainInv", "price2"], at(5, 20), JONAS, "Merge pull request #16 from demo/feature/pricing"),
    // ── An unrelated history (its own root) merged into main ──
    c("legacy1", [], at(5, 18), DEV, "chore: import the legacy deploy scripts", {
      files: { "deploy/deploy.sh": "#!/bin/sh\necho deploying\n" },
    }),
    c("legacy2", ["legacy1"], at(5, 16), DEV, "chore: make the deploy scripts portable", {
      files: { "deploy/deploy.sh": "#!/bin/sh\nset -eu\necho deploying\n" },
    }),
    // ── An octopus merge of four dependency branches ──
    c("depLodash", ["mainPrice"], at(5, 12), DEV, "chore(deps): plan the lodash upgrade"),
    c("depAxios", ["mainPrice"], at(5, 11), DEV, "chore(deps): plan the axios upgrade"),
    c("depJest", ["mainPrice"], at(5, 10), DEV, "chore(deps): plan the jest upgrade"),
    c("depTs", ["mainPrice"], at(5, 9), DEV, "chore(deps): plan the typescript upgrade"),
    merge(
      "octopus",
      ["mainPrice", "depLodash", "depAxios", "depJest", "depTs"],
      at(5, 6),
      DEV,
      "Merge branches 'deps/lodash', 'deps/axios', 'deps/jest' and 'deps/typescript'",
    ),
    merge("legacyMerge", ["octopus", "legacy2"], at(5, 2), DEV, "Merge branch 'import/legacy-scripts'"),
    c("pages3", ["pages2"], at(5), PRIYA, "docs: document the cart API", {
      files: { "cart-api.html": "<h1>Cart API</h1>\n" },
    }),
    // ── A change and its revert ──
    c("ship", ["legacyMerge"], at(4, 20), ANA, "feat(cart): free shipping over 50", {
      files: { "src/cart/shipping.ts": "export const freeShippingFrom = 50;\n" },
    }),
    c("revert", ["ship"], at(4, 16), ANA, 'Revert "feat(cart): free shipping over 50"', {
      body: "The warehouse cannot ship for free yet.",
      files: {},
      deletes: ["src/cart/shipping.ts"],
    }),
    c("backport", ["rel141"], at(4, 12), JONAS, "fix(payments): time out after 30 seconds"),
    c("rel142", ["backport"], at(4, 10), DEV, "chore(release): 1.4.2"),
    merge("mainRelease", ["revert", "rel142"], at(4, 6), JONAS, "Merge branch 'release/1.x'"),
    c("search4", ["searchSync"], at(4), MEI, "feat(search): search as you type"),
    // ── Six branches out of one commit, merged back one by one, crossing each other ──
    c("a11y1", ["mainRelease"], at(3, 20), PRIYA, "fix(a11y): label the cart buttons"),
    c("dark1", ["mainRelease"], at(3, 18), LENA, "feat(theme): dark mode"),
    c("i18n1", ["mainRelease"], at(3, 16), SAM, "feat(i18n): extract the checkout strings"),
    c("dash1", ["mainRelease"], at(3, 14), TOM, "feat(metrics): sales dashboard"),
    c("badge1", ["mainRelease"], at(3, 12), NOAH, "fix(cart): update the badge after removing an item"),
    c("lint1", ["mainRelease"], at(3, 10), DEV, "chore(lint): move to ESLint 9"),
    c("a11y2", ["a11y1"], at(3, 8), PRIYA, "fix(a11y): announce cart updates"),
    c("i18n2", ["i18n1"], at(3, 6), SAM, "feat(i18n): add German"),
    merge("mainBadge", ["mainRelease", "badge1"], at(3, 4), NOAH, "Merge pull request #21 from demo/bugfix/cart-badge"),
    c("dark2", ["dark1"], at(3, 2), LENA, "feat(theme): follow the system setting"),
    c("dash2", ["dash1"], at(3), TOM, "feat(metrics): weekly totals"),
    merge("mainLint", ["mainBadge", "lint1"], at(2, 22), DEV, "Merge pull request #22 from demo/chore/eslint-9"),
    merge("i18nSync", ["i18n2", "mainLint"], at(2, 20), SAM, "Merge branch 'main' into feature/i18n"),
    merge("mainA11y", ["mainLint", "a11y2"], at(2, 18), PRIYA, "Merge pull request #20 from demo/feature/a11y"),
    c("i18n3", ["i18nSync"], at(2, 16), SAM, "feat(i18n): add French"),
    c("search5", ["search4"], at(2, 14), MEI, "fix(search): ignore accents"),
    merge("mainSearch", ["mainA11y", "search5"], at(2, 12), MEI, "Merge pull request #9 from demo/feature/search"),
    merge("mainI18n", ["mainSearch", "i18n3"], at(2, 8), SAM, "Merge pull request #23 from demo/feature/i18n"),
    c("dash3", ["dash2"], at(2), TOM, "feat(metrics): export as CSV"),
    c("dark3", ["dark2"], at(1, 20), LENA, "wip(theme): contrast tweaks"),
    c("pages4", ["pages3"], at(1), PRIYA, "docs: publish the 1.4.2 release notes", {
      files: { "releases.html": "<h1>1.4.2</h1>\n" },
    }),
    c("perf", ["mainI18n"], at(0, 20), NOAH, "perf(cart): cache price lookups"),
    // ── The top rows the provider data is about ──
    c(
      "payments",
      ["perf"],
      at(0, 7),
      DEV,
      "feat(payments): retry failed payments with exponential backoff, and a subject long enough to need cutting",
      { files: manifestFiles(SHOP_MANIFESTS.payments) },
    ),
    c("retry", ["payments"], at(0, 6), MEI, "wip(payments): retry policy types"),
    c(
      "readme",
      ["payments"],
      at(0, 1),
      NOAH,
      "docs: rewrite the README for the new cart flow 🚀 and explain how discounts are rounded",
      { files: { "README.md": SHOP_README } },
    ),
    c("health", ["readme"], at(0, 0, 50), DEV, "feat(api): add a health endpoint"),
    c("metrics", ["health"], at(0, 0, 5), DEV, "feat(api): export request metrics"),
    // Pushed to origin/dev when the world moves on (phase 2); never a local branch.
    c("next", ["metrics"], 0, DEV, "fix(api): pin the metrics exporter version"),
  ];
  return {
    commits,
    refs: {
      "refs/heads/main": "readme",
      "refs/heads/dev": "metrics",
      [`refs/heads/${FEATURE_BRANCH}`]: "retry",
      "refs/heads/release/1.x": "rel142",
      "refs/heads/gh-pages": "pages4",
      "refs/heads/experiment/graph-layout": "exp3",
      "refs/heads/feature/dark-mode": "dark3",
      "refs/heads/feature/metrics-dashboard": "dash3",
      "refs/demo/next-dev": "next",
      ...Object.fromEntries(LANE_BRANCHES.map((branch, i) => [`refs/heads/${branch}`, `lane${i + 1}`])),
    },
    tags: [
      { name: "v1.4.0", key: "rel140", message: "Release 1.4.0" },
      { name: "v1.4.1", key: "rel141", message: "Release 1.4.1" },
      { name: "v1.4.2", key: "rel142", message: "Release 1.4.2" },
      { name: "v0.42.0", key: "readme" },
    ],
  };
}

export function webHistory(): HistorySpec {
  return {
    commits: [
      c("initial", [], at(3), ANA, "chore: initial commit", { files: { "README.md": "# shop-web\n" } }),
      c("gallery", ["initial"], at(2), ANA, "feat(web): product page with an image gallery"),
      c("prices", ["gallery"], at(0, 3), JONAS, "fix(web): show prices with two decimals"),
    ],
    refs: { "refs/heads/main": "prices" },
  };
}
