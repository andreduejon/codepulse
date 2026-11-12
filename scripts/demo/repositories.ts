/**
 * The demo repositories' histories (built by history.ts, their files in codebase.ts). shop's graph is meant to show
 * every shape at once: a Renovate fan-out crossed by long lanes, merges of all kinds, three roots, a revert, release
 * backports, open and remote-only branches, and more lanes than the graph shows, so it scrolls sideways. Its commits
 * edit a small TypeScript shop, so the diffs read like real ones.
 *
 * The newest commits (`metrics`, `health`, `readme`, `retry`, `payments`) stay the top five rows: the provider data
 * in scenario.ts and the docs' example plays count on them.
 */
import * as code from "./codebase";
import type { CommitSpec, FileValue, HistorySpec } from "./history";
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
const RENOVATE = "renovate[bot]";

export const FEATURE_BRANCH = "feature/payments-retry-with-a-really-long-branch-name";

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

const merge = (key: string, parents: string[], ago: number, author: string, subject: string, body?: string) =>
  c(key, parents, ago, author, subject, body ? { body } : {});

const replaceAll = (from: string, to: string) => (old: string) => {
  if (!old.includes(from)) throw new Error(`Demo edit: "${from}" is not in the file`);
  return old.replaceAll(from, to);
};

/** A Renovate pull request body, as the bot writes it. */
const renovateBody = (rows: [pkg: string, change: string][]) =>
  [
    "This PR contains the following updates:",
    "",
    "| Package | Change |",
    "|---|---|",
    ...rows.map(([pkg, change]) => `| ${pkg} | ${change} |`),
    "",
    "---",
    "",
    "### Configuration",
    "",
    "📅 **Schedule**: Branch creation - At any time (no schedule defined), Automerge - At any time.",
    "",
    "🚦 **Automerge**: Disabled by config. Please merge this manually once you are satisfied.",
  ].join("\n");

/** A bump of one dependency in the cart-era manifest. */
const bump = (section: "dependencies" | "devDependencies", name: string, range: string) =>
  manifestFiles({
    ...SHOP_MANIFESTS.cart,
    [section]: { ...SHOP_MANIFESTS.cart[section], [name]: range },
  });

interface Lane {
  branch: string;
  subject: string;
  body: string;
  files?: Record<string, FileValue>;
  edits?: Record<string, (old: string) => string>;
}

/** Renovate opened eleven pull requests from the same commit: the fan-out at the bottom of the graph. */
const LANES: Lane[] = [
  {
    branch: "renovate/typescript-5.x",
    subject: "chore(deps): update dependency typescript to v5.5.4",
    body: renovateBody([["typescript", "`^5.4.5` -> `^5.5.4`"]]),
    files: bump("devDependencies", "typescript", "^5.5.4"),
  },
  {
    branch: "renovate/major-jest-monorepo",
    subject: "chore(deps): update jest monorepo to v30 (major)",
    body: renovateBody([["jest", "`^29.7.0` -> `^30.0.0`"]]),
    files: bump("devDependencies", "jest", "^30.0.0"),
  },
  {
    branch: "renovate/express-4.x",
    subject: "fix(deps): update dependency express to v4.21.2",
    body: renovateBody([["express", "`^4.19.2` -> `^4.21.2`"]]),
    files: bump("dependencies", "express", "^4.21.2"),
  },
  {
    branch: "renovate/npm-lodash-vulnerability",
    subject: "fix(deps): update dependency lodash to v4.17.21 [security]",
    body: renovateBody([["lodash", "`^4.17.15` -> `^4.17.21`"]]),
    files: bump("dependencies", "lodash", "^4.17.21"),
  },
  {
    branch: "renovate/npm-axios-vulnerability",
    subject: "fix(deps): update dependency axios to v1.7.9 [security]",
    body: renovateBody([["axios", "`^1.5.1` -> `^1.7.9`"]]),
    files: bump("dependencies", "axios", "^1.7.9"),
  },
  {
    branch: "renovate/major-mkdirp",
    subject: "fix(deps): update dependency mkdirp to v1 (major)",
    body: renovateBody([["mkdirp", "`^0.5.5` -> `^1.0.4`"]]),
    files: bump("dependencies", "mkdirp", "^1.0.4"),
  },
  {
    branch: "renovate/actions-checkout-4.x",
    subject: "chore(deps): update actions/checkout action to v4",
    body: renovateBody([["actions/checkout", "`v3` -> `v4`"]]),
    edits: { ".github/workflows/ci.yml": replaceAll("actions/checkout@v3", "actions/checkout@v4") },
  },
  {
    branch: "renovate/oven-sh-setup-bun-2.x",
    subject: "chore(deps): update oven-sh/setup-bun action to v2",
    body: renovateBody([["oven-sh/setup-bun", "`v1` -> `v2`"]]),
    edits: { ".github/workflows/ci.yml": replaceAll("oven-sh/setup-bun@v1", "oven-sh/setup-bun@v2") },
  },
  {
    branch: "renovate/node-20.x",
    subject: "chore(deps): update node.js to v20",
    body: renovateBody([["node", "`18` -> `20`"]]),
    edits: { ".nvmrc": code.replace(["18", "20"]) },
  },
  {
    branch: "renovate/node-22.x",
    subject: "chore(deps): update node.js to v22",
    body: renovateBody([["node", "`20-alpine` -> `22-alpine`"]]),
    edits: { Dockerfile: replaceAll("node:20-alpine", "node:22-alpine") },
  },
  {
    branch: "renovate/lock-file-maintenance",
    subject: "chore(deps): lock file maintenance",
    body: renovateBody([["lock file", "refresh"]]),
    edits: { "package-lock.json": code.replace(['"version": "1.15.2"', '"version": "1.15.4"']) },
  },
];

