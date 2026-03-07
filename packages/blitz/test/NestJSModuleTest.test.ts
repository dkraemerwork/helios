/**
 * Block 10.9 — NestJS integration tests
 *
 * Tests for HeliosBlitzModule, HeliosBlitzService, and @InjectBlitz() decorator.
 * BlitzService.connect() is mocked throughout — no real NATS server required.
 */
import { Injectable } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import 'reflect-metadata';

import { BlitzService } from '../src/BlitzService.ts';
import { Pipeline } from '../src/Pipeline.ts';
import { BatchPipeline } from '../src/batch/BatchPipeline.ts';

import { HeliosBlitzModule } from '../src/nestjs/HeliosBlitzModule.ts';
import { HeliosBlitzService } from '../src/nestjs/HeliosBlitzService.ts';
import { HELIOS_BLITZ_SERVICE_TOKEN, InjectBlitz } from '../src/nestjs/InjectBlitz.decorator.ts';

// ── Mock helpers ────────────────────────────────────────────────────────────

let _mockShutdown: ReturnType<typeof mock>;
let _mockPipeline: ReturnType<typeof mock>;
let _mockBatch: ReturnType<typeof mock>;
let _mockSubmit: ReturnType<typeof mock>;
let _mockCancel: ReturnType<typeof mock>;
let _mockIsRunning: ReturnType<typeof mock>;
let _mockOn: ReturnType<typeof mock>;
let _mockOff: ReturnType<typeof mock>;
let _mockBlitz: BlitzService;

function buildMockBlitz(): BlitzService {
    _mockShutdown = mock(() => Promise.resolve());
    _mockPipeline = mock((name: string) => new Pipeline(name));
    _mockBatch = mock((name: string) => new BatchPipeline(name));
    _mockSubmit = mock(() => Promise.resolve());
    _mockCancel = mock(() => Promise.resolve());
    _mockIsRunning = mock(() => false);
    const self = {
        isClosed: false,
        config: { servers: 'nats://localhost:4222', connectTimeoutMs: 5000, maxReconnectAttempts: -1, reconnectWaitMs: 500, natsPendingLimit: 4096 },
        nc: {} as never,
        js: {} as never,
        jsm: {} as never,
        kvm: {} as never,
        shutdown: _mockShutdown,
        pipeline: _mockPipeline,
        batch: _mockBatch,
        submit: _mockSubmit,
        cancel: _mockCancel,
        isRunning: _mockIsRunning,
    } as unknown as BlitzService;
    // on/off return `this` (the mock blitz) for chaining
    _mockOn = mock(() => self);
    _mockOff = mock(() => self);
    (self as unknown as Record<string, unknown>)['on'] = _mockOn;
    (self as unknown as Record<string, unknown>)['off'] = _mockOff;
    return self;
}

const TEST_CONFIG = { servers: 'nats://localhost:4222' };

// ── forRoot() registration ───────────────────────────────────────────────────

