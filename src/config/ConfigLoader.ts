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
import { InitialLoadMode, MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import { ReliableTopicConfig, TopicOverloadPolicy } from '@zenystx/helios-core/config/ReliableTopicConfig';
import { RingbufferConfig } from '@zenystx/helios-core/config/RingbufferConfig';
import { TopicConfig } from '@zenystx/helios-core/config/TopicConfig';
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

    // --- network / join config ---
    if ('network' in obj && obj['network'] !== null && typeof obj['network'] === 'object') {
        parseNetworkConfig(obj['network'] as Record<string, unknown>, config);
    }

    // --- backpressure config ---
    if ('backpressure' in obj && obj['backpressure'] !== null && typeof obj['backpressure'] === 'object') {
        parseBackpressureConfig(obj['backpressure'] as Record<string, unknown>, config);
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

    // --- map-store config ---
    if ('map-store' in e && e['map-store'] !== null && typeof e['map-store'] === 'object') {
        const ms = e['map-store'] as Record<string, unknown>;
        const msc = new MapStoreConfig();

        if (typeof ms['enabled'] === 'boolean') msc.setEnabled(ms['enabled']);
        if (typeof ms['className'] === 'string') msc.setClassName(ms['className']);
        if (typeof ms['factoryClassName'] === 'string') msc.setFactoryClassName(ms['factoryClassName']);
        if (typeof ms['writeDelaySeconds'] === 'number') msc.setWriteDelaySeconds(ms['writeDelaySeconds']);
        if (typeof ms['writeBatchSize'] === 'number') msc.setWriteBatchSize(ms['writeBatchSize']);
        if (typeof ms['writeCoalescing'] === 'boolean') msc.setWriteCoalescing(ms['writeCoalescing']);
        if (typeof ms['offload'] === 'boolean') msc.setOffload(ms['offload']);
        if (typeof ms['initialLoadMode'] === 'string') {
            const mode = InitialLoadMode[ms['initialLoadMode'] as keyof typeof InitialLoadMode];
            if (mode === undefined) {
                throw new Error(`Invalid initialLoadMode: "${ms['initialLoadMode']}". Valid values: ${Object.keys(InitialLoadMode).join(', ')}`);
            }
            msc.setInitialLoadMode(mode);
        }
        if (typeof ms['loadAllKeys'] === 'boolean') msc.setLoadAllKeys(ms['loadAllKeys']);

        if (typeof ms['properties'] === 'object' && ms['properties'] !== null && !Array.isArray(ms['properties'])) {
            for (const [pk, pv] of Object.entries(ms['properties'] as Record<string, unknown>)) {
                msc.setProperty(pk, String(pv));
            }
        }

        mc.setMapStoreConfig(msc);
    }

    return mc;
}

// ── Network / Join config parsing ─────────────────────────────────────────

function parseNetworkConfig(raw: Record<string, unknown>, config: HeliosConfig): void {
    const networkConfig = config.getNetworkConfig();

    if (typeof raw['port'] === 'number') {
        networkConfig.setPort(raw['port'] as number);
    }

    if ('join' in raw && raw['join'] !== null && typeof raw['join'] === 'object') {
        parseJoinConfig(raw['join'] as Record<string, unknown>, config);
    }

    if ('tcp-scatter' in raw && raw['tcp-scatter'] !== null && typeof raw['tcp-scatter'] === 'object') {
        parseTcpScatterConfig(raw['tcp-scatter'] as Record<string, unknown>, config);
    }
    if ('tcpScatter' in raw && raw['tcpScatter'] !== null && typeof raw['tcpScatter'] === 'object') {
        parseTcpScatterConfig(raw['tcpScatter'] as Record<string, unknown>, config);
    }
}

function parseTcpScatterConfig(raw: Record<string, unknown>, config: HeliosConfig): void {
    const scatterConfig = config.getNetworkConfig().getTcpTransportScatterConfig();

    if (typeof raw['enabled'] === 'boolean') {
        scatterConfig.setEnabled(raw['enabled'] as boolean);
    }
    if (typeof raw['input-capacity-bytes'] === 'number') {
        scatterConfig.setInputCapacityBytes(raw['input-capacity-bytes'] as number);
    }
    if (typeof raw['inputCapacityBytes'] === 'number') {
        scatterConfig.setInputCapacityBytes(raw['inputCapacityBytes'] as number);
    }
    if (typeof raw['output-capacity-bytes'] === 'number') {
        scatterConfig.setOutputCapacityBytes(raw['output-capacity-bytes'] as number);
    }
    if (typeof raw['outputCapacityBytes'] === 'number') {
        scatterConfig.setOutputCapacityBytes(raw['outputCapacityBytes'] as number);
    }
}

function parseJoinConfig(raw: Record<string, unknown>, config: HeliosConfig): void {
    const joinConfig = config.getNetworkConfig().getJoin();

    // --- multicast ---
    if ('multicast' in raw && raw['multicast'] !== null && typeof raw['multicast'] === 'object') {
        const mc = raw['multicast'] as Record<string, unknown>;
        const multicastConfig = joinConfig.getMulticastConfig();

        if (typeof mc['enabled'] === 'boolean') {
            multicastConfig.setEnabled(mc['enabled'] as boolean);
        }
        if (typeof mc['multicast-group'] === 'string') {
            multicastConfig.setMulticastGroup(mc['multicast-group'] as string);
        }
        if (typeof mc['multicastGroup'] === 'string') {
            multicastConfig.setMulticastGroup(mc['multicastGroup'] as string);
        }
        if (typeof mc['multicast-port'] === 'number') {
            multicastConfig.setMulticastPort(mc['multicast-port'] as number);
        }
        if (typeof mc['multicastPort'] === 'number') {
            multicastConfig.setMulticastPort(mc['multicastPort'] as number);
        }
        if (typeof mc['multicast-timeout-seconds'] === 'number') {
            multicastConfig.setMulticastTimeoutSeconds(mc['multicast-timeout-seconds'] as number);
        }
        if (typeof mc['multicastTimeoutSeconds'] === 'number') {
            multicastConfig.setMulticastTimeoutSeconds(mc['multicastTimeoutSeconds'] as number);
        }
        if (typeof mc['multicast-time-to-live'] === 'number') {
            multicastConfig.setMulticastTimeToLive(mc['multicast-time-to-live'] as number);
        }
        if (typeof mc['multicastTimeToLive'] === 'number') {
            multicastConfig.setMulticastTimeToLive(mc['multicastTimeToLive'] as number);
        }
        if (typeof mc['loopback-mode-enabled'] === 'boolean') {
            multicastConfig.setLoopbackModeEnabled(mc['loopback-mode-enabled'] as boolean);
        }
        if (typeof mc['loopbackModeEnabled'] === 'boolean') {
            multicastConfig.setLoopbackModeEnabled(mc['loopbackModeEnabled'] as boolean);
        }
        if (Array.isArray(mc['trusted-interfaces'])) {
            const ifaces = new Set<string>();
            for (const iface of mc['trusted-interfaces'] as unknown[]) {
                if (typeof iface === 'string') ifaces.add(iface);
            }
            multicastConfig.setTrustedInterfaces(ifaces);
        }
        if (Array.isArray(mc['trustedInterfaces'])) {
            const ifaces = new Set<string>();
            for (const iface of mc['trustedInterfaces'] as unknown[]) {
                if (typeof iface === 'string') ifaces.add(iface);
            }
            multicastConfig.setTrustedInterfaces(ifaces);
        }
    }

    // --- tcp-ip ---
    if ('tcp-ip' in raw && raw['tcp-ip'] !== null && typeof raw['tcp-ip'] === 'object') {
        const tc = raw['tcp-ip'] as Record<string, unknown>;
        const tcpIpConfig = joinConfig.getTcpIpConfig();

        if (typeof tc['enabled'] === 'boolean') {
            tcpIpConfig.setEnabled(tc['enabled'] as boolean);
        }
        if (Array.isArray(tc['members'])) {
            for (const member of tc['members'] as unknown[]) {
                if (typeof member === 'string') {
                    tcpIpConfig.addMember(member);
                }
            }
        }
    }
}

// ── Backpressure config parsing ───────────────────────────────────────────

function parseBackpressureConfig(raw: Record<string, unknown>, config: HeliosConfig): void {
    const bpConfig = config.getBackpressureConfig();

    if (typeof raw['enabled'] === 'boolean') {
        bpConfig.setEnabled(raw['enabled'] as boolean);
    }
    if (typeof raw['max-concurrent-invocations-per-partition'] === 'number') {
        bpConfig.setMaxConcurrentInvocationsPerPartition(
            raw['max-concurrent-invocations-per-partition'] as number,
        );
    }
    if (typeof raw['maxConcurrentInvocationsPerPartition'] === 'number') {
        bpConfig.setMaxConcurrentInvocationsPerPartition(
            raw['maxConcurrentInvocationsPerPartition'] as number,
        );
    }
    if (typeof raw['backoff-timeout-ms'] === 'number') {
        bpConfig.setBackoffTimeoutMs(raw['backoff-timeout-ms'] as number);
    }
    if (typeof raw['backoffTimeoutMs'] === 'number') {
        bpConfig.setBackoffTimeoutMs(raw['backoffTimeoutMs'] as number);
    }
    if (typeof raw['sync-window'] === 'number') {
        bpConfig.setSyncWindow(raw['sync-window'] as number);
    }
    if (typeof raw['syncWindow'] === 'number') {
        bpConfig.setSyncWindow(raw['syncWindow'] as number);
    }
}
