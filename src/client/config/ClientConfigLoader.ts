/**
 * Loads a ClientConfig from a JSON or YAML file.
 *
 * Supported formats: .json, .yml, .yaml
 *
 * Fails fast on unsupported config sections instead of silently accepting them.
 */
import { ClientConfig } from '@zenystx/helios-core/client/config/ClientConfig';
import type { ReconnectMode } from '@zenystx/helios-core/client/config/ClientConnectionStrategyConfig';

const SUPPORTED_TOP_LEVEL_KEYS = new Set([
    'instance-name',
    'cluster-name',
    'network',
    'connection-strategy',
    'security',
    'serialization',
    'near-caches',
    'properties',
]);

const SUPPORTED_NETWORK_KEYS = new Set([
    'cluster-members',
    'connection-timeout',
    'redo-operation',
]);

const SUPPORTED_CONNECTION_STRATEGY_KEYS = new Set([
    'async-start',
    'reconnect-mode',
    'connection-retry',
]);

const SUPPORTED_CONNECTION_RETRY_KEYS = new Set([
    'initial-backoff-millis',
    'max-backoff-millis',
    'multiplier',
    'cluster-connect-timeout-millis',
    'jitter',
]);

const SUPPORTED_SECURITY_KEYS = new Set([
    'username',
    'password',
]);

export async function loadClientConfig(filePath: string): Promise<ClientConfig> {
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) {
        throw new Error(`Client config file not found: ${filePath}`);
    }

    const content = await file.text();
    let raw: unknown;

    if (filePath.endsWith('.json')) {
        raw = JSON.parse(content);
    } else if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) {
        raw = Bun.YAML.parse(content);
    } else {
        throw new Error(`Unsupported client config file format. Use .json or .yml/.yaml`);
    }

    return parseRawClientConfig(raw);
}

export function parseRawClientConfig(raw: unknown): ClientConfig {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('Client config must be an object');
    }

    const obj = raw as Record<string, unknown>;

    // Fail fast on unsupported top-level keys
    for (const key of Object.keys(obj)) {
        if (!SUPPORTED_TOP_LEVEL_KEYS.has(key)) {
            throw new Error(`Unsupported client config section: "${key}". Supported sections: ${[...SUPPORTED_TOP_LEVEL_KEYS].join(', ')}`);
        }
    }

    const config = new ClientConfig();

    // instance-name
    if (typeof obj['instance-name'] === 'string') {
        config.setName(obj['instance-name']);
    }

    // cluster-name
    if (typeof obj['cluster-name'] === 'string') {
        config.setClusterName(obj['cluster-name']);
    }

    // network
    if (obj['network'] !== undefined && obj['network'] !== null) {
        if (typeof obj['network'] !== 'object' || Array.isArray(obj['network'])) {
            throw new Error('"network" must be an object');
        }
        const netObj = obj['network'] as Record<string, unknown>;

        for (const key of Object.keys(netObj)) {
            if (!SUPPORTED_NETWORK_KEYS.has(key)) {
                throw new Error(`Unsupported client network config section: "${key}". Supported: ${[...SUPPORTED_NETWORK_KEYS].join(', ')}`);
            }
        }

        const net = config.getNetworkConfig();
        if (Array.isArray(netObj['cluster-members'])) {
            for (const addr of netObj['cluster-members']) {
                if (typeof addr === 'string') {
                    net.addAddress(addr);
                }
            }
        }
        if (typeof netObj['connection-timeout'] === 'number') {
            net.setConnectionTimeout(netObj['connection-timeout']);
        }
        if (typeof netObj['redo-operation'] === 'boolean') {
            net.setRedoOperation(netObj['redo-operation']);
        }
    }

    // connection-strategy
    if (obj['connection-strategy'] !== undefined && obj['connection-strategy'] !== null) {
        if (typeof obj['connection-strategy'] !== 'object' || Array.isArray(obj['connection-strategy'])) {
            throw new Error('"connection-strategy" must be an object');
        }
        const csObj = obj['connection-strategy'] as Record<string, unknown>;

        for (const key of Object.keys(csObj)) {
            if (!SUPPORTED_CONNECTION_STRATEGY_KEYS.has(key)) {
                throw new Error(`Unsupported connection-strategy config key: "${key}"`);
            }
        }

        const cs = config.getConnectionStrategyConfig();
        if (typeof csObj['async-start'] === 'boolean') {
            cs.setAsyncStart(csObj['async-start']);
        }
        if (typeof csObj['reconnect-mode'] === 'string') {
            const mode = csObj['reconnect-mode'] as string;
            if (mode !== 'OFF' && mode !== 'ON' && mode !== 'ASYNC') {
                throw new Error(`Invalid reconnect-mode: "${mode}". Valid: OFF, ON, ASYNC`);
            }
            cs.setReconnectMode(mode as ReconnectMode);
        }
        if (csObj['connection-retry'] !== undefined && csObj['connection-retry'] !== null) {
            if (typeof csObj['connection-retry'] !== 'object' || Array.isArray(csObj['connection-retry'])) {
                throw new Error('"connection-retry" must be an object');
            }
            const retryObj = csObj['connection-retry'] as Record<string, unknown>;

            for (const key of Object.keys(retryObj)) {
                if (!SUPPORTED_CONNECTION_RETRY_KEYS.has(key)) {
                    throw new Error(`Unsupported connection-retry config key: "${key}"`);
                }
            }

            const retry = cs.getConnectionRetryConfig();
            if (typeof retryObj['initial-backoff-millis'] === 'number') {
                retry.setInitialBackoffMillis(retryObj['initial-backoff-millis']);
            }
            if (typeof retryObj['max-backoff-millis'] === 'number') {
                retry.setMaxBackoffMillis(retryObj['max-backoff-millis']);
            }
            if (typeof retryObj['multiplier'] === 'number') {
                retry.setMultiplier(retryObj['multiplier']);
            }
            if (typeof retryObj['cluster-connect-timeout-millis'] === 'number') {
                retry.setClusterConnectTimeoutMillis(retryObj['cluster-connect-timeout-millis']);
            }
            if (typeof retryObj['jitter'] === 'number') {
                retry.setJitter(retryObj['jitter']);
            }
        }
    }

    // security
    if (obj['security'] !== undefined && obj['security'] !== null) {
        if (typeof obj['security'] !== 'object' || Array.isArray(obj['security'])) {
            throw new Error('"security" must be an object');
        }
        const secObj = obj['security'] as Record<string, unknown>;
        for (const key of Object.keys(secObj)) {
            if (!SUPPORTED_SECURITY_KEYS.has(key)) {
                throw new Error(`Unsupported security config key: "${key}"`);
            }
        }
        if (typeof secObj['username'] === 'string' && typeof secObj['password'] === 'string') {
            config.getSecurityConfig().setUsernamePasswordIdentity(secObj['username'], secObj['password']);
        }
    }

    return config;
}
