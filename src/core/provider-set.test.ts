import { expect, test } from "bun:test";
import { createProviderSet, type ProviderDefinition, providerEntry } from "./provider-set";
import type { SettingsSection } from "./settings/provider-section";

const definition = (id: string, key = id): ProviderDefinition<{ name: string }, SettingsSection> => ({
  id,
  key,
  displayName: id,
  category: "ci",
  settings: { defaults: { enabled: false }, read: () => ({}) },
});

test("a provider's adapters come back typed by its definition, and only by the one it was registered with", () => {
  const ci = definition("ci");
  const set = createProviderSet([providerEntry(ci, { name: "ci adapters" })]);
  expect(set.adapters(ci).name).toBe("ci adapters");
  // The same id with another definition may expect other adapters: refused, not cast.
  expect(() => set.adapters(definition("ci"))).toThrow('Provider "ci" is registered with another definition');
  expect(() => set.adapters(definition("other"))).toThrow('Provider "other" is not registered');
});

test("a set refuses providers that would collide: an id, a settings key, a `:hide` name or a detail tab", () => {
  const entry = (id: string, key = id, moreTabs?: { id: string; label: string }[]) =>
    providerEntry({ ...definition(id, key), ...(moreTabs ? { moreTabs } : {}) }, { name: id });
  expect(() => createProviderSet([entry("ci"), entry("ci", "other")])).toThrow('Provider "ci" is registered twice');
  expect(() => createProviderSet([entry("a", "k"), entry("b", "k")])).toThrow('settings key "k" is registered twice');
  // `:hide git` names Git, `:hide dashboard` nothing a provider can take.
  expect(() => createProviderSet([entry("ci", "git")])).toThrow('settings key "git" is reserved');
  expect(() => createProviderSet([entry("git")])).toThrow('Provider "git" is registered twice');
  // A tab another provider adds, or one Git has.
  expect(() => createProviderSet([entry("a"), entry("b", "b", [{ id: "a", label: "A" }])])).toThrow(
    'Detail tab "a" is used twice',
  );
  expect(() => createProviderSet([entry("a", "a", [{ id: "info", label: "Info" }])])).toThrow(
    'Detail tab "info" is used twice',
  );
});
