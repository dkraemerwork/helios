import { describe, expect, test } from 'bun:test';
import { TursoMapStore } from '../src/TursoMapStore.js';

describe('TursoConfig', () => {
  test('default tableName is set from mapName during init()', async () => {
    const store = new TursoMapStore({ url: ':memory:' });
    await store.init(new Map(), 'my_map');
    // tableName should be 'my_map' (from mapName)
    expect((store as any)._tableName).toBe('my_map');
    await store.destroy();
  });

  test('explicit tableName from config overrides mapName', async () => {
    const store = new TursoMapStore({ url: ':memory:', tableName: 'override_table' });
    await store.init(new Map(), 'my_map');
    expect((store as any)._tableName).toBe('override_table');
    await store.destroy();
  });
});
