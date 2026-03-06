/**
 * Block 7.2 — Helios.newInstance() factory + config-driven bootstrap tests.
 *
 * Tests the public factory API:
 *   await Helios.newInstance()                    // default config
 *   await Helios.newInstance(config)              // explicit HeliosConfig
 *   await Helios.newInstance('helios-config.json') // file-based JSON
 *   await Helios.newInstance('helios-config.yml')  // file-based YAML
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Helios } from '@zenystx/core/Helios';
import { HeliosConfig } from '@zenystx/core/config/HeliosConfig';
import { MapConfig } from '@zenystx/core/config/MapConfig';
import path from 'path';
import fs from 'fs';

// Temp directory for fixture config files
const FIXTURE_DIR = path.join(import.meta.dir, '__fixtures__');

function writeFixture(filename: string, content: string): string {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    const filePath = path.join(FIXTURE_DIR, filename);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
}

function removeFixtures(): void {
    try { fs.rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('Helios.newInstance() — default config', () => {
    let hz: Awaited<ReturnType<typeof Helios.newInstance>>;

    afterEach(() => {
        Helios.shutdownAll();
    });

    it('creates an instance with default name "helios"', async () => {
        hz = await Helios.newInstance();
        expect(hz.getName()).toBe('helios');
    });

    it('instance is running after creation', async () => {
        hz = await Helios.newInstance();
        expect(hz.isRunning()).toBe(true);
    });

    it('instance provides getMap()', async () => {
        hz = await Helios.newInstance();
        const map = hz.getMap('test');
        expect(map).not.toBeNull();
    });

    it('instance provides getQueue()', async () => {
        hz = await Helios.newInstance();
        const q = hz.getQueue('q');
        expect(q).not.toBeNull();
    });
});

describe('Helios.newInstance(config) — explicit config', () => {
    afterEach(() => { Helios.shutdownAll(); });

    it('uses the provided config name', async () => {
        const config = new HeliosConfig('my-cluster');
        const hz = await Helios.newInstance(config);
        expect(hz.getName()).toBe('my-cluster');
    });

    it('respects MapConfig registered in HeliosConfig', async () => {
        const config = new HeliosConfig('prod');
        const mapCfg = new MapConfig('orders');
        mapCfg.setTimeToLiveSeconds(300);
        config.addMapConfig(mapCfg);

        const hz = await Helios.newInstance(config);
        const retrieved = hz.getMapConfig('orders');
        expect(retrieved).not.toBeNull();
        expect(retrieved!.getTimeToLiveSeconds()).toBe(300);
    });

    it('two instances with distinct names are tracked independently', async () => {
        const hz1 = await Helios.newInstance(new HeliosConfig('node-1'));
        const hz2 = await Helios.newInstance(new HeliosConfig('node-2'));

        expect(hz1.getName()).toBe('node-1');
        expect(hz2.getName()).toBe('node-2');
        expect(hz1).not.toBe(hz2);
    });
});

describe('Helios.getAllInstances() and getInstanceByName()', () => {
    afterEach(() => { Helios.shutdownAll(); });

    it('getAllInstances returns created instances', async () => {
        await Helios.newInstance(new HeliosConfig('alpha'));
        await Helios.newInstance(new HeliosConfig('beta'));

        const all = Helios.getAllInstances();
        expect(all.has('alpha')).toBe(true);
        expect(all.has('beta')).toBe(true);
    });

    it('getInstanceByName returns the right instance', async () => {
        await Helios.newInstance(new HeliosConfig('gamma'));
        const found = Helios.getInstanceByName('gamma');
        expect(found).not.toBeNull();
        expect(found!.getName()).toBe('gamma');
    });

    it('getInstanceByName returns null for unknown name', async () => {
        const found = Helios.getInstanceByName('doesNotExist');
        expect(found).toBeNull();
    });
});

describe('Helios.shutdownAll()', () => {
    it('shuts down all running instances', async () => {
        const hz1 = await Helios.newInstance(new HeliosConfig('s1'));
        const hz2 = await Helios.newInstance(new HeliosConfig('s2'));

        Helios.shutdownAll();

        expect(hz1.isRunning()).toBe(false);
        expect(hz2.isRunning()).toBe(false);
    });

    it('clears the instance registry after shutdownAll', async () => {
        await Helios.newInstance(new HeliosConfig('tmp'));
        Helios.shutdownAll();
        expect(Helios.getAllInstances().size).toBe(0);
    });
});

describe('Helios.newInstance(filePath) — JSON config file', () => {
    afterEach(() => {
        Helios.shutdownAll();
        removeFixtures();
    });

    it('loads a simple JSON config with just a name', async () => {
        const filePath = writeFixture('simple.json', JSON.stringify({ name: 'json-cluster' }));
        const hz = await Helios.newInstance(filePath);
        expect(hz.getName()).toBe('json-cluster');
    });

    it('loads JSON config with map entries', async () => {
        const filePath = writeFixture('with-maps.json', JSON.stringify({
            name: 'store',
            maps: [{ name: 'products', ttlSeconds: 60 }],
        }));
        const hz = await Helios.newInstance(filePath);
        expect(hz.getName()).toBe('store');
        const mc = hz.getMapConfig('products');
        expect(mc).not.toBeNull();
        expect(mc!.getTimeToLiveSeconds()).toBe(60);
    });

    it('loads JSON config with backupCount in map', async () => {
        const filePath = writeFixture('backup.json', JSON.stringify({
            name: 'bk',
            maps: [{ name: 'data', backupCount: 2 }],
        }));
        const hz = await Helios.newInstance(filePath);
        const mc = hz.getMapConfig('data');
        expect(mc!.getBackupCount()).toBe(2);
    });

    it('throws when JSON file does not exist', async () => {
        await expect(Helios.newInstance('/tmp/no-such-file-helios-7e2f.json'))
            .rejects.toThrow(/not found/i);
    });

    it('throws on unsupported file extension', async () => {
        const filePath = writeFixture('config.xml', '<config/>');
        await expect(Helios.newInstance(filePath))
            .rejects.toThrow(/unsupported.*format/i);
    });
});

describe('Helios.newInstance(filePath) — YAML config file', () => {
    afterEach(() => {
        Helios.shutdownAll();
        removeFixtures();
    });

    it('loads a simple YAML config with just a name', async () => {
        const filePath = writeFixture('simple.yml', 'name: yaml-cluster\n');
        const hz = await Helios.newInstance(filePath);
        expect(hz.getName()).toBe('yaml-cluster');
    });

    it('loads YAML config with map entries', async () => {
        const filePath = writeFixture('maps.yaml', [
            'name: warehouse',
            'maps:',
            '  - name: inventory',
            '    ttlSeconds: 120',
        ].join('\n'));
        const hz = await Helios.newInstance(filePath);
        expect(hz.getName()).toBe('warehouse');
        const mc = hz.getMapConfig('inventory');
        expect(mc).not.toBeNull();
        expect(mc!.getTimeToLiveSeconds()).toBe(120);
    });

    it('loads a .yaml extension as well as .yml', async () => {
        const filePath = writeFixture('alt.yaml', 'name: alt-cluster\n');
        const hz = await Helios.newInstance(filePath);
        expect(hz.getName()).toBe('alt-cluster');
    });
});

describe('Config validation', () => {
    afterEach(() => {
        Helios.shutdownAll();
        removeFixtures();
    });

    it('throws when instance name is empty string', async () => {
        const filePath = writeFixture('empty-name.json', JSON.stringify({ name: '' }));
        await expect(Helios.newInstance(filePath))
            .rejects.toThrow(/instance name.*empty/i);
    });

    it('throws when config root is not an object', async () => {
        const filePath = writeFixture('bad-root.json', '"just-a-string"');
        await expect(Helios.newInstance(filePath))
            .rejects.toThrow(/config must be an object/i);
    });

    it('throws when a map entry is missing a name', async () => {
        const filePath = writeFixture('map-no-name.json', JSON.stringify({
            name: 'ok',
            maps: [{ ttlSeconds: 5 }],
        }));
        await expect(Helios.newInstance(filePath))
            .rejects.toThrow(/map.*name/i);
    });
});

describe('Deferred service stubs', () => {
    afterEach(() => { Helios.shutdownAll(); });

    it('getSql() throws a deferred-feature error', async () => {
        const hz = await Helios.newInstance();
        expect(() => (hz as unknown as Record<string, () => void>).getSql()).toThrow(/sql.*not supported|deferred/i);
    });

    it('getJet() throws a deferred-feature error', async () => {
        const hz = await Helios.newInstance();
        expect(() => (hz as unknown as Record<string, () => void>).getJet()).toThrow(/jet.*not supported|deferred/i);
    });

    it('getCPSubsystem() throws a deferred-feature error', async () => {
        const hz = await Helios.newInstance();
        expect(() => (hz as unknown as Record<string, () => void>).getCPSubsystem()).toThrow(/cp.*not supported|deferred/i);
    });

    it('getScheduledExecutorService() throws a deferred-feature error', async () => {
        const hz = await Helios.newInstance();
        expect(() => (hz as unknown as Record<string, (...args: unknown[]) => void>).getScheduledExecutorService('s1'))
            .toThrow(/scheduledexecutor.*not supported|deferred/i);
    });
});
