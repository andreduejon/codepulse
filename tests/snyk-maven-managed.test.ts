import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  applyMavenManaged,
  mavenManagedVersions,
  PomIndex,
  parsePom,
  parseXml,
} from "../src/providers/snyk/maven-managed";
import type { SnykDependencyGraph } from "../src/providers/snyk/types";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function repository(files: Record<string, string>): Promise<PomIndex> {
  const root = await mkdtemp(join(tmpdir(), "codepulse-maven-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return new PomIndex(root, Object.keys(files));
}

/** A Maven `${name}` placeholder. */
const property = (name: string) => `\${${name}}`;
const managedBlock = (entries: string) =>
  `<dependencyManagement><dependencies>${entries}</dependencies></dependencyManagement>`;
const dependency = (groupId: string, artifactId: string, version?: string, extra = "") =>
  `<dependency><groupId>${groupId}</groupId><artifactId>${artifactId}</artifactId>${
    version === undefined ? "" : `<version>${version}</version>`
  }${extra}</dependency>`;

describe("parseXml", () => {
  test("reads elements and text, skipping the prolog, comments and attributes", () => {
    const root = parseXml(
      '<?xml version="1.0"?>\n<!-- note --><project xmlns="x"><a>1 &amp; 2</a><b/><c><![CDATA[<raw>]]></c></project>',
    );
    expect(root?.name).toBe("project");
    expect(root?.children.map(child => [child.name, child.text])).toEqual([
      ["a", "1 & 2"],
      ["b", ""],
      ["c", "<raw>"],
    ]);
  });
});

describe("parsePom", () => {
  test("reads coordinates, the parent, properties and dependencyManagement only", () => {
    const pom = parsePom(
      "app/pom.xml",
      `<project>
        <parent><groupId>g</groupId><artifactId>parent</artifactId><version>1</version></parent>
        <artifactId>app</artifactId>
        <properties><lib.version>2.0</lib.version></properties>
        ${managedBlock(dependency("g", "lib", property("lib.version")) + dependency("g", "bom", "1", "<type>pom</type><scope>import</scope>"))}
        <dependencies>${dependency("g", "direct", "9")}</dependencies>
      </project>`,
    );
    expect(pom).toEqual({
      path: "app/pom.xml",
      groupId: undefined,
      artifactId: "app",
      version: undefined,
      parent: { groupId: "g", artifactId: "parent", version: "1", relativePath: "../pom.xml" },
      properties: { "lib.version": "2.0" },
      managed: [
        { groupId: "g", artifactId: "lib", version: property("lib.version") },
        { groupId: "g", artifactId: "bom", version: "1", type: "pom", scope: "import" },
      ],
    });
  });

  test("an empty relativePath turns the local parent lookup off; a non-POM is null", () => {
    expect(
      parsePom("pom.xml", "<project><parent><groupId>g</groupId><relativePath/></parent></project>")?.parent
        ?.relativePath,
    ).toBeNull();
    expect(parsePom("pom.xml", "<settings/>")).toBeNull();
  });
});

describe("mavenManagedVersions", () => {
  const parent = `<project><groupId>g</groupId><artifactId>parent</artifactId><version>1</version>
    <properties><lib.version>1.0</lib.version></properties>
    ${managedBlock(dependency("g", "lib", property("lib.version")) + dependency("g", "other", "3") + dependency("g", "self", property("project.version")) + dependency("g", "ext", property("external.version")))}
  </project>`;

  test("inherits in-repo parents' pins, interpolated with the child's own properties", async () => {
    const index = await repository({
      "pom.xml": parent,
      "app/pom.xml": `<project><parent><groupId>g</groupId><artifactId>parent</artifactId><version>1</version></parent>
        <artifactId>app</artifactId><version>5</version>
        <properties><lib.version>1.2</lib.version></properties>
        ${managedBlock(dependency("g", "other", "4"))}
      </project>`,
    });
    expect(Object.fromEntries(await mavenManagedVersions(index, "app/pom.xml"))).toEqual({
      "g:other": "4",
      "g:lib": "1.2",
      "g:self": "5",
      "g:ext": null,
    });
  });

  test("finds a parent by coordinates when relativePath points elsewhere, and imports in-repo BOMs", async () => {
    const index = await repository({
      "build/parent/pom.xml": parent,
      "bom/pom.xml": `<project><groupId>g</groupId><artifactId>bom</artifactId><version>7</version>
        ${managedBlock(dependency("g", "from-bom", property("project.version")) + dependency("g", "other", "99"))}</project>`,
      "app/pom.xml": `<project><parent><groupId>g</groupId><artifactId>parent</artifactId><version>1</version></parent>
        <artifactId>app</artifactId>
        ${managedBlock(dependency("g", "bom", "7", "<type>pom</type><scope>import</scope>"))}</project>`,
    });
    const managed = await mavenManagedVersions(index, "app/pom.xml");
    expect(managed.get("g:lib")).toBe("1.0");
    expect(managed.get("g:from-bom")).toBe("7");
    // Own and inherited pins win over imported ones.
    expect(managed.get("g:other")).toBe("3");
    expect(managed.has("g:bom")).toBe(false);
  });

  test("never reads files outside the tracked POMs", async () => {
    const index = await repository({
      "app/pom.xml": `<project><parent><groupId>g</groupId><artifactId>parent</artifactId><relativePath>../../pom.xml</relativePath></parent>
        <artifactId>app</artifactId></project>`,
    });
    expect((await mavenManagedVersions(index, "app/pom.xml")).size).toBe(0);
    expect((await mavenManagedVersions(index, "missing/pom.xml")).size).toBe(0);
  });
});

describe("applyMavenManaged", () => {
  const graph = (): SnykDependencyGraph => ({
    targetFile: "pom.xml",
    packageManager: "maven",
    rootNodeId: "root",
    packages: [
      { id: "g:app@1", name: "g:app", version: "1" },
      { id: "g:direct@1", name: "g:direct", version: "1" },
      { id: "g:lib@1.2", name: "g:lib", version: "1.2" },
      { id: "g:ext@2", name: "g:ext", version: "2" },
      { id: "g:stale@1", name: "g:stale", version: "1" },
    ],
    nodes: [
      { nodeId: "root", pkgId: "g:app@1", deps: ["direct"], scope: "unknown", referenceNodeId: null },
      { nodeId: "direct", pkgId: "g:direct@1", deps: ["lib", "ext", "stale"], scope: "prod", referenceNodeId: null },
      { nodeId: "lib", pkgId: "g:lib@1.2", deps: [], scope: "prod", referenceNodeId: null },
      { nodeId: "ext", pkgId: "g:ext@2", deps: [], scope: "prod", referenceNodeId: null },
      { nodeId: "stale", pkgId: "g:stale@1", deps: [], scope: "prod", referenceNodeId: null },
    ],
  });

  test("marks pinned packages reached through another dependency, when the version matches or is unknown", () => {
    const value = graph();
    applyMavenManaged(
      value,
      new Map([
        ["g:direct", "1"],
        ["g:lib", "1.2"],
        ["g:ext", null],
        ["g:stale", "2"],
      ]),
    );
    expect(value.packages.filter(pkg => pkg.pin).map(pkg => [pkg.name, pkg.pin])).toEqual([
      ["g:lib", "managed"],
      ["g:ext", "managed"],
    ]);
  });
});
