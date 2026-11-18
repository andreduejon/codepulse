/**
 * A provider's section of the settings file (`providers.<key>`): what every provider's settings share, and how a
 * provider says what its own are. The settings model (config.ts) reads, writes and backfills every provider's section
 * through its definition, so it names no provider.
 */

/** What every provider's settings have. */
export interface SettingsSection {
  /** Whether the provider is turned on; off by default. */
  enabled?: boolean;
}

/** What reads and resolves a provider's settings needs of its definition: its section's key and its settings. */
export interface SettingsOwner<Settings extends SettingsSection> {
  id: string;
  key: string;
  settings: ProviderSettingsDefinition<Settings>;
}

/** Reads one provider's values from the file: a value that is wrong is left out, and a warning says why. */
export interface SettingsReader {
  /** Records that a field's value was left out: `"providers.jenkins.jobs" must be an array, ignoring`. */
  warn: (field: string, problem: string) => void;
  /** Trimmed text; nothing for an empty one; a warning for another type or a longer one. */
  text: (field: string, value: unknown, maxLength: number) => string | undefined;
  boolean: (field: string, value: unknown) => boolean | undefined;
  /** One of these values, or a warning listing them. */
  oneOf: <T>(field: string, value: unknown, options: readonly T[]) => T | undefined;
  /** An array, or a warning. */
  list: (field: string, value: unknown) => readonly unknown[] | undefined;
}

export interface ProviderSettingsDefinition<Settings extends SettingsSection> {
  /** Every setting's value when the file has none. */
  defaults: Settings;
  /** The section as the file has it: each value that is right, the others left out with a warning. */
  read(raw: Record<string, unknown>, reader: SettingsReader): Partial<Settings>;
  /** The settings a backfill writes when the section lacks them; all of them unless listed. */
  backfill?: readonly string[];
  /** What a backfill writes instead of the missing defaults (Jenkins carries an older setting over). */
  missing?(existing: Partial<Settings>, defaults: Settings): Partial<Settings> | null;
}

/** The reader for one provider's section, its warnings naming the file and the field. */
export function sectionReader(path: string, key: string, warnings: string[]): SettingsReader {
  const warn = (field: string, problem: string) =>
    warnings.push(`${path}: "providers.${key}.${field}" ${problem}, ignoring`);
  return {
    warn,
    text: (field, value, maxLength) => {
      if (value === undefined) return undefined;
      if (typeof value !== "string") {
        warn(field, "must be a string");
        return undefined;
      }
      const trimmed = value.trim();
      if (trimmed.length === 0) return undefined;
      if (trimmed.length > maxLength) {
        warn(field, `must be at most ${maxLength} characters`);
        return undefined;
      }
      return trimmed;
    },
    boolean: (field, value) => {
      if (value === undefined) return undefined;
      if (typeof value === "boolean") return value;
      warn(field, "must be a boolean");
      return undefined;
    },
    oneOf: (field, value, options) => {
      if (value === undefined) return undefined;
      const found = options.find(option => option === value);
      if (found === undefined) warn(field, `must be one of ${options.join(", ")}`);
      return found;
    },
    list: (field, value) => {
      if (value === undefined) return undefined;
      if (Array.isArray(value)) return value;
      warn(field, "must be an array");
      return undefined;
    },
  };
}

/** The values that are set, as one object: a section read without the fields the file lacks. */
export function definedFields<T extends object>(fields: T): T {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as T;
}

/** What a backfill writes for a section: the defaults it lacks, or null when it lacks none. */
export function missingSettings<Settings extends SettingsSection>(
  definition: ProviderSettingsDefinition<Settings>,
  existing: Partial<Settings> | undefined,
): Partial<Settings> | null {
  const section: Partial<Settings> = existing ?? {};
  if (definition.missing) return definition.missing(section, definition.defaults);
  const keys = (definition.backfill ?? Object.keys(definition.defaults)) as (keyof Settings & string)[];
  const lacking = keys.filter(field => section[field] === undefined);
  if (lacking.length === 0) return null;
  return Object.fromEntries(lacking.map(field => [field, definition.defaults[field]])) as Partial<Settings>;
}
