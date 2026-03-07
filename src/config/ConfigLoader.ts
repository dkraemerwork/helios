/**
 * Loads a HeliosConfig from a JSON or YAML file.
 *
 * Supported formats:
 *   - .json  — JSON object
 *   - .yml / .yaml — YAML document
 *
 * File schema:
 * ```yaml
 * name: my-cluster          # optional, defaults to 'helios'
 * maps:                     # optional list of MapConfig entries
 *   - name: orders
 *     ttlSeconds: 300
 *     backupCount: 2
 * ```
 */
import type { HeliosBlitzRuntimeConfig } from '@zenystx/helios-core/config/BlitzRuntimeConfig';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import { TopicConfig } from '@zenystx/helios-core/config/TopicConfig';
import { ReliableTopicConfig, TopicOverloadPolicy } from '@zenystx/helios-core/config/ReliableTopicConfig';
import { RingbufferConfig } from '@zenystx/helios-core/config/RingbufferConfig';
import { RestEndpointGroup } from '@zenystx/helios-core/rest/RestEndpointGroup';

/**
 * Loads and parses a config file, returning a HeliosConfig.
 * @throws Error if the file is not found, has an unsupported extension, or fails validation.
 */
export async function loadConfig(filePath: string): Promise<HeliosConfig> {
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) {
        throw new Error(`Config file not found: ${filePath}`);
    }

    const content = await file.text();
    let raw: unknown;

    if (filePath.endsWith('.json')) {
        try {
            raw = JSON.parse(content);
        } catch (e) {
            throw new Error(`Failed to parse JSON config file "${filePath}": ${String(e)}`);
        }
    } else if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) {
        try {
            raw = Bun.YAML.parse(content);
        } catch (e) {
            throw new Error(`Failed to parse YAML config file "${filePath}": ${String(e)}`);
        }
    } else {
        const ext = filePath.includes('.') ? filePath.slice(filePath.lastIndexOf('.')) : '(no extension)';
        throw new Error(`Unsupported config file format: "${ext}". Use .json or .yml/.yaml`);
    }

    return parseRawConfig(raw, filePath);
}

/**
 * Parses a raw (deserialized) config object into a HeliosConfig.
 * @param raw The raw deserialized config object.
 * @param configOrigin Optional file path origin for relative specifier resolution.
 * @throws Error with a descriptive message if validation fails.
 */
export function parseRawConfig(raw: unknown, configOrigin?: string): HeliosConfig {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('Config must be an object');
    }

    const obj = raw as Record<string, unknown>;

    // --- instance name ---
    const name: string = (typeof obj['name'] === 'string') ? obj['name'] : 'helios';
    if (name.trim() === '') {
        throw new Error('Instance name must not be empty');
    }

    const config = new HeliosConfig(name);

    // --- config origin (file path for relative specifier resolution) ---
    if (configOrigin !== undefined) {
        config.setConfigOrigin(configOrigin);
    }

    // --- rest-api config ---
    if ('rest-api' in obj && obj['rest-api'] !== null && typeof obj['rest-api'] === 'object') {
        const restRaw = obj['rest-api'] as Record<string, unknown>;
        const restCfg = config.getNetworkConfig().getRestApiConfig();

        if (typeof restRaw['enabled'] === 'boolean') {
            restCfg.setEnabled(restRaw['enabled'] as boolean);
        }
        if (typeof restRaw['port'] === 'number') {
            restCfg.setPort(restRaw['port'] as number);
        }
        if (typeof restRaw['request-timeout-ms'] === 'number') {
            restCfg.setRequestTimeoutMs(restRaw['request-timeout-ms'] as number);
        }
        if (Array.isArray(restRaw['enabled-groups'])) {
            restCfg.disableAllGroups();
            const validGroups = new Set(Object.values(RestEndpointGroup));
            for (const g of restRaw['enabled-groups'] as unknown[]) {
                if (typeof g === 'string' && validGroups.has(g as RestEndpointGroup)) {
                    restCfg.enableGroups(g as RestEndpointGroup);
                }
            }
        }
    }

    // --- blitz config ---
    if ('blitz' in obj && obj['blitz'] !== null && typeof obj['blitz'] === 'object') {
        config.setBlitzConfig(obj['blitz'] as HeliosBlitzRuntimeConfig);
    }

    // --- map configs ---
    if ('maps' in obj && obj['maps'] !== undefined) {
        if (!Array.isArray(obj['maps'])) {
            throw new Error('"maps" must be an array');
        }
        for (const entry of obj['maps'] as unknown[]) {
            config.addMapConfig(parseMapConfig(entry));
        }
    }

    // --- topic configs ---
    if ('topics' in obj && obj['topics'] !== undefined) {
        if (!Array.isArray(obj['topics'])) {
            throw new Error('"topics" must be an array');
        }
        for (const entry of obj['topics'] as unknown[]) {
            config.addTopicConfig(parseTopicConfig(entry));
        }
    }

    // --- reliable-topic configs ---
    if ('reliable-topics' in obj && obj['reliable-topics'] !== undefined) {
        if (!Array.isArray(obj['reliable-topics'])) {
            throw new Error('"reliable-topics" must be an array');
        }
        for (const entry of obj['reliable-topics'] as unknown[]) {
            config.addReliableTopicConfig(parseReliableTopicConfig(entry));
        }
    }

    // --- ringbuffer configs ---
    if ('ringbuffers' in obj && obj['ringbuffers'] !== undefined) {
        if (!Array.isArray(obj['ringbuffers'])) {
            throw new Error('"ringbuffers" must be an array');
        }
        for (const entry of obj['ringbuffers'] as unknown[]) {
            config.addRingbufferConfig(parseRingbufferConfig(entry));
        }
    }

    return config;
}

