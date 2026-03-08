import { parseRawConfig } from '@zenystx/helios-core/config/ConfigLoader';
import { RestApiConfig } from '@zenystx/helios-core/config/RestApiConfig';
import { RestEndpointGroup } from '@zenystx/helios-core/rest/RestEndpointGroup';
import { describe, expect, it } from 'bun:test';

// ─── RestEndpointGroup ────────────────────────────────────────────────────────

describe('RestEndpointGroup', () => {
    it('has exactly 5 groups', () => {
        const values = Object.values(RestEndpointGroup);
        expect(values.length).toBe(5);
    });

    it('contains HEALTH_CHECK, CLUSTER_READ, CLUSTER_WRITE, DATA, MONITOR', () => {
        expect(Object.values(RestEndpointGroup)).toContain(RestEndpointGroup.HEALTH_CHECK);
        expect(Object.values(RestEndpointGroup)).toContain(RestEndpointGroup.CLUSTER_READ);
        expect(Object.values(RestEndpointGroup)).toContain(RestEndpointGroup.CLUSTER_WRITE);
        expect(Object.values(RestEndpointGroup)).toContain(RestEndpointGroup.DATA);
        expect(Object.values(RestEndpointGroup)).toContain(RestEndpointGroup.MONITOR);
    });
});

// ─── RestApiConfig defaults ───────────────────────────────────────────────────

describe('RestApiConfig — defaults', () => {
    it('is disabled by default', () => {
        const cfg = new RestApiConfig();
        expect(cfg.isEnabled()).toBe(false);
    });

    it('default port is 8080', () => {
        const cfg = new RestApiConfig();
        expect(cfg.getPort()).toBe(8080);
    });

    it('default requestTimeoutMs is 120_000', () => {
        const cfg = new RestApiConfig();
        expect(cfg.getRequestTimeoutMs()).toBe(120_000);
    });

    it('default enabled groups are HEALTH_CHECK and CLUSTER_READ', () => {
        const cfg = new RestApiConfig();
        const groups = cfg.getEnabledGroups();
        expect(groups.has(RestEndpointGroup.HEALTH_CHECK)).toBe(true);
        expect(groups.has(RestEndpointGroup.CLUSTER_READ)).toBe(true);
        expect(groups.has(RestEndpointGroup.CLUSTER_WRITE)).toBe(false);
        expect(groups.has(RestEndpointGroup.DATA)).toBe(false);
    });
});

// ─── RestApiConfig fluent API ─────────────────────────────────────────────────

describe('RestApiConfig — fluent API', () => {
    it('setEnabled returns this', () => {
        const cfg = new RestApiConfig();
        expect(cfg.setEnabled(true)).toBe(cfg);
    });

    it('setPort returns this and stores port', () => {
        const cfg = new RestApiConfig();
        expect(cfg.setPort(9090)).toBe(cfg);
        expect(cfg.getPort()).toBe(9090);
    });

    it('setRequestTimeoutMs stores value', () => {
        const cfg = new RestApiConfig();
        cfg.setRequestTimeoutMs(30_000);
        expect(cfg.getRequestTimeoutMs()).toBe(30_000);
    });

    it('enableGroups adds groups', () => {
        const cfg = new RestApiConfig();
        cfg.disableAllGroups().enableGroups(RestEndpointGroup.DATA);
        expect(cfg.getEnabledGroups().has(RestEndpointGroup.DATA)).toBe(true);
        expect(cfg.getEnabledGroups().has(RestEndpointGroup.HEALTH_CHECK)).toBe(false);
    });

    it('disableGroups removes groups', () => {
        const cfg = new RestApiConfig();
        cfg.disableGroups(RestEndpointGroup.HEALTH_CHECK);
        expect(cfg.isGroupEnabled(RestEndpointGroup.HEALTH_CHECK)).toBe(false);
        expect(cfg.isGroupEnabled(RestEndpointGroup.CLUSTER_READ)).toBe(true);
    });

    it('enableAllGroups enables all 4 groups', () => {
        const cfg = new RestApiConfig();
        cfg.disableAllGroups().enableAllGroups();
        for (const g of Object.values(RestEndpointGroup)) {
            expect(cfg.isGroupEnabled(g)).toBe(true);
        }
    });

    it('disableAllGroups removes all groups', () => {
        const cfg = new RestApiConfig();
        cfg.disableAllGroups();
        expect(cfg.getEnabledGroups().size).toBe(0);
    });

    it('isEnabledAndNotEmpty is false when disabled even with groups', () => {
        const cfg = new RestApiConfig();
        // isEnabled() = false by default, but has groups
        expect(cfg.isEnabledAndNotEmpty()).toBe(false);
    });

    it('isEnabledAndNotEmpty is false when enabled but no groups', () => {
        const cfg = new RestApiConfig();
        cfg.setEnabled(true).disableAllGroups();
        expect(cfg.isEnabledAndNotEmpty()).toBe(false);
    });

    it('isEnabledAndNotEmpty is true when enabled and has at least one group', () => {
        const cfg = new RestApiConfig();
        cfg.setEnabled(true); // default groups: HEALTH_CHECK + CLUSTER_READ
        expect(cfg.isEnabledAndNotEmpty()).toBe(true);
    });

    it('isGroupEnabled returns correct value', () => {
        const cfg = new RestApiConfig();
        expect(cfg.isGroupEnabled(RestEndpointGroup.HEALTH_CHECK)).toBe(true);
        expect(cfg.isGroupEnabled(RestEndpointGroup.DATA)).toBe(false);
    });
});

