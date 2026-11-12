/**
 * The demo's npm world: what each commit's package.json asks for, what every package depends on, and which versions
 * are vulnerable. The repository's manifests, the fake Snyk's graphs and findings, and the fake `npm view` all come
 * from here, so they agree with each other.
 */

export interface Manifest {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
}

const DEV_TOOLS = { typescript: "^5.4.5", jest: "^29.7.0" };

/** The root project at each commit that changes it; the commits in between keep the one before. */
export const SHOP_MANIFESTS = {
  initial: {
    name: "shop",
    version: "1.0.0",
    private: true,
    dependencies: { express: "^4.19.2" },
    devDependencies: DEV_TOOLS,
  },
  cart: {
    name: "shop",
    version: "1.0.0",
    private: true,
    dependencies: { express: "^4.19.2", lodash: "^4.17.15", axios: "^1.5.1", mkdirp: "^0.5.5" },
    devDependencies: DEV_TOOLS,
  },
  rounding: {
    name: "shop",
    version: "1.0.0",
    private: true,
    dependencies: {
      express: "^4.19.2",
      lodash: "^4.17.20",
      axios: "^1.6.0",
      mkdirp: "^0.5.5",
      jsonwebtoken: "^8.5.1",
    },
    devDependencies: DEV_TOOLS,
  },
  payments: {
    name: "shop",
    version: "1.0.0",
    private: true,
    dependencies: {
      express: "^4.19.2",
      lodash: "^4.17.20",
      axios: "^1.6.0",
      mkdirp: "^0.5.5",
      jsonwebtoken: "^8.5.1",
      "@company/payments-gateway-client-with-a-very-long-package-name": "2.14.0-beta.3",
    },
    devDependencies: DEV_TOOLS,
    // Pins minimist past its fix; mkdirp's own range already allows a fixed version, so the override can go.
    overrides: { minimist: "^1.2.6" },
  },
} satisfies Record<string, Manifest>;

/** A second project in the repository (admin/), with nothing to fix. */
export const ADMIN_MANIFEST: Manifest = {
  name: "shop-admin",
  version: "0.3.0",
  private: true,
  dependencies: { chalk: "^4.1.2" },
};

/** What each package version depends on (exact versions, as installed), and the versions the registry has. */
const REGISTRY: Record<string, { versions: string[]; deps: Record<string, Record<string, string>> }> = {
  express: {
    versions: ["4.18.2", "4.19.2", "4.21.2"],
    deps: { "4.19.2": { "body-parser": "1.20.2", cookie: "0.6.0", qs: "6.11.0", debug: "2.6.9" } },
  },
  "body-parser": { versions: ["1.20.2"], deps: { "1.20.2": { qs: "6.11.0", bytes: "3.1.2", debug: "2.6.9" } } },
  qs: { versions: ["6.11.0", "6.13.0"], deps: { "6.11.0": { "side-channel": "1.0.6" } } },
  "side-channel": { versions: ["1.0.6"], deps: {} },
  cookie: { versions: ["0.6.0", "0.7.1"], deps: {} },
  bytes: { versions: ["3.1.2"], deps: {} },
  debug: { versions: ["2.6.9", "4.3.4"], deps: { "2.6.9": { ms: "2.0.0" }, "4.3.4": { ms: "2.1.2" } } },
  ms: { versions: ["2.0.0", "2.1.2", "2.1.3"], deps: {} },
  lodash: { versions: ["4.17.15", "4.17.20", "4.17.21"], deps: {} },
  axios: {
    versions: ["1.5.1", "1.6.0", "1.7.9"],
    deps: {
      "1.5.1": { "follow-redirects": "1.15.2", "form-data": "4.0.0" },
      "1.6.0": { "follow-redirects": "1.15.4", "form-data": "4.0.0" },
    },
  },
  "follow-redirects": { versions: ["1.15.2", "1.15.4", "1.15.9"], deps: {} },
  "form-data": { versions: ["4.0.0"], deps: { "4.0.0": { asynckit: "0.4.0", "mime-types": "2.1.35" } } },
  asynckit: { versions: ["0.4.0"], deps: {} },
  "mime-types": { versions: ["2.1.35"], deps: { "2.1.35": { "mime-db": "1.52.0" } } },
  "mime-db": { versions: ["1.52.0"], deps: {} },
  mkdirp: { versions: ["0.5.5", "0.5.6", "1.0.4"], deps: { "0.5.5": { minimist: "1.2.5" } } },
  minimist: { versions: ["1.2.5", "1.2.6", "1.2.7", "1.2.8"], deps: {} },
  jsonwebtoken: {
    versions: ["8.5.1", "9.0.0", "9.0.2"],
    deps: { "8.5.1": { jws: "3.2.2", semver: "5.7.1", ms: "2.1.3" } },
  },
  jws: { versions: ["3.2.2"], deps: { "3.2.2": { jwa: "1.4.1" } } },
  jwa: { versions: ["1.4.1"], deps: {} },
  semver: { versions: ["5.7.1", "5.7.2", "7.6.0"], deps: {} },
  "@company/payments-gateway-client-with-a-very-long-package-name": {
    versions: ["2.13.0", "2.14.0-beta.3", "2.14.1"],
    deps: { "2.14.0-beta.3": { axios: "1.6.0", "retry-policy": "3.1.0" } },
  },
  "retry-policy": { versions: ["3.1.0"], deps: {} },
  typescript: { versions: ["5.4.5"], deps: {} },
  jest: { versions: ["29.7.0"], deps: { "29.7.0": { "@jest/core": "29.7.0" } } },
  "@jest/core": { versions: ["29.7.0"], deps: { "29.7.0": { micromatch: "4.0.5", "jest-util": "29.7.0" } } },
  "jest-util": { versions: ["29.7.0"], deps: { "29.7.0": { micromatch: "4.0.5" } } },
  micromatch: { versions: ["4.0.5", "4.0.8"], deps: { "4.0.5": { braces: "3.0.2" } } },
  braces: { versions: ["3.0.2", "3.0.3"], deps: {} },
  chalk: { versions: ["4.1.2"], deps: { "4.1.2": { "ansi-styles": "4.3.0", "supports-color": "7.2.0" } } },
  "ansi-styles": { versions: ["4.3.0"], deps: {} },
  "supports-color": { versions: ["7.2.0"], deps: { "7.2.0": { "has-flag": "4.0.0" } } },
  "has-flag": { versions: ["4.0.0"], deps: {} },
};

