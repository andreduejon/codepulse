/**
 * The shop's files at each commit that touches them (repositories.ts says which commit writes what). They read like
 * a small TypeScript shop, so the diff, blame and file views have real code to show: hunks in the middle of files,
 * a rename, a deletion, a binary logo, an executable script, Windows line endings, a minified file with one very long
 * line, and a CSV longer than the app shows in one diff.
 */
import { seeded } from "./random";

/** An edit that replaces one piece of a file; it fails loudly when the piece is not there. */
export function replace(...pairs: [from: string, to: string][]): (old: string) => string {
  return old =>
    pairs.reduce((text, [from, to]) => {
      if (!text.includes(from)) throw new Error(`Demo edit: "${from.slice(0, 60)}" is not in the file`);
      return text.replace(from, to);
    }, old);
}

/** The 1-based line a piece of text is on (annotations point at it). */
export function lineOf(content: string, piece: string): number {
  const index = content.indexOf(piece);
  if (index < 0) throw new Error(`Demo content: "${piece}" is not there`);
  return content.slice(0, index).split("\n").length;
}

/** An edit that adds lines after a line that is there. */
export const insertAfter = (anchor: string, lines: string) => replace([anchor, `${anchor}${lines}`]);

// ── Project files ────────────────────────────────────────────────────────────

export const README_V1 = `# shop

A small web shop: a cart, discounts and payments.

## Development

\`\`\`sh
bun install
bun test
\`\`\`
`;

export const README_V2 = `# shop

A small web shop: a cart with discounts, checkout, payments with retries, search, inventory and price lists.
The API runs on Bun; the pages are React.

## The cart flow

1. **Add.** Items go into the cart with their price list's price. The cart badge counts them.
2. **Discount.** Discounts apply per line, then per order, and are rounded to cents at the end, never in
   between. A discount never makes the total negative.
3. **Reserve.** Checkout reserves the items for 15 minutes while the payment runs.
4. **Pay.** The payment gateway is called with an idempotency key. Failed calls are retried with exponential
   backoff (1s, 2s, 4s) and give up after three attempts.

Shipping is free from 50 in the cart's currency. (Not yet: see the revert in 1.4.2.)

## Development

\`\`\`sh
bun install
bun test            # unit tests
bun run lint        # ESLint 9 with the flat config
bun run dev         # API on :8080 with reload
\`\`\`

Copy \`.env.example\` to \`.env\` and set \`PAYMENT_GATEWAY_URL\` to the sandbox gateway.

## Deploying

\`deploy/deploy.sh\` builds the image and rolls it out to OpenShift (\`shop-dev\`, then \`shop-test\`). Production
deploys go through the release branch and the \`Deploy to shop-prod\` workflow.

## Layout

| Path | What |
|------|------|
| \`src/cart\` | Cart, discounts, the badge |
| \`src/checkout\` | Checkout API and page |
| \`src/payments\` | Gateway client and retries |
| \`src/search\` | Product search, ranking, highlighting |
| \`src/inventory\` | Reservations |
| \`src/pricing\` | Price lists per country |
| \`src/api\` | Health and metrics endpoints |
`;

export const CHANGELOG_V1 = `# Changelog

## Unreleased
`;

export const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["src"]
}
`;

export const GITIGNORE = "node_modules/\ndist/\ncoverage/\n.env\n*.log\n";
export const EDITORCONFIG =
  "root = true\n\n[*]\nindent_style = space\nindent_size = 2\nend_of_line = lf\ninsert_final_newline = true\n";
export const ESLINTRC = `{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "rules": {
    "@typescript-eslint/no-unused-vars": "warn"
  }
}
`;
export const ESLINT_FLAT = `import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  rules: {
    "@typescript-eslint/no-unused-vars": "warn",
  },
});
`;

export const DOCKERFILE = `FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8080
CMD ["node", "dist/index.js"]
`;

export const CI_YML = `name: CI

on:
  push:
    branches: [main, dev, "release/**"]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install --frozen-lockfile
      - run: bun run build

  test:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install --frozen-lockfile
      - run: bun test --coverage
      - uses: codecov/codecov-action@v4
        with:
          files: coverage/lcov.info
`;

export const INDEX_V1 = `import { serve } from "bun";

const port = Number(process.env.PORT ?? 8080);

