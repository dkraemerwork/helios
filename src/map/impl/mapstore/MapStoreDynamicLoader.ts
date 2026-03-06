/**
 * Dynamic loader for MapStore/MapStoreFactory via module-specifier#exportName.
 *
 * Resolves className/factoryClassName values that are not found in the
 * MapStoreProviderRegistry by treating them as Bun ESM import targets.
 *
 * Format: "module-specifier#exportName"
 * - bare/package specifiers resolve with Bun's normal ESM rules
 * - relative specifiers resolve relative to configOrigin or process.cwd()
 */
export class MapStoreDynamicLoader {
  static async load(
    specifier: string,
    configOrigin?: string | null,
  ): Promise<unknown> {
    const hashIndex = specifier.indexOf('#');
    if (hashIndex === -1) {
      throw new Error(
        `Invalid dynamic-loading specifier '${specifier}'. ` +
        `Expected format: module-specifier#exportName`,
      );
    }

    const modulePath = specifier.substring(0, hashIndex);
    const exportName = specifier.substring(hashIndex + 1);

    if (!modulePath || !exportName) {
      throw new Error(
        `Invalid dynamic-loading specifier '${specifier}'. ` +
        `Both module path and export name are required in module-specifier#exportName format.`,
      );
    }

    let resolvedPath = modulePath;
    if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
      const base = configOrigin ?? process.cwd();
      const { resolve, dirname } = await import('node:path');
      const baseDir = base.endsWith('/') ? base : dirname(base);
      resolvedPath = resolve(baseDir, modulePath);
    }

    let mod: Record<string, unknown>;
    try {
      mod = await import(resolvedPath);
    } catch (err) {
      throw new Error(
        `Failed to load module '${resolvedPath}' from specifier '${specifier}': ${(err as Error).message}`,
      );
    }

    const exported = mod[exportName];
    if (exported === undefined) {
      throw new Error(
        `Module '${resolvedPath}' does not export '${exportName}'. ` +
        `Available exports: ${Object.keys(mod).join(', ')}`,
      );
    }

    return exported;
  }
}