// ─── ConfigLoader — rest-api section ─────────────────────────────────────────

describe('ConfigLoader — rest-api section', () => {
    it('parses rest-api.enabled=true and sets enabled', () => {
        const raw = { 'rest-api': { enabled: true } };
        const config = parseRawConfig(raw);
        expect(config.getNetworkConfig().getRestApiConfig().isEnabled()).toBe(true);
    });

    it('parses rest-api.port', () => {
        const raw = { 'rest-api': { enabled: true, port: 9000 } };
        const config = parseRawConfig(raw);
        expect(config.getNetworkConfig().getRestApiConfig().getPort()).toBe(9000);
    });

    it('parses rest-api.enabled-groups array', () => {
        const raw = {
            'rest-api': {
                enabled: true,
                'enabled-groups': ['HEALTH_CHECK', 'DATA'],
            },
        };
        const config = parseRawConfig(raw);
        const restCfg = config.getNetworkConfig().getRestApiConfig();
        expect(restCfg.isGroupEnabled(RestEndpointGroup.HEALTH_CHECK)).toBe(true);
        expect(restCfg.isGroupEnabled(RestEndpointGroup.DATA)).toBe(true);
        expect(restCfg.isGroupEnabled(RestEndpointGroup.CLUSTER_READ)).toBe(false);
        expect(restCfg.isGroupEnabled(RestEndpointGroup.CLUSTER_WRITE)).toBe(false);
    });

    it('unknown group name in enabled-groups is ignored', () => {
        const raw = {
            'rest-api': {
                enabled: true,
                'enabled-groups': ['HEALTH_CHECK', 'NONEXISTENT'],
            },
        };
        // Should not throw, unknown group is simply ignored
        const config = parseRawConfig(raw);
        const restCfg = config.getNetworkConfig().getRestApiConfig();
        expect(restCfg.isGroupEnabled(RestEndpointGroup.HEALTH_CHECK)).toBe(true);
    });

    it('parses rest-api.request-timeout-ms', () => {
        const raw = {
            'rest-api': { enabled: true, 'request-timeout-ms': 30_000 },
        };
        const config = parseRawConfig(raw);
        expect(config.getNetworkConfig().getRestApiConfig().getRequestTimeoutMs()).toBe(30_000);
    });

    it('missing rest-api section leaves defaults intact', () => {
        const raw = { name: 'test' };
        const config = parseRawConfig(raw);
        const restCfg = config.getNetworkConfig().getRestApiConfig();
        expect(restCfg.isEnabled()).toBe(false);
        expect(restCfg.getPort()).toBe(8080);
    });
});