describe('HeliosBlitzModule.forRoot()', () => {
    let connectSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        _mockBlitz = buildMockBlitz();
        connectSpy = spyOn(BlitzService, 'connect').mockImplementation(async () => _mockBlitz);
    });

    afterEach(async () => {
        connectSpy.mockRestore();
    });

    it('module compiles with valid BlitzConfig', async () => {
        const mod: TestingModule = await Test.createTestingModule({
            imports: [HeliosBlitzModule.forRoot(TEST_CONFIG)],
        }).compile();
        expect(mod).toBeDefined();
        await mod.close();
    });

    it('HeliosBlitzService is injectable after forRoot()', async () => {
        const mod: TestingModule = await Test.createTestingModule({
            imports: [HeliosBlitzModule.forRoot(TEST_CONFIG)],
        }).compile();
        const svc = mod.get<HeliosBlitzService>(HELIOS_BLITZ_SERVICE_TOKEN);
        expect(svc).toBeInstanceOf(HeliosBlitzService);
        await mod.close();
    });

    it('HeliosBlitzService exposes underlying BlitzService', async () => {
        const mod: TestingModule = await Test.createTestingModule({
            imports: [HeliosBlitzModule.forRoot(TEST_CONFIG)],
        }).compile();
        const svc = mod.get<HeliosBlitzService>(HELIOS_BLITZ_SERVICE_TOKEN);
        expect(svc.blitz).toBe(_mockBlitz);
        await mod.close();
    });

    it('BlitzService.connect() is called with the provided config', async () => {
        const mod: TestingModule = await Test.createTestingModule({
            imports: [HeliosBlitzModule.forRoot(TEST_CONFIG)],
        }).compile();
        expect(connectSpy).toHaveBeenCalledWith(TEST_CONFIG);
        await mod.close();
    });

    it('module exports HELIOS_BLITZ_SERVICE_TOKEN so child modules can inject it', async () => {
        @Injectable()
        class Consumer {
            constructor(@InjectBlitz() public readonly svc: HeliosBlitzService) {}
        }

        const mod: TestingModule = await Test.createTestingModule({
            imports: [HeliosBlitzModule.forRoot(TEST_CONFIG)],
            providers: [Consumer],
        }).compile();
        const consumer = mod.get(Consumer);
        expect(consumer.svc).toBeInstanceOf(HeliosBlitzService);
        await mod.close();
    });
});

// ── forRootAsync() — useFactory ──────────────────────────────────────────────

describe('HeliosBlitzModule.forRootAsync() — useFactory', () => {
    let connectSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        _mockBlitz = buildMockBlitz();
        connectSpy = spyOn(BlitzService, 'connect').mockImplementation(async () => _mockBlitz);
    });

    afterEach(async () => {
        connectSpy.mockRestore();
    });

    it('module compiles with useFactory', async () => {
        const mod: TestingModule = await Test.createTestingModule({
            imports: [
                HeliosBlitzModule.forRootAsync({
                    useFactory: async () => TEST_CONFIG,
                }),
            ],
        }).compile();
        expect(mod).toBeDefined();
        await mod.close();
    });

    it('useFactory is invoked during module compilation', async () => {
        const factory = mock(async () => TEST_CONFIG);
        const mod: TestingModule = await Test.createTestingModule({
            imports: [HeliosBlitzModule.forRootAsync({ useFactory: factory })],
        }).compile();
        expect(factory).toHaveBeenCalledTimes(1);
        await mod.close();
    });

    it('useFactory result is used to connect BlitzService', async () => {
        const customConfig = { servers: 'nats://custom:4222' };
        const mod: TestingModule = await Test.createTestingModule({
            imports: [
                HeliosBlitzModule.forRootAsync({
                    useFactory: async () => customConfig,
                }),
            ],
        }).compile();
        expect(connectSpy).toHaveBeenCalledWith(customConfig);
        await mod.close();
    });

    it('useFactory with inject array receives injected dependencies', async () => {
        const TOKEN = 'MY_SERVERS';

        const mod: TestingModule = await Test.createTestingModule({
            imports: [
                HeliosBlitzModule.forRootAsync({
                    useFactory: async (...args: unknown[]) => ({ servers: args[0] as string }),
                    inject: [TOKEN],
                    extraProviders: [{ provide: TOKEN, useValue: 'nats://injected:4222' }],
                }),
            ],
        }).compile();
        expect(connectSpy).toHaveBeenCalledWith({ servers: 'nats://injected:4222' });
        await mod.close();
    });

    it('forRootAsync provides HeliosBlitzService', async () => {
        const mod: TestingModule = await Test.createTestingModule({
            imports: [
                HeliosBlitzModule.forRootAsync({
                    useFactory: async () => TEST_CONFIG,
                }),
            ],
        }).compile();
        const svc = mod.get<HeliosBlitzService>(HELIOS_BLITZ_SERVICE_TOKEN);
        expect(svc).toBeInstanceOf(HeliosBlitzService);
        await mod.close();
    });
});

