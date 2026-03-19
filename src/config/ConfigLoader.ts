/**
 * Loads a HeliosConfig from a JSON, YAML, or XML file.
 *
 * Supported formats:
 *   - .json       — JSON object
 *   - .yml/.yaml  — YAML document
 *   - .xml        — Hazelcast XML config (hazelcast.xml)
 *
 * File schema (JSON / YAML):
 * ```yaml
 * name: my-cluster          # optional, defaults to 'helios'
 * maps:                     # optional list of MapConfig entries
 *   - name: orders
 *     ttlSeconds: 300
 *     backupCount: 2
 * ```
 *
 * System property / environment variable overrides applied after loading:
 *   HAZELCAST_CONFIG              — override the config file path
 *   HAZELCAST_CLUSTER_NAME        — override the cluster name
 *   HAZELCAST_PORT                — override the member port
 */
import type { HeliosBlitzRuntimeConfig } from '@zenystx/helios-core/config/BlitzRuntimeConfig';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import { SecurityConfig, PermissionConfig, PermissionType, TokenConfig } from '@zenystx/helios-core/config/SecurityConfig';
import { InitialLoadMode, MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import { ReliableTopicConfig, TopicOverloadPolicy } from '@zenystx/helios-core/config/ReliableTopicConfig';
import { RingbufferConfig } from '@zenystx/helios-core/config/RingbufferConfig';
import { TopicConfig } from '@zenystx/helios-core/config/TopicConfig';
import { RestEndpointGroup } from '@zenystx/helios-core/rest/RestEndpointGroup';
import {
    WanAcknowledgeType,
    WanBatchPublisherConfig,
    WanConsumerConfig,
    WanQueueFullBehavior,
    WanReplicationConfig,
    WanSyncConfig,
    WanConsistencyCheckStrategy,
} from '@zenystx/helios-core/config/WanReplicationConfig';
import { WanReplicationRef } from '@zenystx/helios-core/config/WanReplicationRef';
import { DiscoveryStrategyConfig as SpiDiscoveryStrategyConfig } from '@zenystx/helios-core/discovery/spi/DiscoverySPI';
import { DiscoveryStrategyConfig } from '@zenystx/helios-core/config/DiscoveryStrategyConfig';

/**
 * Loads and parses a config file, returning a HeliosConfig.
 *
 * The file path may be overridden by the {@code HAZELCAST_CONFIG} environment
 * variable.  After loading, cluster-name and port overrides are applied from
 * {@code HAZELCAST_CLUSTER_NAME} and {@code HAZELCAST_PORT} respectively.
 *
 * @throws Error if the file is not found, has an unsupported extension, or fails validation.
 */
export async function loadConfig(filePath: string): Promise<HeliosConfig> {
    // Allow HAZELCAST_CONFIG env var to redirect the config file path
    const resolvedPath = process.env['HAZELCAST_CONFIG'] ?? filePath;

    const file = Bun.file(resolvedPath);
    const exists = await file.exists();
    if (!exists) {
        throw new Error(`Config file not found: ${resolvedPath}`);
    }

    const content = await file.text();
    let raw: unknown;

    if (resolvedPath.endsWith('.json')) {
        try {
            raw = JSON.parse(content);
        } catch (e) {
            throw new Error(`Failed to parse JSON config file "${resolvedPath}": ${String(e)}`);
        }
    } else if (resolvedPath.endsWith('.yml') || resolvedPath.endsWith('.yaml')) {
        try {
            raw = Bun.YAML.parse(content);
        } catch (e) {
            throw new Error(`Failed to parse YAML config file "${resolvedPath}": ${String(e)}`);
        }
    } else if (resolvedPath.endsWith('.xml')) {
        try {
            raw = XmlConfigLoader.parseXml(content);
        } catch (e) {
            throw new Error(`Failed to parse XML config file "${resolvedPath}": ${String(e)}`);
        }
    } else {
        const ext = resolvedPath.includes('.') ? resolvedPath.slice(resolvedPath.lastIndexOf('.')) : '(no extension)';
        throw new Error(`Unsupported config file format: "${ext}". Use .json, .yml/.yaml, or .xml`);
    }

    const config = parseRawConfig(raw, resolvedPath);
    applySystemPropertyOverrides(config);
    return config;
}

/**
 * Apply system property / environment variable overrides to a loaded config.
 *
 * Recognised variables:
 *   - {@code HAZELCAST_CLUSTER_NAME} — overrides the cluster name
 *     (maps to {@code hazelcast.cluster.name} in JVM-land)
 *   - {@code HAZELCAST_PORT} — overrides the member port
 *     (maps to {@code hazelcast.port} in JVM-land)
 */
export function applySystemPropertyOverrides(config: HeliosConfig): void {
    const clusterName = process.env['HAZELCAST_CLUSTER_NAME'];
    if (clusterName && clusterName.trim() !== '') {
        config.setClusterName(clusterName.trim());
    }

    const portStr = process.env['HAZELCAST_PORT'];
    if (portStr) {
        const port = parseInt(portStr, 10);
        if (!isNaN(port) && port >= 0 && port <= 65535) {
            config.getNetworkConfig().setPort(port);
        }
    }
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

    // --- wan-replication configs ---
    if ('wan-replication' in obj && obj['wan-replication'] !== undefined) {
        if (!Array.isArray(obj['wan-replication'])) {
            throw new Error('"wan-replication" must be an array');
        }
        for (const entry of obj['wan-replication'] as unknown[]) {
            config.addWanReplicationConfig(parseWanReplicationConfig(entry));
        }
    }

    // --- security config ---
    if ('security' in obj && obj['security'] !== null && typeof obj['security'] === 'object') {
        config.setSecurityConfig(parseSecurityConfig(obj['security'] as Record<string, unknown>));
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

    // --- wan-replication-ref ---
    if ('wan-replication-ref' in e && e['wan-replication-ref'] !== null && typeof e['wan-replication-ref'] === 'object') {
        const wr = e['wan-replication-ref'] as Record<string, unknown>;
        const ref = new WanReplicationRef();
        if (typeof wr['name'] === 'string') {
            ref.setName(wr['name'] as string);
        }
        if (typeof wr['mergePolicyClassName'] === 'string') {
            ref.setMergePolicyClassName(wr['mergePolicyClassName'] as string);
        }
        if (typeof wr['republishingEnabled'] === 'boolean') {
            ref.setRepublishingEnabled(wr['republishingEnabled'] as boolean);
        }
        mc.setWanReplicationRef(ref);
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

    // --- discovery (SPI strategies) ---
    // Supports both 'discovery-strategies' (kebab) and 'discoveryStrategies' (camelCase).
    const dsKey = 'discovery-strategies' in raw ? 'discovery-strategies' : 'discoveryStrategies';
    if (Array.isArray(raw[dsKey])) {
        const discoveryConfig = joinConfig.getDiscoveryConfig();
        for (const entry of raw[dsKey] as unknown[]) {
            discoveryConfig.addDiscoveryStrategyConfig(parseDiscoveryStrategyConfigEntry(entry));
        }
    }
}

function parseDiscoveryStrategyConfigEntry(entry: unknown): DiscoveryStrategyConfig {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new Error('Each discovery-strategy entry must be an object');
    }
    const e = entry as Record<string, unknown>;

    if (typeof e['className'] !== 'string' || (e['className'] as string).trim() === '') {
        throw new Error('Each discovery-strategy entry must have a non-empty "className" field');
    }

    const cfg = new DiscoveryStrategyConfig();
    cfg.setClassName(e['className'] as string);

    if (typeof e['enabled'] === 'boolean' && !e['enabled']) {
        // Mark as disabled by storing a sentinel property — DiscoveryStrategyConfig
        // does not have an enabled flag, so callers must check the SPI config.
        // We store it as a property for round-trip fidelity.
        cfg.getProperties().set('__enabled__', 'false');
    }

    if (typeof e['properties'] === 'object' && e['properties'] !== null && !Array.isArray(e['properties'])) {
        for (const [k, v] of Object.entries(e['properties'] as Record<string, unknown>)) {
            cfg.getProperties().set(k, String(v));
        }
    }

    return cfg;
}

/**
 * Convert a DiscoveryStrategyConfig (from config classes) into the SPI
 * DiscoveryStrategyConfig interface used by DiscoveryService.
 */
export function toSpiDiscoveryStrategyConfig(cfg: DiscoveryStrategyConfig): SpiDiscoveryStrategyConfig {
    const className = cfg.getClassName() ?? '';
    const props = cfg.getProperties();
    const enabled = props.get('__enabled__') !== 'false';
    const properties: Record<string, string> = {};
    for (const [k, v] of props) {
        if (k !== '__enabled__') {
            properties[k] = v;
        }
    }
    return { className, properties, enabled };
}

// ── WAN replication config parsing ───────────────────────────────────────────

function parseWanReplicationConfig(entry: unknown): WanReplicationConfig {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new Error('Each wan-replication entry must be an object');
    }
    const e = entry as Record<string, unknown>;
    if (typeof e['name'] !== 'string' || (e['name'] as string).trim() === '') {
        throw new Error('Each wan-replication config entry must have a non-empty "name" field');
    }
    const wrc = new WanReplicationConfig();
    wrc.setName(e['name'] as string);

    if (Array.isArray(e['batch-publishers'])) {
        for (const pub of e['batch-publishers'] as unknown[]) {
            wrc.addBatchPublisher(parseWanBatchPublisherConfig(pub));
        }
    }

    if ('consumer' in e && e['consumer'] !== null && typeof e['consumer'] === 'object') {
        const c = e['consumer'] as Record<string, unknown>;
        const consumerConfig = new WanConsumerConfig();
        if (typeof c['persistWanReplicatedData'] === 'boolean') {
            consumerConfig.setPersistWanReplicatedData(c['persistWanReplicatedData'] as boolean);
        }
        if (typeof c['mergePolicyClassName'] === 'string') {
            consumerConfig.setMergePolicyClassName(c['mergePolicyClassName'] as string);
        }
        wrc.setConsumerConfig(consumerConfig);
    }

    return wrc;
}

function parseWanBatchPublisherConfig(entry: unknown): WanBatchPublisherConfig {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new Error('Each batch-publisher entry must be an object');
    }
    const e = entry as Record<string, unknown>;
    const cfg = new WanBatchPublisherConfig();

    if (typeof e['clusterName'] === 'string') {
        cfg.setClusterName(e['clusterName'] as string);
    }
    if (Array.isArray(e['targetEndpoints'])) {
        for (const ep of e['targetEndpoints'] as unknown[]) {
            if (typeof ep === 'string') cfg.addTargetEndpoint(ep);
        }
    }
    if (typeof e['batchSize'] === 'number') {
        cfg.setBatchSize(e['batchSize'] as number);
    }
    if (typeof e['batchMaxDelayMillis'] === 'number') {
        cfg.setBatchMaxDelayMillis(e['batchMaxDelayMillis'] as number);
    }
    if (typeof e['queueCapacity'] === 'number') {
        cfg.setQueueCapacity(e['queueCapacity'] as number);
    }
    if (typeof e['queueFullBehavior'] === 'string') {
        const behavior = WanQueueFullBehavior[e['queueFullBehavior'] as keyof typeof WanQueueFullBehavior];
        if (behavior === undefined) {
            throw new Error(`Invalid queueFullBehavior: "${e['queueFullBehavior']}". Valid values: ${Object.keys(WanQueueFullBehavior).join(', ')}`);
        }
        cfg.setQueueFullBehavior(behavior);
    }
    if (typeof e['acknowledgeType'] === 'string') {
        const ackType = WanAcknowledgeType[e['acknowledgeType'] as keyof typeof WanAcknowledgeType];
        if (ackType === undefined) {
            throw new Error(`Invalid acknowledgeType: "${e['acknowledgeType']}". Valid values: ${Object.keys(WanAcknowledgeType).join(', ')}`);
        }
        cfg.setAcknowledgeType(ackType);
    }
    if ('syncConfig' in e && e['syncConfig'] !== null && typeof e['syncConfig'] === 'object') {
        const sc = e['syncConfig'] as Record<string, unknown>;
        const syncConfig = new WanSyncConfig();
        if (typeof sc['consistencyCheckStrategy'] === 'string') {
            const strategy = WanConsistencyCheckStrategy[sc['consistencyCheckStrategy'] as keyof typeof WanConsistencyCheckStrategy];
            if (strategy === undefined) {
                throw new Error(`Invalid consistencyCheckStrategy: "${sc['consistencyCheckStrategy']}". Valid values: ${Object.keys(WanConsistencyCheckStrategy).join(', ')}`);
            }
            syncConfig.setConsistencyCheckStrategy(strategy);
        }
        cfg.setSyncConfig(syncConfig);
    }
    return cfg;
}

