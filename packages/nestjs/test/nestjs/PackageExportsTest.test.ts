/**
 * Block 9.9 — Subpath exports, package structure tests, build + publish verification.
 *
 * Verifies that:
 *  1. The main @helios/nestjs index barrel exports all expected public API symbols.
 *  2. Subpath imports (@helios/nestjs/cache, /transaction, /health, /events, /decorators)
 *     each export the right symbols independently.
 *  3. package.json files/exports structure is publish-ready.
 */

import { describe, it, expect } from 'bun:test';
import * as MainExports from '@helios/nestjs/index';
import * as CacheExports from '@helios/nestjs/cache';
import * as TransactionExports from '@helios/nestjs/transaction';
import * as HealthExports from '@helios/nestjs/health';
import * as EventsExports from '@helios/nestjs/events';
import * as DecoratorsExports from '@helios/nestjs/decorators';
import * as AutoconfigExports from '@helios/nestjs/autoconfiguration';
import * as ContextExports from '@helios/nestjs/context';

// ─── 1. Main barrel ──────────────────────────────────────────────────────────

describe('PackageExports / main barrel', () => {
    it('exports HeliosModule', () => {
        expect(MainExports.HeliosModule).toBeDefined();
    });

    it('exports HELIOS_INSTANCE_TOKEN', () => {
        expect(MainExports.HELIOS_INSTANCE_TOKEN).toBeDefined();
    });

    it('exports HeliosCacheModule', () => {
        expect(MainExports.HeliosCacheModule).toBeDefined();
    });

    it('exports HeliosCache', () => {
        expect(MainExports.HeliosCache).toBeDefined();
    });

    it('exports HeliosTransactionModule', () => {
        expect(MainExports.HeliosTransactionModule).toBeDefined();
    });

    it('exports HeliosTransactionManager', () => {
        expect(MainExports.HeliosTransactionManager).toBeDefined();
    });

    it('exports Transactional decorator', () => {
        expect(MainExports.Transactional).toBeDefined();
    });

    it('exports Propagation enum', () => {
        expect(MainExports.Propagation).toBeDefined();
    });

    it('exports HeliosHealthIndicator', () => {
        expect(MainExports.HeliosHealthIndicator).toBeDefined();
    });

    it('exports HeliosHealthModule', () => {
        expect(MainExports.HeliosHealthModule).toBeDefined();
    });

    it('exports HeliosEventBridge', () => {
        expect(MainExports.HeliosEventBridge).toBeDefined();
    });

    it('exports HeliosEventBridgeModule', () => {
        expect(MainExports.HeliosEventBridgeModule).toBeDefined();
    });

    it('exports InjectHelios decorator', () => {
        expect(MainExports.InjectHelios).toBeDefined();
    });

    it('exports InjectMap decorator', () => {
        expect(MainExports.InjectMap).toBeDefined();
    });

    it('exports Cacheable decorator', () => {
        expect(MainExports.Cacheable).toBeDefined();
    });

    it('exports CacheEvict decorator', () => {
        expect(MainExports.CacheEvict).toBeDefined();
    });

    it('exports CachePut decorator', () => {
        expect(MainExports.CachePut).toBeDefined();
    });

    it('exports NestAware', () => {
        expect(MainExports.NestAware).toBeDefined();
    });

    it('exports NestManagedContext', () => {
        expect(MainExports.NestManagedContext).toBeDefined();
    });
});

// ─── 2. @helios/nestjs/cache subpath ─────────────────────────────────────────

describe('PackageExports / subpath: cache', () => {
    it('exports HeliosCacheModule', () => {
        expect(CacheExports.HeliosCacheModule).toBeDefined();
    });

    it('exports HeliosCache', () => {
        expect(CacheExports.HeliosCache).toBeDefined();
    });

    it('exports Cacheable', () => {
        expect(CacheExports.Cacheable).toBeDefined();
    });

    it('exports CacheEvict', () => {
        expect(CacheExports.CacheEvict).toBeDefined();
    });

    it('exports CachePut', () => {
        expect(CacheExports.CachePut).toBeDefined();
    });
});

// ─── 3. @helios/nestjs/transaction subpath ────────────────────────────────────

describe('PackageExports / subpath: transaction', () => {
    it('exports HeliosTransactionModule', () => {
        expect(TransactionExports.HeliosTransactionModule).toBeDefined();
    });

    it('exports HeliosTransactionManager', () => {
        expect(TransactionExports.HeliosTransactionManager).toBeDefined();
    });

    it('exports Transactional', () => {
        expect(TransactionExports.Transactional).toBeDefined();
    });

    it('exports Propagation', () => {
        expect(TransactionExports.Propagation).toBeDefined();
    });

    it('exports ManagedTransactionalTaskContext', () => {
        expect(TransactionExports.ManagedTransactionalTaskContext).toBeDefined();
    });
});

