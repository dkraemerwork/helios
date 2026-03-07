/**
 * Wiring proof: installed-package dynamic loading via bare/package specifier
 * Label: mapstore-mongodb-wiring-dynamic-package
 *
 * Tests that MapStoreDynamicLoader can resolve exports from external package
 * modules via absolute path specifiers (simulating installed-package resolution).
 *
 * In production, an installed package like '@zenystx/helios-mongodb' would resolve
 * via Bun's ESM resolution. In workspace/dev mode, we use absolute paths to
 * the package source to prove the same mechanism.
 */
import { describe, it, expect } from 'bun:test';
import { resolve } from 'node:path';
import { MapStoreDynamicLoader } from '@zenystx/helios-core/map/impl/mapstore/MapStoreDynamicLoader';

const mongoPackageSrc = resolve(import.meta.dir, '../../../../packages/mongodb/src/index.ts');

describe('Wiring: installed-package dynamic loading', () => {
  it('package specifier resolves MongoMapStore class from mongodb package', async () => {
    const resolved = await MapStoreDynamicLoader.load(
      `${mongoPackageSrc}#MongoMapStore`,
    );
    expect(resolved).toBeDefined();
    expect(typeof resolved).toBe('function');
    expect((resolved as any).name).toBe('MongoMapStore');
  });

  it('package specifier resolves MongoPropertyResolver from mongodb package', async () => {
    const resolved = await MapStoreDynamicLoader.load(
      `${mongoPackageSrc}#MongoPropertyResolver`,
    );
    expect(resolved).toBeDefined();
    expect(typeof resolved).toBe('function');
  });

  it('package specifier resolves MongoDocumentMapper from mongodb package', async () => {
    const resolved = await MapStoreDynamicLoader.load(
      `${mongoPackageSrc}#MongoDocumentMapper`,
    );
    expect(resolved).toBeDefined();
    expect(typeof resolved).toBe('function');
  });

  it('invalid package specifier produces actionable error', async () => {
    await expect(
      MapStoreDynamicLoader.load('nonexistent-package-xyz#Export'),
    ).rejects.toThrow(/Failed to load module/);
  });
});