// ── Security config parsing ───────────────────────────────────────────────────

function parseSecurityConfig(raw: Record<string, unknown>): SecurityConfig {
    const sc = new SecurityConfig();

    if (typeof raw['enabled'] === 'boolean') {
        sc.setEnabled(raw['enabled'] as boolean);
    }
    if (typeof raw['member-realm'] === 'string') {
        sc.setMemberRealm(raw['member-realm'] as string);
    }
    if (typeof raw['memberRealm'] === 'string') {
        sc.setMemberRealm(raw['memberRealm'] as string);
    }
    if (typeof raw['client-realm'] === 'string') {
        sc.setClientRealm(raw['client-realm'] as string);
    }
    if (typeof raw['clientRealm'] === 'string') {
        sc.setClientRealm(raw['clientRealm'] as string);
    }

    // --- client-permissions ---
    const permKey = 'client-permissions' in raw ? 'client-permissions' : 'clientPermissions';
    if (Array.isArray(raw[permKey])) {
        for (const entry of raw[permKey] as unknown[]) {
            sc.addClientPermissionConfig(parsePermissionConfig(entry));
        }
    }

    // --- token-configs ---
    const tokenKey = 'token-configs' in raw ? 'token-configs' : 'tokenConfigs';
    if (Array.isArray(raw[tokenKey])) {
        for (const entry of raw[tokenKey] as unknown[]) {
            sc.addTokenConfig(parseTokenConfig(entry));
        }
    }

    return sc;
}

