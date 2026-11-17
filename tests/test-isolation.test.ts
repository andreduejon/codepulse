import { expect, test } from "bun:test";
import { defaultConfigPath } from "../src/config";
import { storageRoot } from "../src/utils/storage-path";

test("tests never read or write the real config or cache", () => {
  const realHome = process.env.CODEPULSE_TEST_REAL_HOME;
  expect(realHome).toBeTruthy();
  expect(defaultConfigPath().startsWith(`${realHome}/`)).toBe(false);
  expect(storageRoot("cache").startsWith(`${realHome}/`)).toBe(false);
});
