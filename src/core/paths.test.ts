/** core/paths.ts answers as the runtime's path module does, for the paths Snyk reports and more. */
import { expect, test } from "bun:test";
import { posix, win32 } from "node:path";
import { posixDirname, posixNormalize, windowsRoot } from "./paths";

const samples = [
  "",
  ".",
  "..",
  "/",
  "//",
  "a",
  "a/",
  "a//b",
  "./a",
  "a/./b",
  "a/../b",
  "../a",
  "a/b/..",
  "/a/../..",
  "a/b/../../..",
  "package.json",
  "services/api/pom.xml",
  "services//api/./pom.xml/",
  "/abs/path",
  "C:\\x",
  "C:",
  "C:/x",
  "c:x",
  "\\\\server\\share\\x",
  "//server/share/x",
  "\\x",
  "/x",
  "name with spaces/file",
  "a/b/c/",
  "...",
  ".a/.b",
  "//a",
  "///a//b",
  "a///",
  "/a/",
  "a/b//c//",
  ".//a",
];

test("normalize and dirname match POSIX", () => {
  for (const sample of samples) {
    expect([sample, posixNormalize(sample)]).toEqual([sample, posix.normalize(sample)]);
    expect([sample, posixDirname(sample)]).toEqual([sample, posix.dirname(sample)]);
  }
});

test("a Windows root is found where Windows sees one", () => {
  for (const sample of samples) {
    expect([sample, windowsRoot(sample) !== ""]).toEqual([sample, win32.parse(sample).root !== ""]);
  }
});