interface Advisory {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  packageName: string;
  /** Versions below this are vulnerable. */
  fixed: string;
  cvssScore: number;
  cve: string;
}

const ADVISORIES: Advisory[] = [
  {
    id: "SNYK-JS-LODASH-1040724",
    title: "Prototype Pollution",
    severity: "high",
    packageName: "lodash",
    fixed: "4.17.21",
    cvssScore: 7.5,
    cve: "CVE-2020-8203",
  },
  {
    id: "SNYK-JS-AXIOS-6032459",
    title: "Cross-site Request Forgery",
    severity: "medium",
    packageName: "axios",
    fixed: "1.6.0",
    cvssScore: 6.5,
    cve: "CVE-2023-45857",
  },
  {
    id: "SNYK-JS-MINIMIST-2429795",
    title: "Prototype Pollution",
    severity: "low",
    packageName: "minimist",
    fixed: "1.2.6",
    cvssScore: 3.7,
    cve: "CVE-2021-44906",
  },
  {
    id: "SNYK-JS-JSONWEBTOKEN-3180022",
    title: "Improper Authentication",
    severity: "critical",
    packageName: "jsonwebtoken",
    fixed: "9.0.0",
    cvssScore: 9.1,
    cve: "CVE-2022-23540",
  },
  {
    id: "SNYK-JS-COMPANYPAYMENTSGATEWAYCLIENT-7001234",
    title: "Server-side Request Forgery (SSRF)",
    severity: "high",
    packageName: "@company/payments-gateway-client-with-a-very-long-package-name",
    fixed: "2.14.1",
    cvssScore: 8.2,
    cve: "CVE-2026-10001",
  },
  {
    id: "SNYK-JS-BRACES-6838727",
    title: "Excessive Platform Resource Consumption within a Loop",
    severity: "high",
    packageName: "braces",
    fixed: "3.0.3",
    cvssScore: 7.5,
    cve: "CVE-2024-4068",
  },
];

