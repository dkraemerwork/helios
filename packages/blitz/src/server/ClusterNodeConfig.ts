/**
 * ClusterNodeNatsConfig — typed configuration for spawning a single NATS node
 * that participates in (or bootstraps) a Blitz cluster.
 *
 * This is the raw Blitz-side primitive: Helios higher-level orchestration
 * (Phase 18.2+) builds on top of this to manage topology and lifecycle.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NatsServerBinaryResolver } from './NatsServerBinaryResolver.js';
import type { NatsServerNodeConfig } from './NatsServerConfig.js';
import { NatsServerManager } from './NatsServerManager.js';

/**
 * Default replication factor for JetStream streams created by Blitz.
 * Mirrors Hazelcast's DEFAULT_BACKUP_COUNT of 1 (primary + 1 replica).
 */
export const DEFAULT_REPLICAS = 1;

/**
 * User-facing configuration for a single clustered NATS node.
 * All fields are optional and resolve to sensible defaults.
 */
export interface ClusterNodeNatsConfig {
    /** Host to bind the NATS client listener to. @default '127.0.0.1' */
    readonly bindHost?: string;

    /** Host advertised to other cluster members and clients. @default '127.0.0.1' */
    readonly advertiseHost?: string;

    /** Client-facing port. @default 4222 */
    readonly port?: number;

    /** Intra-cluster routing port. @default 6222 */
    readonly clusterPort?: number;

    /** Cluster name shared by all nodes. @default 'helios-blitz-cluster' */
    readonly clusterName?: string;

    /** Unique server name for this node. @default auto-generated */
    readonly serverName?: string;

    /** Route URLs for other cluster members (e.g. 'nats://10.0.1.2:6222'). @default [] */
    readonly routes?: string[];

    /**
     * JetStream replication factor.
     * Mirrors Hazelcast's backup count: 1 = primary + 1 replica.
     * @default DEFAULT_REPLICAS (1)
     */
    readonly replicas?: number;

    /** JetStream storage directory. Omit for in-memory mode. */
    readonly dataDir?: string;

    /** Override nats-server binary path. */
    readonly binaryPath?: string;

    /** Startup timeout in ms. @default 15_000 */
    readonly startTimeoutMs?: number;
}

/**
 * Fully resolved ClusterNodeNatsConfig with all defaults applied.
 */
export interface ResolvedClusterNodeNatsConfig {
    readonly bindHost: string;
    readonly advertiseHost: string;
    readonly port: number;
    readonly clusterPort: number;
    readonly clusterName: string;
    readonly serverName: string;
    readonly routes: string[];
    readonly replicas: number;
    readonly dataDir: string | undefined;
    readonly binaryPath: string | undefined;
    readonly startTimeoutMs: number;
}

/**
 * Resolve a partial ClusterNodeNatsConfig into a fully resolved config with defaults.
 */
export function resolveClusterNodeConfig(config: ClusterNodeNatsConfig): ResolvedClusterNodeNatsConfig {
    return {
        bindHost: config.bindHost ?? '127.0.0.1',
        advertiseHost: config.advertiseHost ?? '127.0.0.1',
        port: config.port ?? 4222,
        clusterPort: config.clusterPort ?? 6222,
        clusterName: config.clusterName ?? 'helios-blitz-cluster',
        serverName: config.serverName ?? `helios-blitz-${Date.now().toString(36)}`,
        routes: normalizeRoutes(config.routes ?? []),
        replicas: config.replicas ?? DEFAULT_REPLICAS,
        dataDir: config.dataDir,
        binaryPath: config.binaryPath,
        startTimeoutMs: config.startTimeoutMs ?? 15_000,
    };
}

/**
 * Normalize routes: deduplicate and sort lexicographically for deterministic
 * ordering across restarts and re-renders.
 */
export function normalizeRoutes(routes: string[]): string[] {
    return [...new Set(routes)].sort();
}

/**
 * Validate a resolved ClusterNodeNatsConfig. Throws on invalid combinations.
 */
export function validateClusterNodeConfig(config: ResolvedClusterNodeNatsConfig): void {
    if (!config.bindHost) {
        throw new Error('ClusterNodeNatsConfig: bindHost must not be empty.');
    }
    if (!config.advertiseHost) {
        throw new Error('ClusterNodeNatsConfig: advertiseHost must not be empty.');
    }
    if (config.port < 1 || config.port > 65535) {
        throw new Error(`ClusterNodeNatsConfig: port must be 1–65535 (got ${config.port}).`);
    }
    if (config.clusterPort < 1 || config.clusterPort > 65535) {
        throw new Error(`ClusterNodeNatsConfig: clusterPort must be 1–65535 (got ${config.clusterPort}).`);
    }
    if (config.port === config.clusterPort) {
        throw new Error(
            `ClusterNodeNatsConfig: client port (${config.port}) and cluster port (${config.clusterPort}) overlap. They must be different.`,
        );
    }
    if (config.replicas < 1) {
        throw new Error(`ClusterNodeNatsConfig: replicas must be >= 1 (got ${config.replicas}).`);
    }
    for (const route of config.routes) {
        if (!route.startsWith('nats://')) {
            throw new Error(`ClusterNodeNatsConfig: route '${route}' is invalid — must start with 'nats://'.`);
        }
    }
}

/**
 * Convert a ResolvedClusterNodeNatsConfig into the internal NatsServerNodeConfig
 * used by NatsServerManager.
 */
export function toNodeConfig(resolved: ResolvedClusterNodeNatsConfig): NatsServerNodeConfig {
    const binaryPath = NatsServerBinaryResolver.resolve(resolved.binaryPath);
    return {
        binaryPath,
        port: resolved.port,
        clusterPort: resolved.clusterPort,
        dataDir: resolved.dataDir ?? join(tmpdir(), `blitz-cluster-${Date.now()}`),
        serverName: resolved.serverName,
        clusterName: resolved.clusterName,
        routes: resolved.routes,
        extraArgs: [],
        startTimeoutMs: resolved.startTimeoutMs,
        bindHost: resolved.bindHost,
        advertiseHost: resolved.advertiseHost,
    };
}

/**
 * Spawn a single NATS node configured for cluster participation.
 * This is the raw Blitz primitive — no Helios orchestration involved.
 *
 * The returned NatsServerManager owns the process lifecycle and carries
 * the resolved config for inspection.
 */
export async function clusterNode(config: ClusterNodeNatsConfig = {}): Promise<NatsServerManager> {
    const resolved = resolveClusterNodeConfig(config);
    validateClusterNodeConfig(resolved);
    const nodeConfig = toNodeConfig(resolved);
    const manager = await NatsServerManager.spawn([nodeConfig]);
    manager.resolvedConfig = resolved;
    return manager;
}