serve({
  port,
  fetch(request) {
    const url = new URL(request.url);
    return new Response(\`Not found: \${url.pathname}\`, { status: 404 });
  },
});

console.log(\`shop listening on :\${port}\`);
`;

/** The routes file grows as features land (cart, health, metrics). */
export const indexWith = (routes: string[]) =>
  INDEX_V1.replace(
    "    const url = new URL(request.url);\n",
    `    const url = new URL(request.url);\n${routes.map(route => `    ${route}\n`).join("")}`,
  );

// ── Cart ─────────────────────────────────────────────────────────────────────

export const CART_V1 = `import { applyDiscounts, type Discount } from "./discount";

export interface CartLine {
  sku: string;
  name: string;
  quantity: number;
  /** Unit price in cents. */
  price: number;
}

export class Cart {
  private lines = new Map<string, CartLine>();
  private discounts: Discount[] = [];

  add(line: CartLine): void {
    const existing = this.lines.get(line.sku);
    if (existing) existing.quantity += line.quantity;
    else this.lines.set(line.sku, { ...line });
  }

  remove(sku: string, quantity = Number.POSITIVE_INFINITY): void {
    const existing = this.lines.get(sku);
    if (!existing) return;
    existing.quantity -= quantity;
    if (existing.quantity <= 0) this.lines.delete(sku);
  }

  applyDiscount(discount: Discount): void {
    this.discounts.push(discount);
  }

  get count(): number {
    let count = 0;
    for (const line of this.lines.values()) count += line.quantity;
    return count;
  }

  get subtotal(): number {
    let subtotal = 0;
    for (const line of this.lines.values()) subtotal += line.price * line.quantity;
    return subtotal;
  }

  get total(): number {
    return applyDiscounts(this.subtotal, this.discounts);
  }

  toJSON() {
    return { lines: [...this.lines.values()], subtotal: this.subtotal, total: this.total };
  }
}
`;

export const CART_ROUTES = `import { Cart } from "./cart";

const carts = new Map<string, Cart>();

/** GET /cart, POST /cart/lines {sku, name, quantity, price}, DELETE /cart/lines/:sku */
export async function cartRoutes(request: Request): Promise<Response> {
  const session = request.headers.get("x-session") ?? "anonymous";
  const cart = carts.get(session) ?? new Cart();
  carts.set(session, cart);
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === "/cart") return Response.json(cart);
  if (request.method === "POST" && pathname === "/cart/lines") {
    cart.add(await request.json());
    return Response.json(cart, { status: 201 });
  }
  const remove = /^/cart/lines/([^/]+)$/.exec(pathname);
  if (request.method === "DELETE" && remove?.[1]) {
    cart.remove(decodeURIComponent(remove[1]));
    return Response.json(cart);
  }
  return new Response("Not found", { status: 404 });
}
`;

export const SHIPPING = `/** Orders from this subtotal (in cents) ship for free. */
export const FREE_SHIPPING_FROM = 5000;
export const SHIPPING_COST = 495;

export function shippingFor(subtotal: number): number {
  return subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_COST;
}
`;

export const CART_SHIPPING: [string, string][] = [
  [
    'import { applyDiscounts, type Discount } from "./discount";\n',
    'import { applyDiscounts, type Discount } from "./discount";\nimport { shippingFor } from "./shipping";\n',
  ],
  [
    "  get total(): number {\n    return applyDiscounts(this.subtotal, this.discounts);\n  }\n",
    "  get shipping(): number {\n    return shippingFor(this.subtotal);\n  }\n\n  get total(): number {\n    return applyDiscounts(this.subtotal, this.discounts) + this.shipping;\n  }\n",
  ],
];

export const CART_CACHE: [string, string][] = [
  [
    'import { applyDiscounts, type Discount } from "./discount";\n',
    'import { applyDiscounts, type Discount } from "./discount";\nimport { PriceCache } from "./price-cache";\n',
  ],
  [
    "  private discounts: Discount[] = [];\n",
    "  private discounts: Discount[] = [];\n  private readonly totals = new PriceCache();\n",
  ],
  [
    "  get total(): number {\n    return applyDiscounts(this.subtotal, this.discounts);\n  }\n",
    "  get total(): number {\n    // Totals are asked for on every render; the cache key changes with the lines and discounts.\n    return this.totals.get(this.lines, this.discounts, () => applyDiscounts(this.subtotal, this.discounts));\n  }\n",
  ],
];

export const PRICE_CACHE = `import type { CartLine } from "./cart";
import type { Discount } from "./discount";

/** Remembers the last total until the lines or discounts change. */
export class PriceCache {
  private key = "";
  private value = 0;

  get(lines: Map<string, CartLine>, discounts: readonly Discount[], compute: () => number): number {
    const key = JSON.stringify([[...lines.values()], discounts]);
    if (key !== this.key) {
      this.key = key;
      this.value = compute();
    }
    return this.value;
  }
}
`;

export const DISCOUNT_V1 = `export type Discount = { kind: "percent"; value: number } | { kind: "amount"; value: number };

/** Applies discounts in order: percentages first, then fixed amounts. */
export function applyDiscounts(subtotal: number, discounts: readonly Discount[]): number {
  let total = subtotal;
  for (const discount of discounts.filter(d => d.kind === "percent")) {
    total -= total * (discount.value / 100);
  }
  for (const discount of discounts.filter(d => d.kind === "amount")) {
    total -= discount.value;
  }
  return total;
}
`;

export const DISCOUNT_ROUNDING: [string, string][] = [
  [
    "    total -= total * (discount.value / 100);\n",
    "    // Keep fractions of a cent until the end: rounding each step drifts by a cent on big carts.\n    total -= total * (discount.value / 100);\n",
  ],
  [
    "  return total;\n}\n",
    "  return roundToCents(total);\n}\n\n/** Half up, like the payment gateway. */\nexport function roundToCents(amount: number): number {\n  return Math.round(amount + Number.EPSILON);\n}\n",
  ],
];

export const DISCOUNT_OVERFLOW: [string, string][] = [
  [
    "  return roundToCents(total);\n",
    "  // Discounts larger than the order must not pay the customer.\n  return roundToCents(Math.max(total, 0));\n",
  ],
];

export const CART_TEST = `import { describe, expect, test } from "bun:test";
import { Cart } from "./cart";

const book = { sku: "BOOK-1", name: "A book", quantity: 1, price: 1299 };
const pen = { sku: "PEN-2", name: "A pen", quantity: 3, price: 249 };

describe("cart", () => {
  test("adds an item", () => {
    const cart = new Cart();
    cart.add(book);
    expect(cart.count).toBe(1);
    expect(cart.subtotal).toBe(1299);
  });

  test("adds to an existing line", () => {
    const cart = new Cart();
    cart.add(pen);
    cart.add(pen);
    expect(cart.count).toBe(6);
  });

  test("removes a line", () => {
    const cart = new Cart();
    cart.add(book);
    cart.remove(book.sku);
    expect(cart.count).toBe(0);
  });

  test("rounds discounts to cents", () => {
    const cart = new Cart();
    cart.add(pen);
    cart.applyDiscount({ kind: "percent", value: 15 });
    expect(cart.total).toBe(635);
  });
});
`;

export const BADGE_V1 = `import type { Cart } from "./cart";

/** The number on the cart icon: nothing when the cart is empty, 99+ past 99. */
export function badgeText(cart: Cart): string {
  const count = cart.count;
  if (count === 0) return "";
  return count > 99 ? "99+" : String(count);
}
`;

export const BADGE_FIX: [string, string][] = [
  [
    "export function badgeText(cart: Cart): string {\n  const count = cart.count;\n",
    "export function badgeText(cart: Cart): string {\n  // Read the count every time: removing an item mutates the cart, it does not replace it.\n  const count = cart.count;\n",
  ],
  [
    '  return count > 99 ? "99+" : String(count);\n}\n',
    '  return count > 99 ? "99+" : String(count);\n}\n\nexport function subscribeBadge(cart: Cart, render: (text: string) => void): () => void {\n  const update = () => render(badgeText(cart));\n  update();\n  return cart.onChange(update);\n}\n',
  ],
];

export const CART_BUTTON_V1 = `import type { Cart } from "./cart";
import { badgeText } from "./badge";

export function CartButton({ cart, onOpen }: { cart: Cart; onOpen: () => void }) {
  return (
    <button type="button" className="cart-button" onClick={onOpen}>
      <img src="/assets/cart.svg" />
      <span className="badge">{badgeText(cart)}</span>
    </button>
  );
}
`;

export const CART_BUTTON_LABELS: [string, string][] = [
  [
    '    <button type="button" className="cart-button" onClick={onOpen}>\n      <img src="/assets/cart.svg" />\n',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the demo file's own template literal
    '    <button type="button" className="cart-button" onClick={onOpen} aria-label={`Cart, ${cart.count} items`}>\n      <img src="/assets/cart.svg" alt="" />\n',
  ],
];

export const CART_BUTTON_ANNOUNCE: [string, string][] = [
  [
    'import type { Cart } from "./cart";\n',
    'import { useEffect } from "react";\nimport { announce } from "../a11y/announcer";\nimport type { Cart } from "./cart";\n',
  ],
  [
    "export function CartButton({ cart, onOpen }: { cart: Cart; onOpen: () => void }) {\n",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the demo file's own template literal
    "export function CartButton({ cart, onOpen }: { cart: Cart; onOpen: () => void }) {\n  useEffect(() => cart.onChange(() => announce(`Cart updated, ${cart.count} items`)), [cart]);\n\n",
  ],
  [
    '      <span className="badge">{badgeText(cart)}</span>\n',
    '      <span className="badge" aria-hidden="true">\n        {badgeText(cart)}\n      </span>\n',
  ],
];

export const ANNOUNCER = `/** Screen reader announcements through one polite live region. */
let region: HTMLElement | null = null;

export function announce(message: string): void {
  if (!region) {
    region = document.createElement("div");
    region.setAttribute("aria-live", "polite");
    region.className = "visually-hidden";
    document.body.append(region);
  }
  region.textContent = "";
  // A new text node makes screen readers read the same message twice in a row.
  requestAnimationFrame(() => {
    if (region) region.textContent = message;
  });
}
`;

// ── Payments ─────────────────────────────────────────────────────────────────

export const GATEWAY_V1 = `export interface ChargeRequest {
  orderId: string;
  amount: number;
  currency: string;
}

export interface ChargeResponse {
  status: number;
  transactionId?: string;
}

const GATEWAY_URL = process.env.PAYMENT_GATEWAY_URL ?? "https://payments.internal.example/v2";

export async function charge(request: ChargeRequest): Promise<ChargeResponse> {
  const response = await fetch(\`\${GATEWAY_URL}/charge\`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = (await response.json()) as { transactionId?: string };
  return { status: response.status, transactionId: body.transactionId };
}
`;

export const GATEWAY_TIMEOUT: [string, string][] = [
  [
    'const GATEWAY_URL = process.env.PAYMENT_GATEWAY_URL ?? "https://payments.internal.example/v2";\n',
    'const GATEWAY_URL = process.env.PAYMENT_GATEWAY_URL ?? "https://payments.internal.example/v2";\n/** The gateway answers within a few seconds or not at all. */\nexport const GATEWAY_TIMEOUT_MS = 30_000;\n',
  ],
  [
    "    body: JSON.stringify(request),\n  });\n",
    "    body: JSON.stringify(request),\n    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),\n  });\n",
  ],
];

export const GATEWAY_IDEMPOTENCY: [string, string][] = [
  [
    "export async function charge(request: ChargeRequest): Promise<ChargeResponse> {\n",
    "export async function charge(request: ChargeRequest, idempotencyKey: string): Promise<ChargeResponse> {\n",
  ],
  [
    '    headers: { "content-type": "application/json" },\n',
    '    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },\n',
  ],
];

export const RETRY = `import { charge, type ChargeRequest, type ChargeResponse } from "./gateway";

export interface RetryOptions {
  attempts: number;
  /** The first wait; each next one doubles. */
  baseDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULTS: RetryOptions = { attempts: 3, baseDelayMs: 1000 };

/**
 * Charges with retries: a timeout or a 5xx answer is retried with exponential backoff, everything else is final.
 * The idempotency key stays the same, so the gateway charges at most once.
 */
export async function chargeWithRetry(request: ChargeRequest, options: Partial<RetryOptions> = {}): Promise<ChargeResponse> {
  const { attempts, baseDelayMs, sleep = defaultSleep } = { ...DEFAULTS, ...options };
  const idempotencyKey = crypto.randomUUID();
  const delay = baseDelayMs;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await charge(request, idempotencyKey);
      if (response.status < 500) return response;
      lastError = new Error(\`Gateway answered \${response.status}\`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
  }
  throw new Error(\`Payment failed after \${attempts} attempts\`, { cause: lastError });
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
`;

/** retry.test.ts: line 42 is the assertion that fails in CI (the annotation points at it). */
export const RETRY_TEST = `import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as gateway from "./gateway";
import { chargeWithRetry } from "./retry";

const request = { orderId: "order-1", amount: 4999, currency: "EUR" };
const noSleep = () => Promise.resolve();

afterEach(() => mock.restore());

describe("retry", () => {
  test("charges once when the gateway answers", async () => {
    const charge = spyOn(gateway, "charge").mockResolvedValue({ status: 200, transactionId: "tx-1" });
    const response = await chargeWithRetry(request, { sleep: noSleep });
    expect(response.transactionId).toBe("tx-1");
    expect(charge).toHaveBeenCalledTimes(1);
  });

  test("retries a 503 and keeps the idempotency key", async () => {
    const charge = spyOn(gateway, "charge")
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 200, transactionId: "tx-2" });
    await chargeWithRetry(request, { sleep: noSleep });
    expect(charge).toHaveBeenCalledTimes(2);
    expect(charge.mock.calls[0]?.[1]).toBe(charge.mock.calls[1]?.[1]);
  });

  test("waits 1s, then 2s, between attempts", async () => {
    const waits: number[] = [];
    spyOn(gateway, "charge").mockResolvedValue({ status: 503 });
    await chargeWithRetry(request, { sleep: async ms => void waits.push(ms) }).catch(() => {});
    expect(waits).toEqual([1000, 2000]);
  });

  test("charges once after a timeout", async () => {
    spyOn(gateway, "charge")
      .mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"))
      .mockResolvedValueOnce({ status: 401 });
    const response = await chargeWithRetry(request, { sleep: noSleep });
    // The sandbox token expired on the CI runners: the second attempt is refused.
    expect(response.status).toBe(200);
  });

  test("gives up after three attempts", async () => {
    spyOn(gateway, "charge").mockResolvedValue({ status: 502 });
    await expect(chargeWithRetry(request, { sleep: noSleep })).rejects.toThrow("Payment failed after 3 attempts");
  });
});
`;

/** A long test file whose line 118 is the test that times out in CI. */
export function gatewayClientTest(): string {
  const random = seeded("gateway-client-test");
  const cases = [
    "sends the order id",
    "sends the amount in cents",
    "sends the currency in upper case",
    "adds the idempotency key",
    "reads the transaction id",
    "passes 4xx answers through",
    "passes 5xx answers through",
    "keeps the gateway URL from the environment",
    "uses the sandbox URL in tests",
    "times out after 30 seconds",
    "aborts when the caller aborts",
    "parses an empty body",
  ];
  const lines = [
    'import { describe, expect, test } from "bun:test";',
    'import { charge, GATEWAY_TIMEOUT_MS } from "./gateway";',
    "",
    "// Runs against the sandbox gateway (PAYMENT_GATEWAY_URL); slow on purpose.",
    'describe("gateway", () => {',
  ];
  for (const name of cases) {
    lines.push(`  test("${name}", async () => {`);
    for (let i = random.int(4, 7); i > 0; i--)
      lines.push(
        `    const response${i} = await charge({ orderId: "order-${random.int(100, 999)}", amount: ${random.int(100, 9999)}, currency: "EUR" }, "key-${i}");`,
        `    expect(response${i}.status).toBeLessThan(500);`,
      );
    lines.push("  });", "");
  }
  lines.push(
    '  test("gives up after three retries", async () => {',
    '    const response = await charge({ orderId: "order-slow", amount: 100, currency: "EUR" }, "key-slow");',
    "    expect(response.status).toBe(200);",
    `  }, GATEWAY_TIMEOUT_MS + 1000);`,
    "});",
  );
  return `${lines.join("\n")}\n`;
}

/** The wip branch's file: line 7 has the type error the lint job reports. */
export const RETRY_POLICY = `export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_POLICY: RetryPolicy = { maxAttempts: "3", baseDelayMs: 1000, maxDelayMs: 8000 };

export function delayFor(policy: RetryPolicy, attempt: number): number {
  return Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
}
`;

// ── Checkout ─────────────────────────────────────────────────────────────────

export const CHECKOUT_API_V1 = `import type { Cart } from "../cart/cart";
import { chargeWithRetry } from "../payments/retry";

export interface CheckoutResult {
  orderId: string;
  status: "paid" | "failed";
}

export async function checkout(cart: Cart, currency: string): Promise<CheckoutResult> {
  const orderId = crypto.randomUUID();
  try {
    await chargeWithRetry({ orderId, amount: cart.total, currency });
    return { orderId, status: "paid" };
  } catch {
    return { orderId, status: "failed" };
  }
}
`;

export const CHECKOUT_VALIDATE: [string, string][] = [
  [
    'import { chargeWithRetry } from "../payments/retry";\n',
    'import { chargeWithRetry } from "../payments/retry";\nimport { CheckoutError } from "./errors";\n',
  ],
  [
    "  const orderId = crypto.randomUUID();\n",
    '  if (cart.count === 0) throw new CheckoutError("empty-cart", "The cart is empty.");\n  if (cart.total <= 0) throw new CheckoutError("nothing-to-pay", "The total after discounts is zero.");\n  const orderId = crypto.randomUUID();\n',
  ],
];

export const CHECKOUT_ERRORS = `export type CheckoutErrorCode = "empty-cart" | "nothing-to-pay" | "out-of-stock";

export class CheckoutError extends Error {
  constructor(
    readonly code: CheckoutErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}
`;

export const CHECKOUT_API_TEST = `import { describe, expect, test } from "bun:test";
import { Cart } from "../cart/cart";
import { checkout } from "./api";

describe("checkout", () => {
  test("refuses an empty cart", async () => {
    await expect(checkout(new Cart(), "EUR")).rejects.toThrow("The cart is empty.");
  });

  test("refuses a cart that costs nothing", async () => {
    const cart = new Cart();
    cart.add({ sku: "GIFT", name: "Gift card", quantity: 1, price: 1000 });
    cart.applyDiscount({ kind: "amount", value: 1000 });
    await expect(checkout(cart, "EUR")).rejects.toThrow("The total after discounts is zero.");
  });
});
`;

export const CHECKOUT_PAGE_V1 = `import { useState } from "react";
import type { Cart } from "../cart/cart";
import { checkout } from "./api";

export function CheckoutPage({ cart }: { cart: Cart }) {
  const [state, setState] = useState<"idle" | "paying" | "paid" | "failed">("idle");

  async function pay() {
    setState("paying");
    const result = await checkout(cart, "EUR");
    setState(result.status);
  }

  return (
    <main className="checkout">
      <h1>Checkout</h1>
      <p>Total: {(cart.total / 100).toFixed(2)} EUR</p>
      <button type="button" disabled={state === "paying"} onClick={pay}>
        Pay now
      </button>
      {state === "failed" && <p className="error">The payment failed. Try again.</p>}
    </main>
  );
}
`;

export const CHECKOUT_PAGE_SUMMARY: [string, string][] = [
  [
    'import { checkout } from "./api";\n',
    'import { checkout } from "./api";\nimport { OrderSummary } from "./OrderSummary";\n',
  ],
  ["      <p>Total: {(cart.total / 100).toFixed(2)} EUR</p>\n", "      <OrderSummary cart={cart} />\n"],
];

export const ORDER_SUMMARY = `import type { Cart } from "../cart/cart";

const money = (cents: number) => \`\${(cents / 100).toFixed(2)} EUR\`;

export function OrderSummary({ cart }: { cart: Cart }) {
  const { lines, subtotal, total } = cart.toJSON();
  return (
    <table className="order-summary">
      <tbody>
        {lines.map(line => (
          <tr key={line.sku}>
            <td>{line.name}</td>
            <td>{line.quantity} ×</td>
            <td>{money(line.price)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th colSpan={2}>Subtotal</th>
          <td>{money(subtotal)}</td>
        </tr>
        <tr>
          <th colSpan={2}>Total</th>
          <td>{money(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
`;

// ── Search ───────────────────────────────────────────────────────────────────

export const SEARCH_V1 = `export interface Product {
  id: string;
  name: string;
  category: string;
}

/** Product names by word, built once at startup from data/products.csv. */
export class SearchIndex {
  private readonly byWord = new Map<string, Set<string>>();
  private readonly products = new Map<string, Product>();

  add(product: Product): void {
    this.products.set(product.id, product);
    for (const word of words(product.name)) {
      const ids = this.byWord.get(word) ?? new Set<string>();
      ids.add(product.id);
      this.byWord.set(word, ids);
    }
  }

  search(query: string): Product[] {
    const [first, ...rest] = words(query);
    if (!first) return [];
    const ids = [...(this.byWord.get(first) ?? [])].filter(id => rest.every(word => this.byWord.get(word)?.has(id)));
    return ids.flatMap(id => this.products.get(id) ?? []);
  }
}

function words(text: string): string[] {
  return text.toLowerCase().split(/\\W+/).filter(Boolean);
}
`;

export const SEARCH_RANKED: [string, string][] = [
  ["export interface Product {\n", 'import { rank } from "./ranking";\n\nexport interface Product {\n'],
  ["  category: string;\n}\n", "  category: string;\n  /** Orders in the last 30 days. */\n  popularity: number;\n}\n"],
  [
    "    return ids.flatMap(id => this.products.get(id) ?? []);\n",
    "    return rank(ids.flatMap(id => this.products.get(id) ?? []));\n",
  ],
];

export const RANKING_V1 = `import type { Product } from "./index";

/** Most ordered first; ties by name, so results do not jump between searches. */
export function rank(products: Product[]): Product[] {
  return [...products].sort((a, b) => b.popularity - a.popularity || a.name.localeCompare(b.name));
}
`;

export const RANKING_ACCENTS: [string, string][] = [
  [
    "/** Most ordered first;",
    '/** Folds accents, so "creme" finds "Crème brûlée". */\nexport function fold(text: string): string {\n  return text.normalize("NFD").replace(/\\p{Diacritic}/gu, "");\n}\n\n/** Most ordered first;',
  ],
  ["a.name.localeCompare(b.name)", 'a.name.localeCompare(b.name, "en", { sensitivity: "base" })'],
];

export const SEARCH_HIGHLIGHT_IMPORT: [string, string][] = [
  [
    'import { rank } from "./ranking";\n',
    'export { highlight } from "./highlight";\nimport { rank } from "./ranking";\n',
  ],
];

export const HIGHLIGHT = `/** Splits a name into parts, marking the ones that match a query word. */
export function highlight(name: string, query: string): { text: string; match: boolean }[] {
  const words = query.toLowerCase().split(/\\s+/).filter(Boolean);
  if (words.length === 0) return [{ text: name, match: false }];
  const pattern = new RegExp(\`(\${words.map(escape).join("|")})\`, "gi");
  return name
    .split(pattern)
    .filter(Boolean)
    .map(text => ({ text, match: words.includes(text.toLowerCase()) }));
}

const escape = (word: string) => word.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&");
`;

export const SEARCH_AS_YOU_TYPE: [string, string][] = [
  [
    "function words(text: string): string[] {",
    "/** Searches while typing: waits until the keys stop for 150 ms. */\nexport function searchAsYouType(index: SearchIndex, onResults: (products: Product[]) => void) {\n  let timer: ReturnType<typeof setTimeout> | undefined;\n  return (query: string) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => onResults(index.search(query)), 150);\n  };\n}\n\nfunction words(text: string): string[] {",
  ],
];

export const SEARCH_TEST = `import { describe, expect, test } from "bun:test";
import { SearchIndex } from "./index";

const index = new SearchIndex();
index.add({ id: "1", name: "Red running shoes", category: "shoes", popularity: 40 });
index.add({ id: "2", name: "Blue running shorts", category: "clothes", popularity: 12 });
index.add({ id: "3", name: "Red rain jacket", category: "clothes", popularity: 71 });

describe("search", () => {
  test("finds by one word", () => {
    expect(index.search("running").map(p => p.id)).toEqual(["1", "2"]);
  });

  test("needs every word", () => {
    expect(index.search("red running").map(p => p.id)).toEqual(["1"]);
  });

  test("ranks the most ordered first", () => {
    expect(index.search("red").map(p => p.id)).toEqual(["3", "1"]);
  });
});
`;

/** 6,000 products: longer than the 5,000 lines the app shows in one diff. */
export function productsCsv(): string {
  const random = seeded("products");
  const adjectives = [
    "Red",
    "Blue",
    "Green",
    "Black",
    "White",
    "Grey",
    "Small",
    "Large",
    "Classic",
    "Organic",
    "Linen",
    "Wool",
    "Leather",
    "Recycled",
    "Waterproof",
  ];
  const things = [
    "running shoes",
    "rain jacket",
    "backpack",
    "water bottle",
    "notebook",
    "coffee mug",
    "desk lamp",
    "T-shirt",
    "scarf",
    "umbrella",
    "headphones",
    "phone case",
    "tea towel",
    "cutting board",
    "plant pot",
  ];
  const categories = ["shoes", "clothes", "bags", "kitchen", "office", "electronics", "home", "garden"];
  const rows = ["id,name,category,price,stock,popularity"];
  for (let id = 1; id <= 6000; id++)
    rows.push(
      `${String(id).padStart(5, "0")},${random.pick(adjectives)} ${random.pick(things)},${random.pick(categories)},${random.int(199, 19999)},${random.int(0, 400)},${random.int(0, 120)}`,
    );
  return `${rows.join("\n")}\n`;
}

// ── Inventory and pricing ────────────────────────────────────────────────────

export const RESERVATIONS_V1 = `export interface Reservation {
  sku: string;
  quantity: number;
  orderId: string;
  expiresAt: number;
}

/** Holds stock while a payment runs, so two customers cannot buy the last item. */
export class Reservations {
  private readonly held = new Map<string, Reservation[]>();

  reserve(sku: string, quantity: number, orderId: string, now = Date.now()): Reservation {
    const reservation = { sku, quantity, orderId, expiresAt: now + 60 * 60_000 };
    this.held.set(sku, [...(this.held.get(sku) ?? []), reservation]);
    return reservation;
  }

  heldFor(sku: string, now = Date.now()): number {
    return (this.held.get(sku) ?? []).filter(r => r.expiresAt > now).reduce((sum, r) => sum + r.quantity, 0);
  }
}
`;

export const RESERVATIONS_EXPIRY: [string, string][] = [
  [
    "export interface Reservation {\n",
    "/** A payment that takes longer has failed; its items go back on sale. */\nexport const RESERVATION_MS = 15 * 60_000;\n\nexport interface Reservation {\n",
  ],
  ["expiresAt: now + 60 * 60_000 };", "expiresAt: now + RESERVATION_MS };"],
  [
    "  heldFor(sku: string, now = Date.now()): number {\n",
    "  release(orderId: string): void {\n    for (const [sku, reservations] of this.held) {\n      this.held.set(\n        sku,\n        reservations.filter(r => r.orderId !== orderId),\n      );\n    }\n  }\n\n  heldFor(sku: string, now = Date.now()): number {\n",
  ],
];

export const PRICE_LISTS_V1 = `import de from "../../data/prices/de.json";
import fr from "../../data/prices/fr.json";
import nl from "../../data/prices/nl.json";

export type Country = "DE" | "FR" | "NL";

const LISTS: Record<Country, Record<string, number>> = { DE: de, FR: fr, NL: nl };

/** The price in cents for a country; the German list is the fallback. */
export function priceFor(sku: string, country: Country): number | null {
  return LISTS[country][sku] ?? LISTS.DE[sku] ?? null;
}
`;

export const PRICE_LISTS_CURRENCY: [string, string][] = [
  [
    'import nl from "../../data/prices/nl.json";\n',
    'import nl from "../../data/prices/nl.json";\nimport { roundForCurrency } from "./currency";\n',
  ],
  [
    "  return LISTS[country][sku] ?? LISTS.DE[sku] ?? null;\n",
    '  const price = LISTS[country][sku] ?? LISTS.DE[sku];\n  return price === undefined ? null : roundForCurrency(price, "EUR");\n',
  ],
];

export const CURRENCY = `/** Cash rounding: some currencies have no 1-cent coins. */
const STEP: Record<string, number> = { EUR: 1, CHF: 5, SEK: 100 };

export function roundForCurrency(cents: number, currency: string): number {
  const step = STEP[currency] ?? 1;
  return Math.round(cents / step) * step;
}
`;

export function priceList(country: string): string {
  const random = seeded(`prices-${country}`);
  const entries = Array.from(
    { length: 40 },
    (_, i) => `  "SKU-${String(i + 1).padStart(4, "0")}": ${random.int(199, 9999)}`,
  );
  return `{\n${entries.join(",\n")}\n}\n`;
}

// ── API endpoints ────────────────────────────────────────────────────────────

export const HEALTH = `/** Liveness and readiness for OpenShift probes. */
let ready = false;

export function markReady(): void {
  ready = true;
}

export function health(request: Request): Response | null {
  const { pathname } = new URL(request.url);
  if (pathname === "/health/live") return Response.json({ status: "UP" });
  if (pathname === "/health/ready")
    return Response.json({ status: ready ? "UP" : "DOWN" }, { status: ready ? 200 : 503 });
  return null;
}
`;

export const METRICS = `/** Prometheus metrics: request counts and durations by route. */
const EXPORTER_VERSION = "^15.1.0";

const requests = new Map<string, { count: number; seconds: number }>();

export function record(route: string, seconds: number): void {
  const entry = requests.get(route) ?? { count: 0, seconds: 0 };
  entry.count += 1;
  entry.seconds += seconds;
  requests.set(route, entry);
}

export function metrics(): Response {
  const lines = ["# TYPE http_requests_total counter"];
  for (const [route, { count }] of requests) lines.push(\`http_requests_total{route="\${route}"} \${count}\`);
  lines.push("# TYPE http_request_seconds_sum counter");
  for (const [route, { seconds }] of requests) lines.push(\`http_request_seconds_sum{route="\${route}"} \${seconds}\`);
  return new Response(\`\${lines.join("\\n")}\\n\`, { headers: { "x-exporter": EXPORTER_VERSION } });
}
`;

// ── Front end: themes, i18n, metrics dashboard ───────────────────────────────

export const THEME_V1 = `export type Theme = "light" | "dark";

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
`;

export const THEME_SYSTEM: [string, string][] = [
  [
    'export type Theme = "light" | "dark";\n',
    'export type Theme = "light" | "dark" | "system";\n\nconst query = window.matchMedia("(prefers-color-scheme: dark)");\n',
  ],
  [
    "  document.documentElement.dataset.theme = theme;\n",
    '  const resolved = theme === "system" ? (query.matches ? "dark" : "light") : theme;\n  document.documentElement.dataset.theme = resolved;\n  query.onchange = theme === "system" ? () => applyTheme("system") : null;\n',
  ],
];

export const DARK_CSS_V1 = `[data-theme="dark"] {
  --background: #16161e;
  --surface: #1f2029;
  --text: #c8cad8;
  --muted: #6b6f85;
  --accent: #7aa2f7;
  --danger: #f7768e;
}
`;

export const DARK_CSS_CONTRAST: [string, string][] = [
  [
    "  --text: #c8cad8;\n  --muted: #6b6f85;\n",
    "  --text: #e0e2f0; /* 12.6:1 on the background */\n  --muted: #9599b3; /* 6.1:1, was 3.4:1 */\n",
  ],
];

const STRINGS = [
  ["checkout.title", "Checkout"],
  ["checkout.pay", "Pay now"],
  ["checkout.paying", "Paying…"],
  ["checkout.failed", "The payment failed. Try again."],
  ["checkout.empty", "Your cart is empty."],
  ["checkout.total", "Total"],
  ["checkout.subtotal", "Subtotal"],
  ["checkout.shipping", "Shipping"],
  ["checkout.freeShipping", "Free shipping"],
  ["cart.title", "Cart"],
  ["cart.remove", "Remove"],
  ["cart.quantity", "Quantity"],
  ["cart.updated", "Cart updated, {count} items"],
  ["search.placeholder", "Search products"],
  ["search.noResults", "Nothing found for “{query}”"],
] as const;
const TRANSLATIONS: Record<string, string[]> = {
  de: [
    "Kasse",
    "Jetzt bezahlen",
    "Zahlung läuft…",
    "Die Zahlung ist fehlgeschlagen. Bitte erneut versuchen.",
    "Dein Warenkorb ist leer.",
    "Gesamt",
    "Zwischensumme",
    "Versand",
    "Kostenloser Versand",
    "Warenkorb",
    "Entfernen",
    "Menge",
    "Warenkorb aktualisiert, {count} Artikel",
    "Produkte suchen",
    "Nichts gefunden für „{query}“",
  ],
  fr: [
    "Paiement",
    "Payer maintenant",
    "Paiement en cours…",
    "Le paiement a échoué. Réessayez.",
    "Votre panier est vide.",
    "Total",
    "Sous-total",
    "Livraison",
    "Livraison gratuite",
    "Panier",
    "Retirer",
    "Quantité",
    "Panier mis à jour, {count} articles",
    "Rechercher des produits",
    "Aucun résultat pour « {query} »",
  ],
};

export function strings(locale: "en" | "de" | "fr"): string {
  const values = locale === "en" ? STRINGS.map(([, value]) => value) : (TRANSLATIONS[locale] ?? []);
  return `{\n${STRINGS.map(([key], i) => `  "${key}": ${JSON.stringify(values[i])}`).join(",\n")}\n}\n`;
}

export const I18N_INDEX = `import en from "./en.json";

export type Locale = "en";
const CATALOGS = { en };

export function t(locale: Locale, key: keyof typeof en, values: Record<string, string | number> = {}): string {
  const text = CATALOGS[locale][key] ?? en[key];
  return text.replace(/\\{(\\w+)\\}/g, (_, name: string) => String(values[name] ?? \`{\${name}}\`));
}
`;

/** Adds a locale to the catalog (`fromUnion` is the Locale type before). */
export const addLocale = (locale: string, fromUnion: string, toUnion: string): [string, string][] => [
  ['import en from "./en.json";\n', `import en from "./en.json";\nimport ${locale} from "./${locale}.json";\n`],
  [`export type Locale = ${fromUnion};`, `export type Locale = ${toUnion};`],
  ["const CATALOGS = { en", `const CATALOGS = { en, ${locale}`],
];

export const DASHBOARD_V1 = `import { Chart } from "../../public/vendor/chart.min.js";

export function SalesDashboard({ orders }: { orders: { day: string; total: number }[] }) {
  return (
    <section className="dashboard">
      <h2>Sales</h2>
      <canvas
        ref={canvas => {
          if (canvas) new Chart(canvas, { type: "bar", data: { labels: orders.map(o => o.day), datasets: [{ data: orders.map(o => o.total / 100) }] } });
        }}
      />
    </section>
  );
}
`;

export const DASHBOARD_WEEKLY: [string, string][] = [
  [
    "      <h2>Sales</h2>\n",
    '      <h2>Sales</h2>\n      <p className="weekly">This week: {(weekTotal(orders) / 100).toFixed(2)} EUR</p>\n',
  ],
  [
    "export function SalesDashboard",
    "const weekTotal = (orders: { total: number }[]) => orders.slice(-7).reduce((sum, o) => sum + o.total, 0);\n\nexport function SalesDashboard",
  ],
];

export const DASHBOARD_CSV: [string, string][] = [
  [
    "      <h2>Sales</h2>\n",
    '      <h2>Sales</h2>\n      <a download="sales.csv" href={csvUrl(orders)}>\n        Export as CSV\n      </a>\n',
  ],
  [
    "export function SalesDashboard",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the demo file's own template literal
    'const csvUrl = (orders: { day: string; total: number }[]) =>\n  URL.createObjectURL(new Blob([["day,total", ...orders.map(o => `${o.day},${o.total}`)].join("\\n")], { type: "text/csv" }));\n\nexport function SalesDashboard',
  ],
];

/** A minified vendor file: one line of about 20,000 characters. */
export function minifiedChart(): string {
  const random = seeded("chart.min.js");
  const names = "abcdefghijklmnopqrstuvwxyz".split("");
  const parts = [
    '/*! Chart.js v4.4.1 | MIT License */!function(t,e){"object"==typeof exports?module.exports=e():t.Chart=e()}(this,function(){"use strict";',
  ];
  while (parts.join("").length < 20_000) {
    const a = random.pick(names);
    const b = random.pick(names);
    parts.push(
      `function ${a}${b}${random.int(0, 99)}(t,e,i){const s=t.${random.pick(["chart", "ctx", "options", "scales"])};return s&&s.${random.pick(["width", "height", "data", "update"])}?e(s,i||${random.int(0, 9)}):void 0}`,
    );
  }
  parts.push('return{Chart:class{constructor(t,e){this.ctx=t.getContext("2d"),this.config=e}}}});');
  return `${parts.join("")}\n`;
}

// ── Release notes, docs, deploy scripts ──────────────────────────────────────

export const release = (version: string, notes: string[]) =>
  replace(["## Unreleased\n", `## Unreleased\n\n## ${version}\n\n${notes.map(note => `- ${note}`).join("\n")}\n`]);

export const version = (value: string) => `export const VERSION = "${value}";\n`;

export const adr = (
  number: number,
  title: string,
  from: string,
  to: string,
  notes: string[],
) => `# ${String(number).padStart(4, "0")}. ${title}

Date: see the commit
Status: proposed

## Context

We are on ${from}. ${to} has been out for a while; staying behind means no security fixes once ${from} is end of
life, and Renovate keeps opening the same pull request.

## Decision

Upgrade to ${to} in one pull request, after the release branch for 1.5 is cut.

${notes.map(note => `- ${note}`).join("\n")}

## Consequences

- One afternoon of work, mostly in tests.
- Rollback is a revert of the merge; nothing in the data changes.
`;

export const EXPERIMENT_V1 = `# Graph layout experiment

Can the commit graph run top to bottom with merges drawn as curves, and still fit 14 lanes?

## Try 1: vertical layout

- Lanes are columns, newest at the top.
- Each lane keeps its column until its branch ends.
`;

export const DEPLOY_SH_V1 = `#!/bin/bash
# Builds the image and rolls it out. Only works on the old build server.
cd /opt/shop
docker build -t registry.local/shop-api:latest .
docker push registry.local/shop-api:latest
oc rollout latest dc/shop-api -n shop-dev
`;

export const DEPLOY_SH_V2 = `#!/bin/sh
# Builds the image and rolls it out: ./deploy/deploy.sh [namespace]
set -eu

NAMESPACE="\${1:-shop-dev}"
TAG="$(git rev-parse --short HEAD)"
IMAGE="image-registry.openshift-image-registry.svc:5000/shop/shop-api:\${TAG}"

cd "$(dirname "$0")/.."
podman build -t "\${IMAGE}" .
podman push "\${IMAGE}"
oc set image deployment/shop-api api="\${IMAGE}" -n "\${NAMESPACE}"
oc rollout status deployment/shop-api -n "\${NAMESPACE}" --timeout=5m
`;

/** The legacy Windows script, with Windows line endings. */
export const INSTALL_BAT = [
  "@echo off",
  "REM Installs the shop service on the old Windows build server.",
  "set SHOP_HOME=C:\\shop",
  "if not exist %SHOP_HOME% mkdir %SHOP_HOME%",
  "xcopy /E /Y dist %SHOP_HOME%\\dist",
  'sc create shop binPath= "%SHOP_HOME%\\node.exe %SHOP_HOME%\\dist\\index.js" start= auto',
  "sc start shop",
  "",
].join("\r\n");

export const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title} · shop docs</title>
    <link rel="stylesheet" href="css/site.css" />
  </head>
  <body>
    <nav><a href="index.html">shop</a> · <a href="getting-started.html">Getting started</a> · <a href="cart-api.html">Cart API</a></nav>
    <main>
${body
  .split("\n")
  .map(text => `      ${text}`)
  .join("\n")}
    </main>
  </body>
</html>
`;

export const SITE_CSS = `body {
  font: 16px/1.5 system-ui, sans-serif;
  max-width: 48rem;
  margin: 2rem auto;
  padding: 0 1rem;
}

nav a {
  margin-right: 0.5rem;
}

pre {
  background: #f4f4f6;
  padding: 1rem;
  overflow-x: auto;
}
`;

// ── Binary files ─────────────────────────────────────────────────────────────

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A small made-up PNG (git sees the NUL bytes and calls it binary); `variant` changes its pixels. */
export function png(variant: string, size = 1800): Uint8Array {
  const random = seeded(`png-${variant}`);
  const bytes = new Uint8Array(size);
  bytes.set(PNG_HEADER);
  for (let i = PNG_HEADER.length; i < size; i++) bytes[i] = random.next() < 0.2 ? 0 : random.int(1, 255);
  return bytes;
}