/** Compares `1.2.3` and `1.2.3-beta.1` style versions; a prerelease sorts before its release. */
export function compareVersions(left: string, right: string): number {
  const split = (value: string) => {
    const [core, pre] = value.split("-", 2);
    return { parts: core.split(".").map(Number), pre: pre ?? null };
  };
  const a = split(left);
  const b = split(right);
  for (let index = 0; index < 3; index++) {
    const difference = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return a.pre < b.pre ? -1 : 1;
}

const exact = (range: string) => range.replace(/^[\^~]/, "");

interface Node {
  nodeId: string;
  pkgId: string;
  deps: { nodeId: string }[];
  info: { labels: { scope: "prod" | "dev" } };
}

export interface DependencyTree {
  root: string;
  /** Every path from the root, as Snyk's `from`: root first, the package last. */
  paths: { scope: "prod" | "dev"; from: string[] }[];
  graph: unknown;
}

/** The tree npm would install for a manifest, as Snyk's --print-graph prints it (repeats pruned). */
export function dependencyTree(manifest: Manifest): DependencyTree {
  const root = `${manifest.name}@${manifest.version}`;
  const overrides = manifest.overrides ?? {};
  const pkgs = new Map<string, { id: string; info: { name: string; version: string } }>([
    [root, { id: root, info: { name: manifest.name, version: manifest.version } }],
  ]);
  const nodes: Node[] = [];
  const seen = new Set<string>();
  const paths: DependencyTree["paths"] = [];
  const visit = (name: string, version: string, scope: "prod" | "dev", from: string[]): string => {
    const resolved = overrides[name] ? exact(overrides[name]) : version;
    const pkgId = `${name}@${resolved}`;
    pkgs.set(pkgId, { id: pkgId, info: { name, version: resolved } });
    const path = [...from, pkgId];
    paths.push({ scope, from: path });
    if (seen.has(pkgId)) {
      const nodeId = `${pkgId}:pruned`;
      if (!nodes.some(node => node.nodeId === nodeId))
        nodes.push({ nodeId, pkgId, deps: [], info: { labels: { scope } } });
      return nodeId;
    }
    seen.add(pkgId);
    const node: Node = { nodeId: pkgId, pkgId, deps: [], info: { labels: { scope } } };
    nodes.push(node);
    for (const [child, childVersion] of Object.entries(REGISTRY[name]?.deps[resolved] ?? {}))
      node.deps.push({ nodeId: visit(child, childVersion, scope, path) });
    return pkgId;
  };
  const rootNode: Node = { nodeId: "root-node", pkgId: root, deps: [], info: { labels: { scope: "prod" } } };
  for (const [name, range] of Object.entries(manifest.dependencies ?? {}))
    rootNode.deps.push({ nodeId: visit(name, exact(range), "prod", [root]) });
  for (const [name, range] of Object.entries(manifest.devDependencies ?? {}))
    rootNode.deps.push({ nodeId: visit(name, exact(range), "dev", [root]) });
  const { info: _labels, ...rootWithoutLabels } = rootNode;
  return {
    root,
    paths,
    graph: {
      schemaVersion: "1.3.0",
      pkgManager: { name: "npm" },
      pkgs: [...pkgs.values()],
      graph: { rootNodeId: "root-node", nodes: [rootWithoutLabels, ...nodes] },
    },
  };
}

/** What Snyk's `test --json` reports for a tree: one entry per vulnerable path. */
export function vulnerabilities(tree: DependencyTree) {
  return tree.paths.flatMap(({ from }) => {
    const pkgId = from.at(-1) ?? "";
    const at = pkgId.lastIndexOf("@");
    const name = pkgId.slice(0, at);
    const version = pkgId.slice(at + 1);
    return ADVISORIES.filter(
      advisory => advisory.packageName === name && compareVersions(version, advisory.fixed) < 0,
    ).map(advisory => ({
      id: advisory.id,
      title: advisory.title,
      severity: advisory.severity,
      packageName: name,
      version,
      from,
      // A direct dependency upgrades itself; a deeper one waits for its parent (false: no upgrade path).
      upgradePath: from.length === 2 ? [false, `${name}@${advisory.fixed}`] : from.map(() => false),
      fixedIn: [advisory.fixed],
      cvssScore: advisory.cvssScore,
      identifiers: { CVE: [advisory.cve] },
    }));
  });
}

/** `npm view NAME versions --json` and `npm view NAME@VERSION --json`; undefined when the registry has no answer. */
export function registryView(spec: string, field: string | undefined): unknown {
  const at = spec.lastIndexOf("@");
  const named = at > 0;
  const name = named ? spec.slice(0, at) : spec;
  const entry = REGISTRY[name];
  if (!entry) return undefined;
  if (field === "versions") return entry.versions;
  if (!named) return undefined;
  const version = spec.slice(at + 1);
  if (!entry.versions.includes(version)) return undefined;
  const ranges = Object.fromEntries(Object.entries(entry.deps[version] ?? {}).map(([dep, v]) => [dep, `^${v}`]));
  return { name, version, dependencies: ranges };
}

/** A small package-lock.json for a manifest: the installed versions, so the repository looks like a real project. */
export function lockfile(manifest: Manifest): string {
  const tree = dependencyTree(manifest);
  const packages: Record<string, unknown> = {
    "": {
      name: manifest.name,
      version: manifest.version,
      dependencies: manifest.dependencies,
      devDependencies: manifest.devDependencies,
    },
  };
  for (const { from, scope } of tree.paths) {
    const pkgId = from.at(-1) ?? "";
    const at = pkgId.lastIndexOf("@");
    const key = `node_modules/${pkgId.slice(0, at)}`;
    if (!packages[key]) packages[key] = { version: pkgId.slice(at + 1), ...(scope === "dev" ? { dev: true } : {}) };
  }
  return `${JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages }, null, 2)}\n`;
}