// ── @InjectBlitz() decorator ─────────────────────────────────────────────────

describe('@InjectBlitz() / HELIOS_BLITZ_SERVICE_TOKEN', () => {
    it('HELIOS_BLITZ_SERVICE_TOKEN is a non-empty string', () => {
        expect(typeof HELIOS_BLITZ_SERVICE_TOKEN).toBe('string');
        expect(HELIOS_BLITZ_SERVICE_TOKEN.length).toBeGreaterThan(0);
    });

    it('InjectBlitz is a factory function returning a ParameterDecorator', () => {
        expect(typeof InjectBlitz).toBe('function');
        const decorator = InjectBlitz();
        expect(typeof decorator).toBe('function');
    });

    it('@InjectBlitz() resolves HeliosBlitzService', async () => {
        const connectSpy = spyOn(BlitzService, 'connect').mockImplementation(async () => buildMockBlitz());

        @Injectable()
        class MyService {
            constructor(@InjectBlitz() public readonly blitz: HeliosBlitzService) {}
        }

        const mod: TestingModule = await Test.createTestingModule({
            imports: [HeliosBlitzModule.forRoot(TEST_CONFIG)],
            providers: [MyService],
        }).compile();
        const svc = mod.get(MyService);
        expect(svc.blitz).toBeInstanceOf(HeliosBlitzService);
        await mod.close();
        connectSpy.mockRestore();
    });

    it('@InjectBlitz() service has pipeline() method', async () => {
        const mockBlitz = buildMockBlitz();
        const connectSpy = spyOn(BlitzService, 'connect').mockImplementation(async () => mockBlitz);

        const mod: TestingModule = await Test.createTestingModule({
            imports: [HeliosBlitzModule.forRoot(TEST_CONFIG)],
        }).compile();
        const svc = mod.get<HeliosBlitzService>(HELIOS_BLITZ_SERVICE_TOKEN);
        const p = svc.pipeline('test');
        expect(p).toBeInstanceOf(Pipeline);
        await mod.close();
        connectSpy.mockRestore();
    });
});

// ── Lifecycle — OnModuleDestroy ──────────────────────────────────────────────

describe('HeliosBlitzService lifecycle', () => {
    let connectSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        _mockBlitz = buildMockBlitz();
        connectSpy = spyOn(BlitzService, 'connect').mockImplementation(async () => _mockBlitz);
    });

    afterEach(() => {
        connectSpy.mockRestore();
    });

    it('HeliosBlitzService has onModuleDestroy()', async () => {
        const svc = new HeliosBlitzService(_mockBlitz);
        expect(typeof svc.onModuleDestroy).toBe('function');
    });

    it('onModuleDestroy() calls shutdown() on the underlying BlitzService', async () => {
        const svc = new HeliosBlitzService(_mockBlitz);
        await svc.onModuleDestroy();
        expect(_mockShutdown).toHaveBeenCalledTimes(1);
    });

    it('onModuleDestroy() is safe when blitz is already closed', async () => {
        (_mockBlitz as unknown as Record<string, unknown>)['isClosed'] = true;
        const svc = new HeliosBlitzService(_mockBlitz);
        await svc.onModuleDestroy(); // must not throw
        expect(_mockShutdown).toHaveBeenCalledTimes(0);
    });

    it('module.close() triggers onModuleDestroy and calls shutdown()', async () => {
        const mod: TestingModule = await Test.createTestingModule({
            imports: [HeliosBlitzModule.forRoot(TEST_CONFIG)],
        }).compile();
        await mod.close();
        expect(_mockShutdown).toHaveBeenCalledTimes(1);
    });

    it('closing module twice only shuts down once (isClosed guard)', async () => {
        let closed = false;
        _mockShutdown = mock(() => {
            closed = true;
            (_mockBlitz as unknown as Record<string, unknown>)['isClosed'] = true;
            return Promise.resolve();
        });
        (_mockBlitz as unknown as Record<string, unknown>)['shutdown'] = _mockShutdown;

        const mod: TestingModule = await Test.createTestingModule({
            imports: [HeliosBlitzModule.forRoot(TEST_CONFIG)],
        }).compile();
        const svc = mod.get<HeliosBlitzService>(HELIOS_BLITZ_SERVICE_TOKEN);
        await mod.close();
        await svc.onModuleDestroy(); // second call — should be a no-op
        expect(_mockShutdown).toHaveBeenCalledTimes(1);
    });
});