// ─── 4. @helios/nestjs/health subpath ────────────────────────────────────────

describe('PackageExports / subpath: health', () => {
    it('exports HeliosHealthIndicator', () => {
        expect(HealthExports.HeliosHealthIndicator).toBeDefined();
    });

    it('exports HeliosHealthModule', () => {
        expect(HealthExports.HeliosHealthModule).toBeDefined();
    });
});

// ─── 5. @helios/nestjs/events subpath ────────────────────────────────────────

describe('PackageExports / subpath: events', () => {
    it('exports HeliosEventBridge', () => {
        expect(EventsExports.HeliosEventBridge).toBeDefined();
    });

    it('exports HeliosEventBridgeModule', () => {
        expect(EventsExports.HeliosEventBridgeModule).toBeDefined();
    });
});

// ─── 6. @helios/nestjs/decorators subpath ────────────────────────────────────

describe('PackageExports / subpath: decorators', () => {
    it('exports InjectHelios', () => {
        expect(DecoratorsExports.InjectHelios).toBeDefined();
    });

    it('exports InjectMap', () => {
        expect(DecoratorsExports.InjectMap).toBeDefined();
    });

    it('exports InjectQueue', () => {
        expect(DecoratorsExports.InjectQueue).toBeDefined();
    });

    it('exports InjectTopic', () => {
        expect(DecoratorsExports.InjectTopic).toBeDefined();
    });

    it('exports InjectList', () => {
        expect(DecoratorsExports.InjectList).toBeDefined();
    });
});

// ─── 7. @helios/nestjs/autoconfiguration subpath ─────────────────────────────

describe('PackageExports / subpath: autoconfiguration', () => {
    it('exports HeliosAutoConfigurationModule', () => {
        expect(AutoconfigExports.HeliosAutoConfigurationModule).toBeDefined();
    });

    it('exports HeliosBoot4ObjectExtractionModule', () => {
        expect(AutoconfigExports.HeliosBoot4ObjectExtractionModule).toBeDefined();
    });
});

// ─── 8. @helios/nestjs/context subpath ───────────────────────────────────────

describe('PackageExports / subpath: context', () => {
    it('exports NestAware', () => {
        expect(ContextExports.NestAware).toBeDefined();
    });

    it('exports NestManagedContext', () => {
        expect(ContextExports.NestManagedContext).toBeDefined();
    });

    it('exports isNestAware', () => {
        expect(ContextExports.isNestAware).toBeDefined();
    });
});

// ─── 9. Package structure ────────────────────────────────────────────────────

describe('PackageExports / package.json structure', () => {
    const pkg = require('../../package.json') as Record<string, unknown>;

    it('has name @helios/nestjs', () => {
        expect(pkg['name']).toBe('@helios/nestjs');
    });

    it('has exports map with main "." entry', () => {
        const exports = pkg['exports'] as Record<string, unknown>;
        expect(exports['.']).toBeDefined();
    });

    it('has subpath export for ./cache', () => {
        const exports = pkg['exports'] as Record<string, unknown>;
        expect(exports['./cache']).toBeDefined();
    });

    it('has subpath export for ./transaction', () => {
        const exports = pkg['exports'] as Record<string, unknown>;
        expect(exports['./transaction']).toBeDefined();
    });

    it('has subpath export for ./health', () => {
        const exports = pkg['exports'] as Record<string, unknown>;
        expect(exports['./health']).toBeDefined();
    });

    it('has subpath export for ./events', () => {
        const exports = pkg['exports'] as Record<string, unknown>;
        expect(exports['./events']).toBeDefined();
    });

    it('has subpath export for ./decorators', () => {
        const exports = pkg['exports'] as Record<string, unknown>;
        expect(exports['./decorators']).toBeDefined();
    });

    it('has subpath export for ./autoconfiguration', () => {
        const exports = pkg['exports'] as Record<string, unknown>;
        expect(exports['./autoconfiguration']).toBeDefined();
    });

    it('has subpath export for ./context', () => {
        const exports = pkg['exports'] as Record<string, unknown>;
        expect(exports['./context']).toBeDefined();
    });

    it('has files field containing dist/src', () => {
        const files = pkg['files'] as string[];
        expect(files).toContain('dist/src');
    });

    it('has prepublish script', () => {
        const scripts = pkg['scripts'] as Record<string, string>;
        expect(scripts['prepublish']).toBeDefined();
    });

    it('is not private (publishable)', () => {
        expect(pkg['private']).not.toBe(true);
    });

    it('has build script', () => {
        const scripts = pkg['scripts'] as Record<string, string>;
        expect(scripts['build']).toBeDefined();
    });

    it('has correct license', () => {
        expect(pkg['license']).toBe('Apache-2.0');
    });
});
