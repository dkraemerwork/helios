/**
 * Block 7.8 — Package structure verification tests.
 *
 * These tests verify that the public API barrel (src/index.ts) exports
 * all key Helios public classes and interfaces, and that package.json
 * is correctly configured for distribution.
 */

import { describe, expect, it } from 'bun:test';

// ── 1. Barrel imports ───────────────────────────────────────────────────────
//
// All imports come through the barrel.  If the barrel is missing or a named
// export has been forgotten, every `expect(X).toBeDefined()` assertion below
// will fail — keeping the RED gate strict.

import * as HeliosBarrel from '@zenystx/helios-core/index';

// ── 2. Package metadata ─────────────────────────────────────────────────────

import pkg from '../../package.json';

describe('Block 7.8 — barrel exports', () => {

    it('barrel module is importable', () => {
        expect(HeliosBarrel).toBeDefined();
    });

    // ── Factory ──────────────────────────────────────────────────────────────

    it('exports Helios factory', () => {
        expect(HeliosBarrel.Helios).toBeDefined();
        expect(typeof HeliosBarrel.Helios.newInstance).toBe('function');
        expect(typeof HeliosBarrel.Helios.shutdownAll).toBe('function');
    });

    // ── Config ───────────────────────────────────────────────────────────────

    it('exports HeliosConfig', () => {
        const cfg = new HeliosBarrel.HeliosConfig();
        expect(cfg).toBeDefined();
        expect(typeof cfg.getName).toBe('function');
    });

    it('exports MapConfig', () => {
        expect(HeliosBarrel.MapConfig).toBeDefined();
    });

    it('exports NearCacheConfig', () => {
        expect(HeliosBarrel.NearCacheConfig).toBeDefined();
    });

    it('exports EvictionConfig', () => {
        expect(HeliosBarrel.EvictionConfig).toBeDefined();
    });

    it('exports EvictionPolicy', () => {
        expect(HeliosBarrel.EvictionPolicy).toBeDefined();
    });

    it('exports NetworkConfig', () => {
        expect(HeliosBarrel.NetworkConfig).toBeDefined();
    });

    it('exports RingbufferConfig', () => {
        expect(HeliosBarrel.RingbufferConfig).toBeDefined();
    });

    // ── Core / Instance ───────────────────────────────────────────────────────

    it('exports HeliosInstanceImpl', () => {
        expect(HeliosBarrel.HeliosInstanceImpl).toBeDefined();
    });

    // ── Map ──────────────────────────────────────────────────────────────────

    it('exports MapProxy', () => {
        expect(HeliosBarrel.MapProxy).toBeDefined();
    });

    it('exports QueryResultSizeExceededException', () => {
        expect(HeliosBarrel.QueryResultSizeExceededException).toBeDefined();
    });

    // ── Collections ──────────────────────────────────────────────────────────

    it('exports QueueImpl', () => {
        expect(HeliosBarrel.QueueImpl).toBeDefined();
    });

    it('exports SetImpl', () => {
        expect(HeliosBarrel.SetImpl).toBeDefined();
    });

    it('exports ListImpl', () => {
        expect(HeliosBarrel.ListImpl).toBeDefined();
    });

    // ── Topic ────────────────────────────────────────────────────────────────

    it('exports TopicImpl', () => {
        expect(HeliosBarrel.TopicImpl).toBeDefined();
    });

    // ── MultiMap ─────────────────────────────────────────────────────────────

    it('exports MultiMapImpl', () => {
        expect(HeliosBarrel.MultiMapImpl).toBeDefined();
    });

    // ── ReplicatedMap ─────────────────────────────────────────────────────────

    it('exports ReplicatedMapImpl', () => {
        expect(HeliosBarrel.ReplicatedMapImpl).toBeDefined();
    });

    // ── Ringbuffer ────────────────────────────────────────────────────────────

    it('exports ArrayRingbuffer', () => {
        expect(HeliosBarrel.ArrayRingbuffer).toBeDefined();
    });

    it('exports OverflowPolicy', () => {
        expect(HeliosBarrel.OverflowPolicy).toBeDefined();
    });

    // ── Cache ────────────────────────────────────────────────────────────────

    it('exports CacheRecordStore', () => {
        expect(HeliosBarrel.CacheRecordStore).toBeDefined();
    });

    // ── Transaction ──────────────────────────────────────────────────────────

    it('exports TransactionOptions', () => {
        expect(HeliosBarrel.TransactionOptions).toBeDefined();
    });

    it('exports TransactionException', () => {
        expect(HeliosBarrel.TransactionException).toBeDefined();
    });

    // ── Cluster ──────────────────────────────────────────────────────────────

    it('exports Address', () => {
        expect(HeliosBarrel.Address).toBeDefined();
    });

    it('exports MemberImpl', () => {
        expect(HeliosBarrel.MemberImpl).toBeDefined();
    });

    // ── Security ─────────────────────────────────────────────────────────────

    it('exports UsernamePasswordCredentials', () => {
        const cred = new HeliosBarrel.UsernamePasswordCredentials('u', 'p');
        expect(cred.getName()).toBe('u');
    });

    it('exports SimpleTokenCredentials', () => {
        const token = Buffer.from('tok');
        const cred = new HeliosBarrel.SimpleTokenCredentials(token);
        expect(cred.getToken()).toEqual(token);
    });

    // ── Server / CLI ──────────────────────────────────────────────────────────

    it('exports HeliosServer', () => {
        expect(HeliosBarrel.HeliosServer).toBeDefined();
    });

    // ── Instance / lifecycle ──────────────────────────────────────────────────

    it('exports BuildInfo', () => {
        expect(HeliosBarrel.BuildInfo).toBeDefined();
    });

    it('exports HeliosLifecycleService', () => {
        expect(HeliosBarrel.HeliosLifecycleService).toBeDefined();
    });
});

describe('Block 7.8 — package.json distribution config', () => {

    it('is not private (distributable)', () => {
        expect((pkg as Record<string, unknown>).private).not.toBe(true);
    });

    it('has main entrypoint', () => {
        expect((pkg as Record<string, unknown>).main).toBeDefined();
    });

    it('has types field', () => {
        expect((pkg as Record<string, unknown>).types).toBeDefined();
    });

    it('has exports field mapping . to index', () => {
        const exports = (pkg as Record<string, unknown>).exports as Record<string, unknown> | undefined;
        expect(exports).toBeDefined();
        expect(exports!['.']).toBeDefined();
    });

    it('has build script', () => {
        const scripts = (pkg as Record<string, unknown>).scripts as Record<string, string> | undefined;
        expect(scripts?.build).toBeDefined();
    });

    it('has a version', () => {
        const version = (pkg as Record<string, unknown>).version as string;
        expect(version).toBeDefined();
        expect(version).not.toBe('');
    });

    it('has a name', () => {
        expect((pkg as Record<string, unknown>).name).toBe('@zenystx/helios-core');
    });
});
