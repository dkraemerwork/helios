/**
 * Main orchestrator for cluster connectivity.
 *
 * On module init, loads cluster configurations and establishes SSE connections
 * to each configured member address. Manages the full lifecycle of member
 * connections including auto-discovery of new members from payloads, staleness
 * detection, metric persistence, and event emission for downstream consumers
 * (WebSocket gateway, alert engine, etc.).
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '../config/ConfigService.js';
import { WriteBatcher } from '../persistence/WriteBatcher.js';
import { MetricsRepository } from '../persistence/MetricsRepository.js';
import { ClusterStateStore } from './ClusterStateStore.js';
import { MemberSseClient } from './MemberSseClient.js';
import { MemberRestClient } from './MemberRestClient.js';
import { nowMs } from '../shared/time.js';
import type {
  ClusterConfig,
  MonitorPayload,
  MemberMetricsSample,
  MetricSample,
  SystemEvent,
} from '../shared/types.js';

const STALE_CHECK_INTERVAL_MS = 10_000;

/** Maps a MemberMetricsSample to a MetricSample for persistence. */
function sampleToMetricRow(
  clusterId: string,
  memberAddr: string,
  s: MemberMetricsSample,
): MetricSample {
  return {
    clusterId,
    memberAddr,
    timestamp: s.timestamp,
    elMeanMs: s.eventLoop.meanMs,
    elP50Ms: s.eventLoop.p50Ms,
    elP99Ms: s.eventLoop.p99Ms,
    elMaxMs: s.eventLoop.maxMs,
    heapUsed: s.memory.heapUsed,
    heapTotal: s.memory.heapTotal,
    rss: s.memory.rss,
    cpuPercent: s.cpu.percentUsed,
    bytesRead: s.transport.bytesRead,
    bytesWritten: s.transport.bytesWritten,
    migrationCompleted: s.migration.completedMigrations,
    opCompleted: s.operation.completedCount,
    invTimeoutFailures: s.invocation.timeoutFailures,
    invMemberLeftFailures: s.invocation.memberLeftFailures,
    blitzJobsSubmitted: s.blitz?.jobCounters.submitted ?? null,
    blitzJobsSucceeded: s.blitz?.jobCounters.completedSuccessfully ?? null,
    blitzJobsFailed: s.blitz?.jobCounters.completedWithFailure ?? null,
  };
}

/**
 * Extracts the host portion from a TCP address string (e.g. "10.0.0.5:5701" -> "10.0.0.5").
 * Handles IPv6 bracket notation (e.g. "[::1]:5701" -> "::1").
 */
function extractHost(tcpAddress: string): string {
  // Handle IPv6 bracket notation
  if (tcpAddress.startsWith('[')) {
    const bracketEnd = tcpAddress.indexOf(']');
    if (bracketEnd !== -1) {
      return tcpAddress.slice(1, bracketEnd);
    }
  }

  // Standard host:port — take everything before the last colon
  const lastColon = tcpAddress.lastIndexOf(':');
  if (lastColon === -1) return tcpAddress;

  return tcpAddress.slice(0, lastColon);
}

/** Builds a REST URL from a host, port, and SSL flag. */
function buildRestUrl(host: string, port: number, ssl: boolean): string {
  const scheme = ssl ? 'https' : 'http';
  // Wrap IPv6 addresses in brackets for URLs
  const urlHost = host.includes(':') ? `[${host}]` : host;
  return `${scheme}://${urlHost}:${port}`;
}