function parsePermissionConfig(entry: unknown): PermissionConfig {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new Error('Each permission config entry must be an object');
    }
    const e = entry as Record<string, unknown>;
    const pc = new PermissionConfig();

    if (typeof e['type'] === 'string') {
        const typeStr = (e['type'] as string).toUpperCase();
        const type = PermissionType[typeStr as keyof typeof PermissionType];
        if (type === undefined) {
            throw new Error(`Invalid permission type: "${e['type']}". Valid values: ${Object.keys(PermissionType).join(', ')}`);
        }
        pc.setType(type);
    }
    if (typeof e['name'] === 'string') {
        pc.setName(e['name'] as string);
    }
    if (typeof e['principal'] === 'string') {
        pc.setPrincipal(e['principal'] as string);
    }
    if (Array.isArray(e['actions'])) {
        pc.setActions((e['actions'] as unknown[]).filter((a) => typeof a === 'string') as string[]);
    }
    if (Array.isArray(e['endpoints'])) {
        pc.setEndpoints((e['endpoints'] as unknown[]).filter((ep) => typeof ep === 'string') as string[]);
    }

    return pc;
}

function parseTokenConfig(entry: unknown): TokenConfig {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new Error('Each token config entry must be an object');
    }
    const e = entry as Record<string, unknown>;
    if (typeof e['token'] !== 'string' || (e['token'] as string).trim() === '') {
        throw new Error('Each token config entry must have a non-empty "token" field');
    }
    const tc = new TokenConfig();
    tc.setToken(e['token'] as string);
    if (typeof e['principal'] === 'string') {
        tc.setPrincipal(e['principal'] as string);
    }
    if (Array.isArray(e['permissions'])) {
        for (const perm of e['permissions'] as unknown[]) {
            tc.addPermission(parsePermissionConfig(perm));
        }
    }
    return tc;
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
