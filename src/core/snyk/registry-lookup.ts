/** What the override rules ask a package registry; the adapter asks pnpm or npm (adapters/snyk/registry.ts). */

/** Ranges a published version asks for; peers apart, since they accept what other packages resolve. */
export interface PackageRanges {
  /** dependencies and optionalDependencies */
  ranges: Record<string, string>;
  peers: Record<string, string>;
}

/** Package metadata the override check needs; null when the registry could not answer. */
export interface RegistryLookup {
  /** Published versions of a package. */
  versions(name: string): Promise<string[] | null>;
  /** The ranges `name@version` asks for. */
  dependencies(name: string, version: string): Promise<PackageRanges | null>;
}
