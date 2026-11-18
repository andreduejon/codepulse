import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { LocalRepositoryPoms, mavenLocalRepository } from "../src/adapters/snyk/maven-removable";
import { compareMavenVersions, markRemovableManaged } from "../src/core/snyk/maven-removable";
import type { SnykDependencyGraph } from "../src/core/snyk/types";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function folder(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codepulse-maven-removable-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** A POM in a local repository's layout: `group/path/artifact/version/artifact-version.pom`. */
const pomPath = (coordinates: string) => {
  const [groupId = "", artifactId = "", version = ""] = coordinates.split(":");
  return `${groupId.replaceAll(".", "/")}/${artifactId}/${version}/${artifactId}-${version}.pom`;
};
const property = (name: string) => `\${${name}}`;
const dependency = (groupId: string, artifactId: string, version?: string) =>
  `<dependency><groupId>${groupId}</groupId><artifactId>${artifactId}</artifactId>${
    version === undefined ? "" : `<version>${version}</version>`
  }</dependency>`;
const pom = (coordinates: string, body: string) => {
  const [groupId, artifactId, version] = coordinates.split(":");
  return `<project><groupId>${groupId}</groupId><artifactId>${artifactId}</artifactId><version>${version}</version>${body}</project>`;
};

describe("compareMavenVersions", () => {
  test("orders numbers by value and a release after its qualifiers, like Maven", () => {
    const ordered = [
      "1.0-alpha-1",
      "1.0-beta",
      "1.0-M2",
      "1.0-rc1",
      "1.0-SNAPSHOT",
      "1.0",
      "1.0-sp1",
      "1.0.1",
      "1.2",
      "1.10",
    ];
    for (let index = 1; index < ordered.length; index++)
      expect(compareMavenVersions(ordered[index - 1] ?? "", ordered[index] ?? "")).toBeLessThan(0);
    expect(compareMavenVersions("1.86", "1.86.0")).toBe(0);
    expect(compareMavenVersions("1.0.Final", "1.0")).toBe(0);
    expect(compareMavenVersions("1.78.1", "1.86")).toBeLessThan(0);
  });
});

describe("mavenLocalRepository", () => {
  test("follows maven.repo.local, then settings.xml's localRepository, then the default", async () => {
    const home = await folder({
      ".m2/settings.xml": `<settings><localRepository>${property("user.home")}/maven-cache</localRepository></settings>`,
    });
    const worktree = await folder({ ".mvn/maven.config": "-B -Dmaven.repo.local=/from/config" });
    const plain = await folder();
    // Absolute as Maven reads it in the worktree: on Windows `/from/config` is on the worktree's drive.
    expect(await mavenLocalRepository({ home, env: {}, worktree })).toBe(resolve(worktree, "/from/config"));
    expect(
      await mavenLocalRepository({
        home,
        env: { MAVEN_OPTS: "-Xmx1g -Dmaven.repo.local=/from/opts" },
        worktree: plain,
      }),
    ).toBe(resolve(plain, "/from/opts"));
    expect(await mavenLocalRepository({ home, env: {}, worktree: plain })).toBe(join(home, "maven-cache"));
    expect(await mavenLocalRepository({ home: plain, env: {}, worktree: plain })).toBe(
      join(plain, ".m2", "repository"),
    );
  });
});

describe("markRemovableManaged", () => {
  /** app → smbj → bcprov, with bcprov pinned to 1.86 by the app's dependencyManagement. */
  const graph = (extraRootDeps: string[] = []): SnykDependencyGraph => ({
    targetFile: "pom.xml",
    packageManager: "maven",
    rootNodeId: "root",
    packages: [
      { id: "com.example:app@1", name: "com.example:app", version: "1" },
      { id: "com.hierynomus:smbj@0.14.0", name: "com.hierynomus:smbj", version: "0.14.0" },
      {
        id: "org.bouncycastle:bcprov-jdk18on@1.86",
        name: "org.bouncycastle:bcprov-jdk18on",
        version: "1.86",
        pin: "managed",
      },
    ],
    nodes: [
      {
        nodeId: "root",
        pkgId: "com.example:app@1",
        deps: ["smbj", ...extraRootDeps],
        scope: "unknown",
        referenceNodeId: null,
      },
      { nodeId: "smbj", pkgId: "com.hierynomus:smbj@0.14.0", deps: ["bcprov"], scope: "prod", referenceNodeId: null },
      {
        nodeId: "bcprov",
        pkgId: "org.bouncycastle:bcprov-jdk18on@1.86",
        deps: [],
        scope: "prod",
        referenceNodeId: null,
      },
    ],
  });
  const pinned = new Map([["org.bouncycastle:bcprov-jdk18on", "1.86"]]);
  const removable = (value: SnykDependencyGraph) => value.packages.filter(pkg => pkg.removable).map(pkg => pkg.name);

  test("a pin goes when the dependency that brings it asks for that version or later, through its properties", async () => {
    const repository = await folder({
      [pomPath("com.hierynomus:smbj:0.14.0")]: pom(
        "com.hierynomus:smbj:0.14.0",
        `<properties><bc.version>1.86</bc.version></properties><dependencies>${dependency("org.bouncycastle", "bcprov-jdk18on", property("bc.version"))}</dependencies>`,
      ),
    });
    const value = graph();
    await markRemovableManaged(value, pinned, new LocalRepositoryPoms(repository));
    expect(removable(value)).toEqual(["org.bouncycastle:bcprov-jdk18on"]);
  });

  test("a version form this order isn't sure about keeps the pin: Maven puts 1.0-1 below 1.0.1", async () => {
    const repository = await folder({
      [pomPath("com.hierynomus:smbj:0.14.0")]: pom(
        "com.hierynomus:smbj:0.14.0",
        `<dependencies>${dependency("org.bouncycastle", "bcprov-jdk18on", "1.0-1")}</dependencies>`,
      ),
    });
    const value = graph();
    await markRemovableManaged(
      value,
      new Map([["org.bouncycastle:bcprov-jdk18on", "1.0.1"]]),
      new LocalRepositoryPoms(repository),
    );
    expect(removable(value)).toEqual([]);
  });

  test("a qualifier keeps the pin too: Maven puts 1.0-rc above 1.0.0-beta, where a plain order would not", async () => {
    const repository = await folder({
      [pomPath("com.hierynomus:smbj:0.14.0")]: pom(
        "com.hierynomus:smbj:0.14.0",
        `<dependencies>${dependency("org.bouncycastle", "bcprov-jdk18on", "1.0.0-beta")}</dependencies>`,
      ),
    });
    const value = graph();
    await markRemovableManaged(
      value,
      new Map([["org.bouncycastle:bcprov-jdk18on", "1.0-rc"]]),
      new LocalRepositoryPoms(repository),
    );
    expect(removable(value)).toEqual([]);
  });

  test("a variant of the artifact (a test jar, a classifier) keeps the pin: the graph can't tell which one it is", async () => {
    const repository = await folder({
      [pomPath("com.hierynomus:smbj:0.14.0")]: pom(
        "com.hierynomus:smbj:0.14.0",
        `<dependencies>
          <dependency><groupId>org.bouncycastle</groupId><artifactId>bcprov-jdk18on</artifactId><version>2.0</version><type>test-jar</type><classifier>tests</classifier></dependency>
          ${dependency("org.bouncycastle", "bcprov-jdk18on", "1.0")}
        </dependencies>`,
      ),
    });
    const value = graph();
    await markRemovableManaged(
      value,
      new Map([["org.bouncycastle:bcprov-jdk18on", "1.5"]]),
      new LocalRepositoryPoms(repository),
    );
    expect(removable(value)).toEqual([]);
  });

  test("a number part too long to compare exactly keeps the pin", async () => {
    const repository = await folder({
      [pomPath("com.hierynomus:smbj:0.14.0")]: pom(
        "com.hierynomus:smbj:0.14.0",
        `<dependencies>${dependency("org.bouncycastle", "bcprov-jdk18on", "1.9007199254740992")}</dependencies>`,
      ),
    });
    const value = graph();
    await markRemovableManaged(
      value,
      new Map([["org.bouncycastle:bcprov-jdk18on", "1.9007199254740993"]]),
      new LocalRepositoryPoms(repository),
    );
    expect(removable(value)).toEqual([]);
  });

  test("a version its parent POM manages counts too", async () => {
    const repository = await folder({
      [pomPath("com.hierynomus:smbj:0.14.0")]: pom(
        "com.hierynomus:smbj:0.14.0",
        `<parent><groupId>com.hierynomus</groupId><artifactId>parent</artifactId><version>3</version></parent><dependencies>${dependency("org.bouncycastle", "bcprov-jdk18on")}</dependencies>`,
      ),
      [pomPath("com.hierynomus:parent:3")]: pom(
        "com.hierynomus:parent:3",
        `<dependencyManagement><dependencies>${dependency("org.bouncycastle", "bcprov-jdk18on", "1.87")}</dependencies></dependencyManagement>`,
      ),
    });
    const value = graph();
    await markRemovableManaged(value, pinned, new LocalRepositoryPoms(repository));
    expect(removable(value)).toEqual(["org.bouncycastle:bcprov-jdk18on"]);
  });

  test("the pin stays for an older version, a missing POM, an unknown version or a direct dependency", async () => {
    const asks = (version: string) => ({
      [pomPath("com.hierynomus:smbj:0.14.0")]: pom(
        "com.hierynomus:smbj:0.14.0",
        `<dependencies>${dependency("org.bouncycastle", "bcprov-jdk18on", version)}</dependencies>`,
      ),
    });
    for (const [files, rootDeps] of [
      [asks("1.80"), []],
      [{}, []],
      [asks(property("not.defined")), []],
      [asks("[1.80,)"), []],
      [asks("1.86"), ["bcprov"]],
    ] as const) {
      const value = graph([...rootDeps]);
      await markRemovableManaged(value, pinned, new LocalRepositoryPoms(await folder(files)));
      expect(removable(value)).toEqual([]);
    }
  });
});
