/**
 * Tests for HeliosServer — standalone server lifecycle, config loading, port binding.
 *
 * Block 7.7: CLI entrypoint + standalone server mode
 */
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { HeliosServer } from '@zenystx/helios-core/server/HeliosServer';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

describe('HeliosServer — lifecycle', () => {
    let server: HeliosServer;

    beforeEach(() => {
        server = new HeliosServer();
    });

    afterEach(async () => {
        if (server.isRunning()) {
            await server.stop();
        }
    });

    it('should start in stopped state initially', () => {
        expect(server.getState()).toBe('stopped');
        expect(server.isRunning()).toBe(false);
    });

    it('should transition to running state after start()', async () => {
        await server.start();
        expect(server.getState()).toBe('running');
        expect(server.isRunning()).toBe(true);
    });

    it('should transition to stopped state after stop()', async () => {
        await server.start();
        await server.stop();
        expect(server.getState()).toBe('stopped');
        expect(server.isRunning()).toBe(false);
    });

    it('should expose the underlying HeliosInstance after start()', async () => {
        await server.start();
        const instance = server.getInstance();
        expect(instance).not.toBeNull();
        expect(instance!.isRunning()).toBe(true);
    });

    it('should return null instance before start()', () => {
        expect(server.getInstance()).toBeNull();
    });

    it('should return null instance after stop()', async () => {
        await server.start();
        await server.stop();
        expect(server.getInstance()).toBeNull();
    });

    it('should accept a HeliosConfig and use its name', async () => {
        const config = new HeliosConfig('test-node');
        await server.start(config);
        expect(server.getInstance()!.getName()).toBe('test-node');
    });

    it('should not throw if stop() is called when already stopped', async () => {
        // Should be idempotent
        await expect(server.stop()).resolves.toBeUndefined();
    });

    it('should not allow double start()', async () => {
        await server.start();
        await expect(server.start()).rejects.toThrow();
    });
});

describe('HeliosServer — config loading', () => {
    let server: HeliosServer;

    beforeEach(() => {
        server = new HeliosServer();
    });

    afterEach(async () => {
        if (server.isRunning()) {
            await server.stop();
        }
    });

    it('should start with default config when none provided', async () => {
        await server.start();
        expect(server.getInstance()!.getName()).toBe('helios');
    });

    it('should start with supplied HeliosConfig', async () => {
        const config = new HeliosConfig('my-cluster');
        await server.start(config);
        expect(server.getInstance()!.getName()).toBe('my-cluster');
    });

    it('should start with a config loaded from a JSON file path string', async () => {
        // Write a temp config file
        const tmpPath = '/tmp/helios-test-server-config.json';
        await Bun.write(tmpPath, JSON.stringify({ name: 'json-node' }));

        await server.start(tmpPath);
        expect(server.getInstance()!.getName()).toBe('json-node');
    });

    it('should reject an invalid config file path', async () => {
        await expect(server.start('/tmp/nonexistent-helios-config.json')).rejects.toThrow();
    });
});

describe('HeliosServer — port binding', () => {
    let server: HeliosServer;

    beforeEach(() => {
        server = new HeliosServer();
    });

    afterEach(async () => {
        if (server.isRunning()) {
            await server.stop();
        }
    });

    it('should report bound port after start()', async () => {
        await server.start();
        const port = server.getBoundPort();
        expect(port).not.toBeNull();
        expect(typeof port).toBe('number');
        expect(port!).toBeGreaterThan(0);
    });

    it('should report null bound port before start()', () => {
        expect(server.getBoundPort()).toBeNull();
    });

    it('should report null bound port after stop()', async () => {
        await server.start();
        await server.stop();
        expect(server.getBoundPort()).toBeNull();
    });

    it('should use the configured port from HeliosConfig network settings', async () => {
        const config = new HeliosConfig('port-test');
        config.getNetworkConfig().setPort(5701);
        await server.start(config);
        const port = server.getBoundPort();
        expect(port).toBe(5701);
    });
});

describe('HeliosServer — graceful shutdown', () => {
    it('should shut down the underlying HeliosInstance on stop()', async () => {
        const server = new HeliosServer();
        await server.start();
        const instance = server.getInstance()!;
        await server.stop();
        expect(instance.isRunning()).toBe(false);
    });

    it('should call registered shutdown hooks on stop()', async () => {
        const server = new HeliosServer();
        let hookCalled = false;
        server.addShutdownHook(() => { hookCalled = true; });
        await server.start();
        await server.stop();
        expect(hookCalled).toBe(true);
    });

    it('should call multiple shutdown hooks in registration order', async () => {
        const server = new HeliosServer();
        const order: number[] = [];
        server.addShutdownHook(() => { order.push(1); });
        server.addShutdownHook(() => { order.push(2); });
        server.addShutdownHook(() => { order.push(3); });
        await server.start();
        await server.stop();
        expect(order).toEqual([1, 2, 3]);
    });
});