export const LANE_BRANCHES = LANES.map(lane => lane.branch);

const inverse = (pairs: [string, string][]): [string, string][] => pairs.map(([from, to]) => [to, from]);

export const SHOP_README = code.README_V2;

/** Where the CI annotations point: the lines in the commits' files. */
export const ANNOTATION_LINES = {
  retryTest: code.lineOf(code.RETRY_TEST, "expect(response.status).toBe(200)"),
  gatewayTest: code.lineOf(code.gatewayClientTest(), 'test("gives up after three retries"'),
  unusedDelay: code.lineOf(code.RETRY, "const delay = baseDelayMs;"),
  retryPolicy: code.lineOf(code.RETRY_POLICY, 'maxAttempts: "3"'),
};

export function shopHistory(): HistorySpec {
  const lanes = LANES.map((lane, i) =>
    c(`lane${i + 1}`, ["cart"], at(10) - (i + 1) * HOUR, RENOVATE, lane.subject, {
      body: lane.body,
      ...(lane.files ? { files: lane.files } : {}),
      ...(lane.edits ? { edits: lane.edits } : {}),
    }),
  );
  const commits: CommitSpec[] = [
    // ── The start: three roots in the end (main, gh-pages, and legacy scripts merged in later) ──
    c("initial", [], at(12), DEV, "chore: initial commit", {
      files: {
        ...manifestFiles(SHOP_MANIFESTS.initial),
        "README.md": code.README_V1,
        "CHANGELOG.md": code.CHANGELOG_V1,
        "tsconfig.json": code.TSCONFIG,
        ".gitignore": code.GITIGNORE,
        ".editorconfig": code.EDITORCONFIG,
        ".eslintrc.json": code.ESLINTRC,
        ".nvmrc": "18\n",
        Dockerfile: code.DOCKERFILE,
        "src/index.ts": code.INDEX_V1,
        "assets/logo.png": code.png("logo"),
      },
    }),
    c("ci", ["initial"], at(11, 22), DEV, "ci: run the tests on every push", {
      body: "Build and test on every push to main, dev and the release branches, and on pull requests.",
      files: { ".github/workflows/ci.yml": code.CI_YML },
    }),
    c("exp1", ["ci"], at(11, 20), LENA, "experiment: try a vertical graph layout", {
      files: { "docs/experiments/graph-layout.md": code.EXPERIMENT_V1 },
    }),
    c("pages1", [], at(11, 18), PRIYA, "docs: start the documentation site", {
      files: {
        "index.html": code.page(
          "shop",
          '<h1>shop</h1>\n<p>A small web shop. Start with the <a href="getting-started.html">getting started</a> guide.</p>',
        ),
        "css/site.css": code.SITE_CSS,
      },
    }),
    c("search1", ["ci"], at(11, 12), MEI, "feat(search): index product names", {
      body: "Builds the index from data/products.csv at startup: 6,000 products, about 40 ms.",
      files: { "src/search/index.ts": code.SEARCH_V1, "data/products.csv": code.productsCsv() },
    }),
    c("cart", ["ci"], at(11), ANA, "feat(cart): add the cart service", {
      body: "Lines, quantities, percentage and fixed discounts, and the badge on the cart button.\n\nThe payment gateway client comes along: checkout will need it.",
      files: {
        ...manifestFiles(SHOP_MANIFESTS.cart),
        ...manifestFiles(ADMIN_MANIFEST, "admin"),
        "src/cart/cart.ts": code.CART_V1,
        "src/cart/discount.ts": code.DISCOUNT_V1,
        "src/cart/cart.test.ts": code.CART_TEST,
        "src/cart/badge.ts": code.BADGE_V1,
        "src/cart/CartButton.tsx": code.CART_BUTTON_V1,
        "src/cart/routes.ts": code.CART_ROUTES,
        "src/payments/gateway.ts": code.GATEWAY_V1,
      },
      edits: {
        "src/index.ts": code.replace(
          [
            'import { serve } from "bun";\n',
            'import { serve } from "bun";\nimport { cartRoutes } from "./cart/routes";\n',
          ],
          [
            "    const url = new URL(request.url);\n",
            '    const url = new URL(request.url);\n    if (url.pathname.startsWith("/cart")) return cartRoutes(request);\n',
          ],
        ),
      },
    }),
    // ── Eleven Renovate pull requests from one commit, crossed by the long-lived search and experiment branches ──
    ...lanes,
    c("exp2", ["exp1"], at(10, 6), LENA, "experiment: draw merges as curves", {
      edits: {
        "docs/experiments/graph-layout.md": old =>
          `${old}\n## Try 2: curves\n\n- A merge bends from its lane into the target lane instead of a corner.\n- Needs half-cell glyphs; most terminal fonts draw them, some leave gaps.\n`,
      },
    }),
    c("search2", ["search1"], at(9, 20), MEI, "feat(search): rank results by popularity", {
      files: { "src/search/ranking.ts": code.RANKING_V1 },
      edits: { "src/search/index.ts": code.replace(...code.SEARCH_RANKED) },
    }),
    c("rounding", ["cart"], at(9), JONAS, "fix(cart): round discounts to cents", {
      body: "Rounding after each discount made big carts drift by a cent against the gateway. Keep the fractions and\nround once, half up, at the end.\n\nFixes #31",
      files: manifestFiles(SHOP_MANIFESTS.rounding),
      edits: { "src/cart/discount.ts": code.replace(...code.DISCOUNT_ROUNDING) },
    }),
    // ── A release branch, a hotfix merged into both, backports later ──
    c("rel140", ["rounding"], at(8, 20), DEV, "chore(release): 1.4.0", {
      files: { "src/version.ts": code.version("1.4.0") },
      edits: {
        "CHANGELOG.md": code.release("1.4.0", [
          "Cart with percentage and fixed discounts",
          "Discounts are rounded to cents once, at the end",
        ]),
      },
    }),
    c("hotfix", ["rel140"], at(8, 16), JONAS, "fix(cart): do not overflow the discount total", {
      body: "A 20 EUR voucher on a 15 EUR order paid the customer 5 EUR.",
      edits: { "src/cart/discount.ts": code.replace(...code.DISCOUNT_OVERFLOW) },
    }),
    merge(
      "relHotfix",
      ["rel140", "hotfix"],
      at(8, 14),
      JONAS,
      "Merge branch 'hotfix/discount-overflow' into release/1.x",
    ),
    c("rel141", ["relHotfix"], at(8, 13), DEV, "chore(release): 1.4.1", {
      files: { "src/version.ts": code.version("1.4.1") },
      edits: {
        "CHANGELOG.md": code.release("1.4.1", ["A discount larger than the order no longer makes the total negative"]),
      },
    }),
    merge("mainHotfix", ["rounding", "hotfix"], at(8, 12), JONAS, "Merge branch 'hotfix/discount-overflow'"),
    c("exp3", ["exp2"], at(8), LENA, "experiment: compare both layouts side by side", {
      edits: {
        "docs/experiments/graph-layout.md": old =>
          `${old}\n## Comparison\n\n| | Vertical | Curves |\n|---|---|---|\n| 14 lanes in 80 columns | yes | no |\n| Merges easy to follow | so-so | yes |\n| Works in every font | yes | no |\n`,
      },
    }),
    // ── Stacked branches: checkout-ui on checkout-api, merged into it, then into main ──
    c("api1", ["mainHotfix"], at(7, 22), TOM, "feat(checkout): add the checkout endpoint", {
      files: { "src/checkout/api.ts": code.CHECKOUT_API_V1 },
    }),
    c("api2", ["api1"], at(7, 20), TOM, "feat(checkout): validate the cart before paying", {
      files: { "src/checkout/errors.ts": code.CHECKOUT_ERRORS },
      edits: { "src/checkout/api.ts": code.replace(...code.CHECKOUT_VALIDATE) },
    }),
    c("ui1", ["api2"], at(7, 18), SAM, "feat(checkout): add the checkout page", {
      files: { "src/checkout/CheckoutPage.tsx": code.CHECKOUT_PAGE_V1 },
    }),
    c("api3", ["api2"], at(7, 16), TOM, "test(checkout): cover empty carts", {
      files: { "src/checkout/api.test.ts": code.CHECKOUT_API_TEST },
    }),
    c("ui2", ["ui1"], at(7, 14), SAM, "feat(checkout): show the order summary", {
      files: { "src/checkout/OrderSummary.tsx": code.ORDER_SUMMARY },
      edits: { "src/checkout/CheckoutPage.tsx": code.replace(...code.CHECKOUT_PAGE_SUMMARY) },
    }),
    merge("apiUi", ["api3", "ui2"], at(7, 10), TOM, "Merge branch 'feature/checkout-ui' into feature/checkout-api"),
    merge(
      "mainApi",
      ["mainHotfix", "apiUi"],
      at(7, 6),
      TOM,
      "Merge pull request #12 from demo/feature/checkout-api",
      "Checkout: endpoint, validation and page",
    ),
    c("pages2", ["pages1"], at(7), PRIYA, "docs: add the getting started page", {
      files: {
        "getting-started.html": code.page(
          "Getting started",
          "<h1>Getting started</h1>\n<pre>bun install\nbun test\nbun run dev</pre>",
        ),
      },
    }),
    c("search3", ["search2"], at(6, 22), MEI, "feat(search): highlight matching words", {
      files: { "src/search/highlight.ts": code.HIGHLIGHT },
      edits: { "src/search/index.ts": code.replace(...code.SEARCH_HIGHLIGHT_IMPORT) },
    }),
    merge("searchSync", ["search3", "mainApi"], at(6, 20), MEI, "Merge branch 'main' into feature/search"),
    // ── Criss-cross: inventory and pricing merge each other, then both go into main ──
    c("inv1", ["mainApi"], at(6, 16), ANA, "feat(inventory): reserve items while paying", {
      files: { "src/inventory/reservations.ts": code.RESERVATIONS_V1 },
    }),
    c("price1", ["mainApi"], at(6, 14), JONAS, "feat(pricing): price lists per country", {
      files: {
        "src/pricing/price-lists.ts": code.PRICE_LISTS_V1,
        "data/prices/de.json": code.priceList("de"),
        "data/prices/fr.json": code.priceList("fr"),
        "data/prices/nl.json": code.priceList("nl"),
      },
    }),
    merge("invX", ["inv1", "price1"], at(6, 12), ANA, "Merge branch 'feature/pricing' into feature/inventory"),
    merge("priceX", ["price1", "inv1"], at(6, 10), JONAS, "Merge branch 'feature/inventory' into feature/pricing"),
    c("inv2", ["invX"], at(6, 8), ANA, "feat(inventory): release reservations after 15 minutes", {
      body: "A payment that takes longer than 15 minutes has failed; holding the items for an hour sold out the sale.",
      edits: { "src/inventory/reservations.ts": code.replace(...code.RESERVATIONS_EXPIRY) },
    }),
    c("price2", ["priceX"], at(6, 6), JONAS, "feat(pricing): round prices per currency", {
      files: { "src/pricing/currency.ts": code.CURRENCY },
      edits: { "src/pricing/price-lists.ts": code.replace(...code.PRICE_LISTS_CURRENCY) },
    }),
    merge("mainInv", ["mainApi", "inv2"], at(5, 22), ANA, "Merge pull request #15 from demo/feature/inventory"),
    merge("mainPrice", ["mainInv", "price2"], at(5, 20), JONAS, "Merge pull request #16 from demo/feature/pricing"),
    // ── An unrelated history (its own root) merged into main ──
    c("legacy1", [], at(5, 18), DEV, "chore: import the legacy deploy scripts", {
      body: "From the old build server, as they were. Windows line endings in install.bat.",
      files: {
        "deploy/deploy.sh": code.DEPLOY_SH_V1,
        "deploy/install.bat": code.INSTALL_BAT,
        "deploy/README.txt": "Deploy scripts from the old build server.\nRun deploy.sh from the repository root.\n",
      },
    }),
    c("legacy2", ["legacy1"], at(5, 16), DEV, "chore: make the deploy scripts portable", {
      body: "POSIX sh, podman instead of docker, no fixed paths, and executable. The Windows installer is gone: nothing\nruns on that server any more.",
      files: { "deploy/deploy.sh": { content: code.DEPLOY_SH_V2, mode: "100755" } },
      deletes: ["deploy/install.bat"],
    }),
    // ── An octopus merge of four dependency branches ──
    c("depLodash", ["mainPrice"], at(5, 12), DEV, "chore(deps): plan the lodash upgrade", {
      files: {
        "docs/adr/0003-upgrade-lodash.md": code.adr(3, "Upgrade lodash", "lodash 4.17.20", "lodash 4.17.21", [
          "Fixes the prototype pollution in `zipObjectDeep`.",
        ]),
      },
    }),
    c("depAxios", ["mainPrice"], at(5, 11), DEV, "chore(deps): plan the axios upgrade", {
      files: {
        "docs/adr/0004-upgrade-axios.md": code.adr(4, "Upgrade axios", "axios 1.6.0", "axios 1.7", [
          "The fetch adapter becomes the default on Bun.",
        ]),
      },
    }),
    c("depJest", ["mainPrice"], at(5, 10), DEV, "chore(deps): plan the jest upgrade", {
      files: {
        "docs/adr/0005-upgrade-jest.md": code.adr(5, "Upgrade jest", "jest 29", "jest 30", [
          "Snapshots need a rewrite: the format changed.",
          "We could drop jest for bun test instead; see the next ADR.",
        ]),
      },
    }),
    c("depTs", ["mainPrice"], at(5, 9), DEV, "chore(deps): plan the typescript upgrade", {
      files: {
        "docs/adr/0006-upgrade-typescript.md": code.adr(6, "Upgrade TypeScript", "TypeScript 5.4", "TypeScript 5.5", [
          "Inferred type predicates remove a dozen `as` casts in src/search.",
        ]),
      },
    }),
    merge(
      "octopus",
      ["mainPrice", "depLodash", "depAxios", "depJest", "depTs"],
      at(5, 6),
      DEV,
      "Merge branches 'deps/lodash', 'deps/axios', 'deps/jest' and 'deps/typescript'",
      "The upgrade plans, one ADR each.",
    ),
    merge(
      "legacyMerge",
      ["octopus", "legacy2"],
      at(5, 2),
      DEV,
      "Merge branch 'import/legacy-scripts'",
      "The deploy scripts join the repository with their history (--allow-unrelated-histories).",
    ),
    c("pages3", ["pages2"], at(5), PRIYA, "docs: document the cart API", {
      files: {
        "cart-api.html": code.page(
          "Cart API",
          "<h1>Cart API</h1>\n<pre>GET  /cart\nPOST /cart/lines {sku, quantity}\nDELETE /cart/lines/:sku</pre>",
        ),
      },
    }),
    // ── A change and its revert ──
    c("ship", ["legacyMerge"], at(4, 20), ANA, "feat(cart): free shipping over 50", {
      files: { "src/cart/shipping.ts": code.SHIPPING },
      edits: { "src/cart/cart.ts": code.replace(...code.CART_SHIPPING) },
    }),
    c("revert", ["ship"], at(4, 16), ANA, 'Revert "feat(cart): free shipping over 50"', {
      body: "This reverts the free shipping change. The warehouse cannot ship for free yet.",
      deletes: ["src/cart/shipping.ts"],
      edits: { "src/cart/cart.ts": code.replace(...inverse(code.CART_SHIPPING)) },
    }),
    c("backport", ["rel141"], at(4, 12), JONAS, "fix(payments): time out after 30 seconds", {
      body: "The gateway sometimes never answers; without a timeout the checkout hangs until the browser gives up.\n\n(cherry picked from the payments work on main)",
      edits: { "src/payments/gateway.ts": code.replace(...code.GATEWAY_TIMEOUT) },
    }),
    c("rel142", ["backport"], at(4, 10), DEV, "chore(release): 1.4.2", {
      files: { "src/version.ts": code.version("1.4.2") },
      edits: { "CHANGELOG.md": code.release("1.4.2", ["Payments time out after 30 seconds instead of hanging"]) },
    }),
    merge("mainRelease", ["revert", "rel142"], at(4, 6), JONAS, "Merge branch 'release/1.x'"),
    c("search4", ["searchSync"], at(4), MEI, "feat(search): search as you type", {
      files: { "src/search/index.test.ts": code.SEARCH_TEST },
      edits: { "src/search/index.ts": code.replace(...code.SEARCH_AS_YOU_TYPE) },
    }),
    // ── Six branches out of one commit, merged back one by one, crossing each other ──
    c("a11y1", ["mainRelease"], at(3, 20), PRIYA, "fix(a11y): label the cart buttons", {
      edits: { "src/cart/CartButton.tsx": code.replace(...code.CART_BUTTON_LABELS) },
    }),
    c("dark1", ["mainRelease"], at(3, 18), LENA, "feat(theme): dark mode", {
      files: {
        "src/theme/theme.ts": code.THEME_V1,
        "src/theme/dark.css": code.DARK_CSS_V1,
        "assets/logo.png": code.png("logo-2"),
        "assets/logo-dark.png": code.png("logo-dark"),
      },
    }),
    c("i18n1", ["mainRelease"], at(3, 16), SAM, "feat(i18n): extract the checkout strings", {
      files: { "src/i18n/en.json": code.strings("en"), "src/i18n/index.ts": code.I18N_INDEX },
    }),
    c("dash1", ["mainRelease"], at(3, 14), TOM, "feat(metrics): sales dashboard", {
      files: {
        "src/metrics/SalesDashboard.tsx": code.DASHBOARD_V1,
        "public/vendor/chart.min.js": code.minifiedChart(),
      },
    }),
    c("badge1", ["mainRelease"], at(3, 12), NOAH, "fix(cart): update the badge after removing an item", {
      body: "The badge read the count once, so removing an item left the old number until the page reloaded.\n\nFixes #44",
      edits: { "src/cart/badge.ts": code.replace(...code.BADGE_FIX) },
    }),
    c("lint1", ["mainRelease"], at(3, 10), DEV, "chore(lint): move to ESLint 9", {
      body: "ESLint 9 only reads the flat config: .eslintrc.json becomes eslint.config.js.",
      files: { "eslint.config.js": code.ESLINT_FLAT },
      deletes: [".eslintrc.json"],
    }),
    c("a11y2", ["a11y1"], at(3, 8), PRIYA, "fix(a11y): announce cart updates", {
      files: { "src/a11y/announcer.ts": code.ANNOUNCER },
      edits: { "src/cart/CartButton.tsx": code.replace(...code.CART_BUTTON_ANNOUNCE) },
    }),
    c("i18n2", ["i18n1"], at(3, 6), SAM, "feat(i18n): add German", {
      files: { "src/i18n/de.json": code.strings("de") },
      edits: { "src/i18n/index.ts": code.replace(...code.addLocale("de", '"en"', '"en" | "de"')) },
    }),
    merge("mainBadge", ["mainRelease", "badge1"], at(3, 4), NOAH, "Merge pull request #21 from demo/bugfix/cart-badge"),
    c("dark2", ["dark1"], at(3, 2), LENA, "feat(theme): follow the system setting", {
      edits: { "src/theme/theme.ts": code.replace(...code.THEME_SYSTEM) },
    }),
    c("dash2", ["dash1"], at(3), TOM, "feat(metrics): weekly totals", {
      edits: { "src/metrics/SalesDashboard.tsx": code.replace(...code.DASHBOARD_WEEKLY) },
    }),
    merge("mainLint", ["mainBadge", "lint1"], at(2, 22), DEV, "Merge pull request #22 from demo/chore/eslint-9"),
    merge("i18nSync", ["i18n2", "mainLint"], at(2, 20), SAM, "Merge branch 'main' into feature/i18n"),
    merge("mainA11y", ["mainLint", "a11y2"], at(2, 18), PRIYA, "Merge pull request #20 from demo/feature/a11y"),
    c("i18n3", ["i18nSync"], at(2, 16), SAM, "feat(i18n): add French", {
      files: { "src/i18n/fr.json": code.strings("fr") },
      edits: { "src/i18n/index.ts": code.replace(...code.addLocale("fr", '"en" | "de"', '"en" | "de" | "fr"')) },
    }),
    c("search5", ["search4"], at(2, 14), MEI, "fix(search): ignore accents", {
      body: '"creme" did not find "Crème brûlée".',
      edits: { "src/search/ranking.ts": code.replace(...code.RANKING_ACCENTS) },
    }),
    merge("mainSearch", ["mainA11y", "search5"], at(2, 12), MEI, "Merge pull request #9 from demo/feature/search"),
    merge("mainI18n", ["mainSearch", "i18n3"], at(2, 8), SAM, "Merge pull request #23 from demo/feature/i18n"),
    c("dash3", ["dash2"], at(2), TOM, "feat(metrics): export as CSV", {
      edits: { "src/metrics/SalesDashboard.tsx": code.replace(...code.DASHBOARD_CSV) },
    }),
    c("dark3", ["dark2"], at(1, 20), LENA, "wip(theme): contrast tweaks", {
      edits: { "src/theme/dark.css": code.replace(...code.DARK_CSS_CONTRAST) },
    }),
    c("pages4", ["pages3"], at(1), PRIYA, "docs: publish the 1.4.2 release notes", {
      files: {
        "releases.html": code.page(
          "Releases",
          "<h1>1.4.2</h1>\n<p>Payments time out after 30 seconds instead of hanging.</p>",
        ),
      },
      edits: {
        "index.html": code.replace([
          '<a href="cart-api.html">Cart API</a></nav>',
          '<a href="cart-api.html">Cart API</a> · <a href="releases.html">Releases</a></nav>',
        ]),
      },
    }),
    c("perf", ["mainI18n"], at(0, 20), NOAH, "perf(cart): cache price lookups", {
      body: "The total was recomputed on every render: 30% of the checkout page's CPU time in the profile.",
      files: { "src/cart/price-cache.ts": code.PRICE_CACHE },
      edits: { "src/cart/cart.ts": code.replace(...code.CART_CACHE) },
    }),
    // ── The top rows the provider data is about ──
    c(
      "payments",
      ["perf"],
      at(0, 7),
      DEV,
      "feat(payments): retry failed payments with exponential backoff, and a subject long enough to need cutting",
      {
        body: "Timeouts and 5xx answers are retried after 1s and 2s with the same idempotency key, so the gateway charges at\nmost once. 4xx answers are final.\n\nCloses #52",
        files: {
          ...manifestFiles(SHOP_MANIFESTS.payments),
          "src/payments/retry.ts": code.RETRY,
          "src/payments/retry.test.ts": code.RETRY_TEST,
          "src/payments/gateway-client-with-a-long-file-name.test.ts": code.gatewayClientTest(),
        },
        edits: { "src/payments/gateway.ts": code.replace(...code.GATEWAY_IDEMPOTENCY) },
      },
    ),
    c("retry", ["payments"], at(0, 6), MEI, "wip(payments): retry policy types", {
      files: { "src/payments/retry-policy-with-exponential-backoff.ts": code.RETRY_POLICY },
    }),
    c(
      "readme",
      ["payments"],
      at(0, 1),
      NOAH,
      "docs: rewrite the README for the new cart flow 🚀 and explain how discounts are rounded",
      { files: { "README.md": code.README_V2 } },
    ),
    c("health", ["readme"], at(0, 0, 50), DEV, "feat(api): add a health endpoint", {
      body: "/health/live and /health/ready for the OpenShift probes.",
      files: { "src/api/health.ts": code.HEALTH },
      edits: {
        "src/index.ts": code.replace(
          ['import { serve } from "bun";\n', 'import { serve } from "bun";\nimport { health } from "./api/health";\n'],
          [
            "    const url = new URL(request.url);\n",
            "    const url = new URL(request.url);\n    const probe = health(request);\n    if (probe) return probe;\n",
          ],
        ),
      },
    }),
    c("metrics", ["health"], at(0, 0, 5), DEV, "feat(api): export request metrics", {
      files: { "src/api/metrics.ts": code.METRICS },
      edits: {
        "src/index.ts": code.replace(
          [
            'import { serve } from "bun";\n',
            'import { serve } from "bun";\nimport { metrics } from "./api/metrics";\n',
          ],
          [
            "    if (probe) return probe;\n",
            '    if (probe) return probe;\n    if (url.pathname === "/metrics") return metrics();\n',
          ],
        ),
      },
    }),
    // Pushed to origin/dev when the world moves on (phase 2); never a local branch.
    c("next", ["metrics"], 0, DEV, "fix(api): pin the metrics exporter version", {
      body: "15.1.1 changed the label order and broke the dashboards.",
      edits: {
        "src/api/metrics.ts": code.replace([
          'const EXPORTER_VERSION = "^15.1.0";',
          'const EXPORTER_VERSION = "15.1.0";',
        ]),
      },
    }),
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

const WEB_PRICE_V1 = `/** Formats cents as a price: 990 -> "9.9". */
export function formatPrice(cents: number): string {
  return String(cents / 100);
}
`;

export function webHistory(): HistorySpec {
  return {
    commits: [
      c("initial", [], at(3), ANA, "chore: initial commit", {
        files: {
          "README.md": "# shop-web\n\nThe shop's storefront.\n",
          "package.json": `${JSON.stringify({ name: "shop-web", private: true, scripts: { dev: "vite", test: "bun test" } }, null, 2)}\n`,
          "src/price.ts": WEB_PRICE_V1,
        },
      }),
      c("gallery", ["initial"], at(2), ANA, "feat(web): product page with an image gallery", {
        files: {
          "src/ProductPage.tsx": `import { formatPrice } from "./price";\nimport { Gallery } from "./Gallery";\n\nexport function ProductPage({ product }: { product: { name: string; price: number; images: string[] } }) {\n  return (\n    <article>\n      <Gallery images={product.images} />\n      <h1>{product.name}</h1>\n      <p className="price">{formatPrice(product.price)} EUR</p>\n    </article>\n  );\n}\n`,
          "src/Gallery.tsx": `import { useState } from "react";\n\nexport function Gallery({ images }: { images: string[] }) {\n  const [index, setIndex] = useState(0);\n  return (\n    <div className="gallery">\n      <img src={images[index]} alt="" />\n      {images.map((image, i) => (\n        <button key={image} type="button" aria-label={\`Image \${i + 1}\`} onClick={() => setIndex(i)} />\n      ))}\n    </div>\n  );\n}\n`,
        },
      }),
      c("prices", ["gallery"], at(0, 3), JONAS, "fix(web): show prices with two decimals", {
        body: "9.9 EUR looked like a typo.",
        edits: {
          "src/price.ts": code.replace(
            ['/** Formats cents as a price: 990 -> "9.9". */', '/** Formats cents as a price: 990 -> "9.90". */'],
            ["  return String(cents / 100);", "  return (cents / 100).toFixed(1);"],
          ),
        },
      }),
    ],
    refs: { "refs/heads/main": "prices" },
  };
}