// ── BlitzService delegation (proxy methods) ───────────────────────────────────

describe('HeliosBlitzService — delegation to BlitzService', () => {
    beforeEach(() => {
        _mockBlitz = buildMockBlitz();
    });

    it('pipeline() delegates to BlitzService.pipeline()', () => {
        const svc = new HeliosBlitzService(_mockBlitz);
        const p = svc.pipeline('my-pipe');
        expect(_mockPipeline).toHaveBeenCalledWith('my-pipe');
        expect(p).toBeInstanceOf(Pipeline);
    });

    it('batch() delegates to BlitzService.batch()', () => {
        const svc = new HeliosBlitzService(_mockBlitz);
        const b = svc.batch('my-batch');
        expect(_mockBatch).toHaveBeenCalledWith('my-batch');
        expect(b).toBeInstanceOf(BatchPipeline);
    });

    it('isRunning() delegates to BlitzService.isRunning()', () => {
        (_mockIsRunning as ReturnType<typeof mock>).mockReturnValue(true);
        const svc = new HeliosBlitzService(_mockBlitz);
        expect(svc.isRunning('x')).toBe(true);
        expect(_mockIsRunning).toHaveBeenCalledWith('x');
    });

    it('on() delegates and returns HeliosBlitzService for chaining', () => {
        const svc = new HeliosBlitzService(_mockBlitz);
        const listener = mock(() => {});
        const result = svc.on(listener);
        expect(_mockOn).toHaveBeenCalledWith(listener);
        expect(result).toBe(svc);
    });

    it('off() delegates and returns HeliosBlitzService for chaining', () => {
        const svc = new HeliosBlitzService(_mockBlitz);
        const listener = mock(() => {});
        const result = svc.off(listener);
        expect(_mockOff).toHaveBeenCalledWith(listener);
        expect(result).toBe(svc);
    });

    it('isClosed reflects underlying BlitzService.isClosed', () => {
        const svc = new HeliosBlitzService(_mockBlitz);
        expect(svc.isClosed).toBe(false);
        (_mockBlitz as unknown as Record<string, unknown>)['isClosed'] = true;
        expect(svc.isClosed).toBe(true);
    });
});

// ── Barrel isolation ─────────────────────────────────────────────────────────

describe('Barrel isolation — src/index.ts must not import nestjs/', () => {
    it('src/index.ts does not import from nestjs/', async () => {
        const indexPath = new URL('../src/index.ts', import.meta.url).pathname;
        const contents = await Bun.file(indexPath).text();
        // Must not import/export from the nestjs/ submodule (comments are OK)
        expect(contents).not.toMatch(/from ['"]\.\/nestjs/);
        expect(contents).not.toMatch(/from ['"].*@nestjs/);
    });

    it('src/nestjs/index.ts exists and exports HeliosBlitzModule', async () => {
        const nestjsIndex = await import('../src/nestjs/index.ts');
        expect(nestjsIndex.HeliosBlitzModule).toBeDefined();
        expect(nestjsIndex.HeliosBlitzService).toBeDefined();
        expect(nestjsIndex.InjectBlitz).toBeDefined();
        expect(nestjsIndex.HELIOS_BLITZ_SERVICE_TOKEN).toBeDefined();
    });
});
