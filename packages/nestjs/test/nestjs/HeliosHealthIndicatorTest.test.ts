/**
 * Tests for HeliosHealthIndicator — @nestjs/terminus integration.
 * Block 9.5.
 */
import { describe, it, expect } from 'bun:test';
import { Test } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';
import { HeliosModule } from '../../src/HeliosModule';
import { HeliosHealthIndicator } from '../../src/health/HeliosHealthIndicator';
import { HELIOS_INSTANCE_TOKEN } from '../../src/HeliosInstanceDefinition';
import type { HeliosInstance } from '@zenystx/helios-core/core/HeliosInstance';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeInstance(running = true, memberCount = 3): HeliosInstance {
    return {
        getName: () => 'test-node',
        getLifecycleService: () => ({
            isRunning: () => running,
            addLifecycleListener: () => 'id',
            removeLifecycleListener: () => true,
            shutdown: () => undefined,
        }),
        getCluster: () => ({
            getMembers: () => Array.from({ length: memberCount }, (_, i) => ({ getUuid: () => `uuid-${i}` })) as any,
            getLocalMember: () => ({ getUuid: () => 'uuid-0' }) as any,
        }),
        getConfig: () => ({}) as any,
        getMap: () => { throw new Error('not used'); },
        getQueue: () => { throw new Error('not used'); },
        getList: () => { throw new Error('not used'); },
        getSet: () => { throw new Error('not used'); },
        getTopic: () => { throw new Error('not used'); },
        getMultiMap: () => { throw new Error('not used'); },
        getReplicatedMap: () => { throw new Error('not used'); },
        getDistributedObject: () => { throw new Error('not used'); },
        shutdown: () => undefined,
    } as unknown as HeliosInstance;
}

// ── unit-level (no NestJS DI) ─────────────────────────────────────────────────

describe('HeliosHealthIndicator — unit', () => {
    let indicator: HeliosHealthIndicator;
    const healthIndicatorService = new HealthIndicatorService();

    it('returns status=up when instance is running', () => {
        indicator = new HeliosHealthIndicator(makeInstance(true, 2), healthIndicatorService);
        const result = indicator.isHealthy('helios');
        expect(result['helios'].status).toBe('up');
    });

    it('includes memberCount in up result', () => {
        indicator = new HeliosHealthIndicator(makeInstance(true, 5), healthIndicatorService);
        const result = indicator.isHealthy('helios');
        expect((result['helios'] as any).memberCount).toBe(5);
    });

    it('returns status=down when instance is not running', () => {
        indicator = new HeliosHealthIndicator(makeInstance(false), healthIndicatorService);
        const result = indicator.isHealthy('helios');
        expect(result['helios'].status).toBe('down');
    });

    it('down result includes a message', () => {
        indicator = new HeliosHealthIndicator(makeInstance(false), healthIndicatorService);
        const result = indicator.isHealthy('helios');
        expect(typeof (result['helios'] as any).message).toBe('string');
        expect((result['helios'] as any).message.length).toBeGreaterThan(0);
    });

    it('uses the key argument as the result key', () => {
        indicator = new HeliosHealthIndicator(makeInstance(true, 1), healthIndicatorService);
        const result = indicator.isHealthy('my-helios');
        expect('my-helios' in result).toBe(true);
        expect('helios' in result).toBe(false);
    });

    it('throws HealthCheckError when getLifecycleService throws', () => {
        const broken = {
            getLifecycleService: () => { throw new Error('lifecycle unavailable'); },
            getCluster: () => ({ getMembers: () => [] }),
        } as unknown as HeliosInstance;
        indicator = new HeliosHealthIndicator(broken, healthIndicatorService);
        expect(() => indicator.isHealthy('helios')).toThrow();
    });
});

// ── NestJS DI integration ──────────────────────────────────────────────────────

describe('HeliosHealthIndicator — NestJS DI', () => {
    it('can be resolved from DI when registered as a provider', async () => {
        const instanceStub = makeInstance(true, 1);
        const module = await Test.createTestingModule({
            providers: [
                HeliosHealthIndicator,
                HealthIndicatorService,
                { provide: HELIOS_INSTANCE_TOKEN, useValue: instanceStub },
            ],
        }).compile();

        const indicator = module.get(HeliosHealthIndicator);
        expect(indicator).toBeDefined();
        const result = indicator.isHealthy('helios');
        expect(result['helios'].status).toBe('up');
    });

    it('exports HeliosHealthIndicator from HeliosHealthModule (with global HeliosModule)', async () => {
        const instanceStub = makeInstance(true, 1);
        const { HeliosHealthModule } = await import('../../src/health/HeliosHealthModule');
        // HeliosModule.forRoot() is @Global() and exports HELIOS_INSTANCE_TOKEN,
        // making it available to HeliosHealthModule's providers.
        const module = await Test.createTestingModule({
            imports: [
                HeliosModule.forRoot(instanceStub as unknown as HeliosInstance),
                HeliosHealthModule,
            ],
        }).compile();

        const indicator = module.get(HeliosHealthIndicator);
        expect(indicator).toBeDefined();
        const result = indicator.isHealthy('helios');
        expect(result['helios'].status).toBe('up');
    });
});