@Injectable()
export class ClusterConnectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClusterConnectorService.name);

  /**
   * Track SSE clients per cluster: Map<clusterId, Map<memberAddr, MemberSseClient>>.
   * The memberAddr key is the TCP address (e.g. "10.0.0.5:5701").
   */
  private readonly sseClients = new Map<string, Map<string, MemberSseClient>>();

  /** Track cluster configs for auto-discovery and reconnection. */
  private readonly clusterConfigs = new Map<string, ClusterConfig>();

  /** Periodic stale-check timer. */
  private staleCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly stateStore: ClusterStateStore,
    private readonly writeBatcher: WriteBatcher,
    private readonly metricsRepository: MetricsRepository,
    private readonly restClient: MemberRestClient,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing cluster connector service');

    // Load cluster configurations
    for (const config of this.configService.clusters) {
      this.connectCluster(config.id, config);
    }

    // Start periodic stale member check
    this.staleCheckTimer = setInterval(() => {
      this.checkStaleMembers();
    }, STALE_CHECK_INTERVAL_MS);

    this.logger.log(
      `Cluster connector initialized with ${this.configService.clusters.length} cluster(s)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Shutting down cluster connector service');

    // Stop stale check timer
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
      this.staleCheckTimer = null;
    }

    // Disconnect all SSE clients
    for (const [clusterId] of this.sseClients) {
      this.disconnectCluster(clusterId);
    }

    this.logger.log('Cluster connector service shutdown complete');
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Connects to a cluster by creating SSE clients for each configured member.
   * Initializes cluster state and begins streaming.
   */
  connectCluster(clusterId: string, config: ClusterConfig): void {
    // Store config for auto-discovery
    this.clusterConfigs.set(clusterId, config);

    // Initialize cluster state
    this.stateStore.initCluster(clusterId, config.displayName);

    // Create SSE client map for this cluster
    if (!this.sseClients.has(clusterId)) {
      this.sseClients.set(clusterId, new Map());
    }

    // Connect to each configured member address
    for (const memberAddr of config.memberAddresses) {
      const restUrl = buildRestUrl(memberAddr, config.restPort, config.sslEnabled);
      this.connectMember(clusterId, memberAddr, restUrl, config);
    }

    this.logger.log(
      `Connected to cluster ${clusterId} with ${config.memberAddresses.length} member(s)`,
    );
  }

  /** Disconnects all SSE clients for a cluster and removes its state. */
  disconnectCluster(clusterId: string): void {
    const clients = this.sseClients.get(clusterId);
    if (clients) {
      for (const [, client] of clients) {
        client.disconnect();
      }
      clients.clear();
      this.sseClients.delete(clusterId);
    }

    this.clusterConfigs.delete(clusterId);
    this.stateStore.removeCluster(clusterId);
    this.logger.log(`Disconnected from cluster ${clusterId}`);
  }

  /** Disconnects and reconnects all members for a cluster. */
  reconnectCluster(clusterId: string): void {
    const config = this.clusterConfigs.get(clusterId);
    if (!config) {
      this.logger.warn(`Cannot reconnect cluster ${clusterId}: no config found`);
      return;
    }

    this.disconnectCluster(clusterId);
    this.connectCluster(clusterId, config);
  }

  /**
   * Fetches jobs from a connected member in the specified cluster.
   * Picks the first connected member with a REST address.
   */
  async fetchJobs(clusterId: string): Promise<unknown> {
    const state = this.stateStore.getClusterState(clusterId);
    if (!state) {
      throw new Error(`Cluster ${clusterId} not found`);
    }

    const config = this.clusterConfigs.get(clusterId);

    for (const member of state.members.values()) {
      if (member.connected && member.restAddress) {
        return this.restClient.fetchJobs(member.restAddress, config?.authToken);
      }
    }

    throw new Error(`No connected members available in cluster ${clusterId}`);
  }

  /** Returns the set of member addresses currently connected to a cluster. */
  getConnectedMembers(clusterId: string): Set<string> {
    const clients = this.sseClients.get(clusterId);
    if (!clients) return new Set();

    const connected = new Set<string>();
    for (const [addr, client] of clients) {
      if (client.isRunning) {
        connected.add(addr);
      }
    }
    return connected;
  }

  // ── Private: Member Connection ──────────────────────────────────────────

  private connectMember(
    clusterId: string,
    memberAddr: string,
    restUrl: string,
    config: ClusterConfig,
  ): void {
    const clients = this.sseClients.get(clusterId);
    if (!clients) return;

    // Don't create duplicate connections
    if (clients.has(memberAddr)) {
      const existing = clients.get(memberAddr)!;
      if (existing.isRunning) return;
    }

    const client = new MemberSseClient({
      memberAddr,
      restUrl,
      authToken: config.authToken,
      requestTimeoutMs: config.requestTimeoutMs,

      onInit: (payload) => {
        this.handleInit(clusterId, memberAddr, restUrl, payload);
      },

      onSample: (sample) => {
        this.handleSample(clusterId, memberAddr, sample);
      },

      onPayload: (payload) => {
        this.handlePayload(clusterId, memberAddr, payload);
      },

      onError: (error) => {
        this.stateStore.setMemberError(clusterId, memberAddr, error);
        this.logger.warn(`Member ${memberAddr} error in cluster ${clusterId}: ${error}`);
      },

      onDisconnect: () => {
        this.handleDisconnect(clusterId, memberAddr);
      },

      onReconnect: (attempt) => {
        this.logger.debug(`Reconnecting to ${memberAddr} (attempt ${attempt})`);
      },
    });

    clients.set(memberAddr, client);

    // Mark connected in state store
    this.stateStore.setMemberConnected(clusterId, memberAddr, restUrl);

    // Start the SSE connection
    client.start();

    // Emit connected event
    this.emitSystemEvent(clusterId, memberAddr, 'member.connected', `SSE connection established to ${memberAddr}`);
    this.eventEmitter.emit('member.connected', { clusterId, memberAddr });
  }

  // ── Private: Event Handlers ─────────────────────────────────────────────

  private handleInit(
    clusterId: string,
    memberAddr: string,
    restUrl: string,
    payload: MonitorPayload,
  ): void {
    this.logger.log(
      `Received init payload from ${memberAddr} — cluster: ${payload.clusterName}, ` +
        `state: ${payload.clusterState}, members: ${payload.clusterSize}`,
    );

    // Update state store with the full payload
    this.stateStore.updateFromPayload(clusterId, memberAddr, payload);

    // Emit payload event
    this.eventEmitter.emit('payload.received', { clusterId, memberAddr, payload });

    // Check for auto-discoverable members
    this.autoDiscoverMembers(clusterId, payload);
  }

  private handleSample(
    clusterId: string,
    memberAddr: string,
    sample: MemberMetricsSample,
  ): void {
    // 1. Update in-memory state
    this.stateStore.updateFromSample(clusterId, memberAddr, sample);

    // 2. Persist via WriteBatcher
    const metricRow = sampleToMetricRow(clusterId, memberAddr, sample);
    this.writeBatcher.add(metricRow);

    // 3. Emit event for downstream consumers
    this.eventEmitter.emit('sample.received', { clusterId, memberAddr, sample });
  }

  private handlePayload(
    clusterId: string,
    memberAddr: string,
    payload: MonitorPayload,
  ): void {
    // Update state store (ignoring payload.samples as per plan)
    this.stateStore.updateFromPayload(clusterId, memberAddr, payload);

    // Emit payload event
    this.eventEmitter.emit('payload.received', { clusterId, memberAddr, payload });

    // Check for new members to auto-discover
    this.autoDiscoverMembers(clusterId, payload);
  }

  private handleDisconnect(clusterId: string, memberAddr: string): void {
    this.stateStore.setMemberDisconnected(clusterId, memberAddr);
    this.emitSystemEvent(clusterId, memberAddr, 'member.disconnected', `SSE connection lost to ${memberAddr}`);
    this.eventEmitter.emit('member.disconnected', { clusterId, memberAddr });
    this.logger.warn(`Member ${memberAddr} disconnected from cluster ${clusterId}`);
  }

  // ── Private: Auto-Discovery ─────────────────────────────────────────────

  /**
   * When a payload arrives, inspect its members list for addresses not
   * currently connected. Extract the host from the TCP address, build a
   * REST URL with the configured restPort, and connect.
   */
  private autoDiscoverMembers(clusterId: string, payload: MonitorPayload): void {
    const config = this.clusterConfigs.get(clusterId);
    if (!config?.autoDiscover) return;

    const clients = this.sseClients.get(clusterId);
    if (!clients) return;

    for (const memberInfo of payload.members) {
      const tcpAddr = memberInfo.address;

      // Already connected to this member
      if (clients.has(tcpAddr)) continue;

      // Extract host from TCP address and build REST URL
      const host = extractHost(tcpAddr);
      const restUrl = buildRestUrl(host, config.restPort, config.sslEnabled);

      this.logger.log(
        `Auto-discovered member ${tcpAddr} in cluster ${clusterId}, ` +
          `connecting via REST at ${restUrl}`,
      );

      this.connectMember(clusterId, tcpAddr, restUrl, config);
      this.emitSystemEvent(
        clusterId,
        tcpAddr,
        'member.auto-discovered',
        `Auto-discovered and connecting to member ${tcpAddr} (REST: ${restUrl})`,
      );
    }
  }

  // ── Private: Staleness Check ────────────────────────────────────────────

  private checkStaleMembers(): void {
    for (const [clusterId, config] of this.clusterConfigs) {
      this.stateStore.markStaleMembers(clusterId, config.stalenessWindowMs);
    }
  }

  // ── Private: System Event Emission ──────────────────────────────────────

  private emitSystemEvent(
    clusterId: string,
    memberAddr: string,
    eventType: string,
    message: string,
  ): void {
    const event: SystemEvent = {
      clusterId,
      memberAddr,
      timestamp: nowMs(),
      eventType,
      message,
      detailsJson: null,
    };

    // Persist asynchronously — fire and forget
    this.metricsRepository.insertSystemEvent(event).catch((err) => {
      this.logger.warn(
        `Failed to persist system event: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
}
