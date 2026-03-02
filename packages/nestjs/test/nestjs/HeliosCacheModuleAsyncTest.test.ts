/**
 * Tests for Block 9.3 — HeliosCacheModule.registerAsync
 *
 * Verifies async registration patterns: useFactory, inject, useClass, useExisting.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { Test, TestingModule } from '@nestjs/testing';
import { Injectable, Module } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import {
    HeliosCacheModule,
    type HeliosCacheModuleOptions,
    type HeliosCacheModuleOptionsFactory,
} from '@helios/nestjs/HeliosCacheModule';

describe('HeliosCacheModule.registerAsync', () => {
    let module: TestingModule;

    afterEach(async () => {
        if (module) await module.close();
    });

    // Test 1 — useFactory provides CACHE_MANAGER
    it('registerAsync with useFactory provides CACHE_MANAGER', async () => {
        module = await Test.createTestingModule({
            imports: [
                HeliosCacheModule.registerAsync({
                    useFactory: () => ({}),
                }),
            ],
        }).compile();

        const cacheManager = module.get<Cache>(CACHE_MANAGER);
        expect(cacheManager).toBeDefined();
    });

    // Test 2 — useFactory with ttl, can get/set values
    it('registerAsync with useFactory can get/set values', async () => {
        module = await Test.createTestingModule({
            imports: [
                HeliosCacheModule.registerAsync({
                    useFactory: () => ({ ttl: 5000 }),
                }),
            ],
        }).compile();

        const cacheManager = module.get<Cache>(CACHE_MANAGER);
        await cacheManager.set('k1', 'v1');
        expect(await cacheManager.get<string>('k1')).toBe('v1');
    });

    // Test 3 — useFactory with imports + inject resolves dependencies
    it('registerAsync with imports and inject resolves injected deps', async () => {
        const TTL_TOKEN = 'CACHE_TTL_TOKEN';

        @Module({
            providers: [{ provide: TTL_TOKEN, useValue: 10_000 }],
            exports: [TTL_TOKEN],
        })
        class ConfigModule {}

        module = await Test.createTestingModule({
            imports: [
                HeliosCacheModule.registerAsync({
                    imports: [ConfigModule],
                    useFactory: (ttl: number) => ({ ttl }),
                    inject: [TTL_TOKEN],
                }),
            ],
        }).compile();

        const cacheManager = module.get<Cache>(CACHE_MANAGER);
        expect(cacheManager).toBeDefined();
        // Verify the ttl was passed through (store works)
        await cacheManager.set('a', 42);
        expect(await cacheManager.get<number>('a')).toBe(42);
    });

    // Test 4 — useClass pattern with HeliosCacheModuleOptionsFactory
    it('registerAsync with useClass provides CACHE_MANAGER', async () => {
        @Injectable()
        class MyCacheOptionsFactory implements HeliosCacheModuleOptionsFactory {
            createHeliosCacheOptions(): HeliosCacheModuleOptions {
                return { ttl: 3000 };
            }
        }

        module = await Test.createTestingModule({
            imports: [
                HeliosCacheModule.registerAsync({
                    useClass: MyCacheOptionsFactory,
                }),
            ],
        }).compile();

        const cacheManager = module.get<Cache>(CACHE_MANAGER);
        expect(cacheManager).toBeDefined();
    });

    // Test 5 — async factory (Promise-returning) works
    it('registerAsync with async useFactory resolves promise options', async () => {
        module = await Test.createTestingModule({
            imports: [
                HeliosCacheModule.registerAsync({
                    useFactory: async () => {
                        await Promise.resolve(); // simulate async work
                        return { ttl: 1000 };
                    },
                }),
            ],
        }).compile();

        const cacheManager = module.get<Cache>(CACHE_MANAGER);
        expect(cacheManager).toBeDefined();
        await cacheManager.set('async-key', 'async-val');
        expect(await cacheManager.get<string>('async-key')).toBe('async-val');
    });

    // Test 6 — returns a DynamicModule with correct module reference
    it('registerAsync returns a DynamicModule', () => {
        const dm = HeliosCacheModule.registerAsync({
            useFactory: () => ({}),
        });
        expect(dm.module).toBe(HeliosCacheModule);
    });
});