function parseTopicConfig(entry: unknown): TopicConfig {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new Error('Each topic entry must be an object');
    }
    const e = entry as Record<string, unknown>;
    if (typeof e['name'] !== 'string' || (e['name'] as string).trim() === '') {
        throw new Error('Each topic config entry must have a non-empty "name" field');
    }
    const tc = new TopicConfig(e['name'] as string);
    if (typeof e['globalOrderingEnabled'] === 'boolean') {
        tc.setGlobalOrderingEnabled(e['globalOrderingEnabled'] as boolean);
    }
    if (typeof e['statisticsEnabled'] === 'boolean') {
        tc.setStatisticsEnabled(e['statisticsEnabled'] as boolean);
    }
    if (typeof e['multiThreadingEnabled'] === 'boolean') {
        tc.setMultiThreadingEnabled(e['multiThreadingEnabled'] as boolean);
    }
    return tc;
}

function parseReliableTopicConfig(entry: unknown): ReliableTopicConfig {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new Error('Each reliable-topic entry must be an object');
    }
    const e = entry as Record<string, unknown>;
    if (typeof e['name'] !== 'string' || (e['name'] as string).trim() === '') {
        throw new Error('Each reliable-topic config entry must have a non-empty "name" field');
    }
    const rtc = new ReliableTopicConfig(e['name'] as string);
    if (typeof e['readBatchSize'] === 'number') {
        rtc.setReadBatchSize(e['readBatchSize'] as number);
    }
    if (typeof e['topicOverloadPolicy'] === 'string') {
        const policyStr = e['topicOverloadPolicy'] as string;
        const policy = TopicOverloadPolicy[policyStr as keyof typeof TopicOverloadPolicy];
        if (policy === undefined) {
            throw new Error(`Invalid topicOverloadPolicy: "${policyStr}". Valid values: ${Object.keys(TopicOverloadPolicy).join(', ')}`);
        }
        rtc.setTopicOverloadPolicy(policy);
    }
    if (typeof e['statisticsEnabled'] === 'boolean') {
        rtc.setStatisticsEnabled(e['statisticsEnabled'] as boolean);
    }
    return rtc;
}

function parseRingbufferConfig(entry: unknown): RingbufferConfig {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new Error('Each ringbuffer entry must be an object');
    }
    const e = entry as Record<string, unknown>;
    if (typeof e['name'] !== 'string' || (e['name'] as string).trim() === '') {
        throw new Error('Each ringbuffer config entry must have a non-empty "name" field');
    }
    const rbc = new RingbufferConfig(e['name'] as string);
    if (typeof e['capacity'] === 'number') {
        rbc.setCapacity(e['capacity'] as number);
    }
    if (typeof e['backupCount'] === 'number') {
        rbc.setBackupCount(e['backupCount'] as number);
    }
    if (typeof e['asyncBackupCount'] === 'number') {
        rbc.setAsyncBackupCount(e['asyncBackupCount'] as number);
    }
    if (typeof e['timeToLiveSeconds'] === 'number') {
        rbc.setTimeToLiveSeconds(e['timeToLiveSeconds'] as number);
    }
    return rbc;
}

function parseMapConfig(entry: unknown): MapConfig {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new Error('Each map entry must be an object');
    }

    const e = entry as Record<string, unknown>;

    if (typeof e['name'] !== 'string' || (e['name'] as string).trim() === '') {
        throw new Error('Each map config entry must have a non-empty "name" field');
    }

    const mc = new MapConfig(e['name'] as string);

    if (typeof e['ttlSeconds'] === 'number') {
        mc.setTimeToLiveSeconds(e['ttlSeconds'] as number);
    }
    if (typeof e['backupCount'] === 'number') {
        mc.setBackupCount(e['backupCount'] as number);
    }
    if (typeof e['asyncBackupCount'] === 'number') {
        mc.setAsyncBackupCount(e['asyncBackupCount'] as number);
    }
    if (typeof e['maxIdleSeconds'] === 'number') {
        mc.setMaxIdleSeconds(e['maxIdleSeconds'] as number);
    }
    if (typeof e['statisticsEnabled'] === 'boolean') {
        mc.setStatisticsEnabled(e['statisticsEnabled'] as boolean);
    }
    if (typeof e['readBackupData'] === 'boolean') {
        mc.setReadBackupData(e['readBackupData'] as boolean);
    }

    return mc;
}
