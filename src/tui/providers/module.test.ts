import { expect, test } from "bun:test";
import { createProviderSet, type ProviderDefinition, providerEntry } from "../../core/provider-set";
import type { SettingsSection } from "../../core/settings/provider-section";
import { type AnyProviderModule, modulesFor } from "./module";
import { detailEntry } from "./shared/detail-entry";

const definition = (id: string): ProviderDefinition<null, SettingsSection> => ({
  id,
  key: id,
  displayName: id,
  category: "ci",
  moreTabs: [{ id: `${id}-more`, label: "More" }],
  settings: { defaults: { enabled: false }, read: () => ({}) },
});
const entry = detailEntry<unknown>({ Tab: () => null });
const moduleOf = (of: ProviderDefinition<null, SettingsSection>, tabs = [of.id, `${of.id}-more`]) =>
  ({
    definition: of,
    detailEntries: Object.fromEntries(tabs.map(tab => [tab, entry])),
  }) as unknown as AnyProviderModule;

test("each provider has exactly one module, for its own definition, rendering only its own tabs", () => {
  const a = definition("a");
  const b = definition("b");
  const set = createProviderSet([providerEntry(a, null), providerEntry(b, null)]);
  // In the set's order, whatever order the modules come in.
  const joined = modulesFor(set, [moduleOf(b), moduleOf(a)]);
  expect(joined.map(module => module.definition.id)).toEqual(["a", "b"]);

  expect(() => modulesFor(set, [moduleOf(a), moduleOf(a), moduleOf(b)])).toThrow('Provider "a" has two modules');
  expect(() => modulesFor(set, [moduleOf(a)])).toThrow('Provider "b" has no module');
  expect(() => modulesFor(set, [moduleOf(a), moduleOf(b), moduleOf(definition("c"))])).toThrow(
    'Provider "c" has a module but is not in the app\'s provider set',
  );
  // The same id, another definition: its settings or adapters may not be the ones the set holds.
  expect(() => modulesFor(set, [moduleOf(definition("a")), moduleOf(b)])).toThrow(
    'Provider "a" has a module for another definition',
  );
  expect(() => modulesFor(set, [moduleOf(a, ["a", "a-more", "b-more"]), moduleOf(b)])).toThrow(
    'Provider "a" renders a detail tab it doesn\'t have: "b-more"',
  );
  // A tab it has but doesn't render would show nothing: refused too, its own and one it adds.
  expect(() => modulesFor(set, [moduleOf(a, ["a"]), moduleOf(b)])).toThrow(
    'Provider "a" has no renderer for its detail tab "a-more"',
  );
  expect(() => modulesFor(set, [moduleOf(a, ["a-more"]), moduleOf(b)])).toThrow(
    'Provider "a" has no renderer for its detail tab "a"',
  );
});
