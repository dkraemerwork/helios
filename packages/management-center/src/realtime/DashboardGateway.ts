/**
 * WebSocket gateway for real-time dashboard communication.
 *
 * Authenticates connections via one-time tickets, manages per-cluster
 * subscription rooms, forwards live connector events to subscribed clients,
 * and handles history queries. Uses the raw `ws` adapter from
 * @nestjs/platform-ws — there is no Socket.IO layer.
 *
 * Lifecycle:
 *   1. Client connects with ?ticket=<token> query parameter
 *   2. Ticket is consumed and session validated
 *   3. Client sends 'subscribe' to join a cluster room
 *   4. Server pushes live events (samples, payloads, alerts, jobs)
 *   5. Client may send 'query:history' for historical data
 *   6. On disconnect, all subscriptions and heartbeat state are cleaned up
 */

import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { WsTicketService } from '../auth/WsTicketService.js';
import { SessionService } from '../auth/SessionService.js';
import { ClusterStateStore } from '../connector/ClusterStateStore.js';
import { WsHeartbeatService } from './WsHeartbeatService.js';
import { HistoryQueryService } from './HistoryQueryService.js';
import { parseClientMessage, encodeServerMessage } from './WsProtocol.js';
import { WS_PATH } from '../shared/constants.js';
import type {
  ClusterState,
  MemberMetricsSample,
  MonitorPayload,
  User,
  WsSubscribeData,
  WsUnsubscribeData,
  WsHistoryQueryData,
} from '../shared/types.js';

/**
 * Minimal interface for the raw WebSocket provided by the ws library
 * via @nestjs/platform-ws. Avoids requiring @types/ws.
 */
interface RawWebSocket {
  readyState: number;
  send(data: string, cb?: (err?: Error) => void): void;
  close(code?: number, reason?: string): void;
  OPEN: number;
}

/** User context attached to authenticated sockets. */
interface SocketContext {
  sessionId: string;
  userId: string;
  user: User;
}

/** Subscription metadata for a socket within a cluster room. */
interface SubscriptionEntry {
  socket: RawWebSocket;
  context: SocketContext;
  /** 'all' to receive all member events, or a specific memberAddr. */
  scope: string;
}

@WebSocketGateway({ path: WS_PATH })
export class DashboardGateway
  implements OnGatewayConnection<RawWebSocket>, OnGatewayDisconnect<RawWebSocket>, OnModuleDestroy
{
  private readonly logger = new Logger(DashboardGateway.name);

  /** Map<clusterId, Set<SubscriptionEntry>> — cluster subscription rooms. */
  private readonly rooms = new Map<string, Set<SubscriptionEntry>>();

  /** Map<socket, SocketContext> — authenticated socket contexts. */
  private readonly socketContexts = new Map<RawWebSocket, SocketContext>();

  /** Map<socket, Set<clusterId>> — tracks which clusters each socket subscribes to. */
  private readonly socketSubscriptions = new Map<RawWebSocket, Set<string>>();

  constructor(
    private readonly wsTicketService: WsTicketService,
    private readonly sessionService: SessionService,
    private readonly clusterStateStore: ClusterStateStore,
    private readonly heartbeatService: WsHeartbeatService,
    private readonly historyQueryService: HistoryQueryService,
  ) {}

  onModuleDestroy(): void {
    // Close all connected sockets gracefully on shutdown
    for (const socket of this.socketContexts.keys()) {
      socket.close(1001, 'Server shutting down');
    }
    this.rooms.clear();
    this.socketContexts.clear();
    this.socketSubscriptions.clear();
  }

  // ── Connection Lifecycle ──────────────────────────────────────────────

  /**
   * Handles new WebSocket connections. Authenticates via one-time ticket
   * from the URL query string. Rejects unauthorized connections immediately.
   */
  async handleConnection(client: RawWebSocket, ...args: any[]): Promise<void> {
    const req = args[0] as { url?: string } | undefined;
    const ticket = extractTicketFromUrl(req?.url);

    if (!ticket) {
      this.logger.debug('Connection rejected: no ticket in query string');
      client.close(4000, 'Missing authentication ticket');
      return;
    }

    // Consume the one-time ticket
    const ticketResult = this.wsTicketService.consumeTicket(ticket);
    if (!ticketResult) {
      this.logger.debug('Connection rejected: invalid or expired ticket');
      client.close(4001, 'Invalid or expired ticket');
      return;
    }

    // Validate the session
    const sessionResult = await this.sessionService.getSession(ticketResult.sessionId);
    if (!sessionResult) {
      this.logger.debug(`Connection rejected: session ${ticketResult.sessionId} is invalid`);
      client.close(4003, 'Invalid session');
      return;
    }

    // Store user context
    const context: SocketContext = {
      sessionId: ticketResult.sessionId,
      userId: ticketResult.userId,
      user: sessionResult.user,
    };

    this.socketContexts.set(client, context);
    this.socketSubscriptions.set(client, new Set());

    // Register with heartbeat service
    this.heartbeatService.register(client, context.sessionId, context.userId);

    this.logger.log(
      `WebSocket connected: user=${context.user.email} session=${context.sessionId}`,
    );
  }

  /** Cleans up subscriptions, heartbeat, and socket context on disconnect. */
  handleDisconnect(client: RawWebSocket): void {
    const context = this.socketContexts.get(client);
    const subs = this.socketSubscriptions.get(client);

    // Remove from all cluster rooms
    if (subs) {
      for (const clusterId of subs) {
        this.removeFromRoom(client, clusterId);
      }
    }

    // Unregister heartbeat
    this.heartbeatService.unregister(client);

    // Clean up context
    this.socketContexts.delete(client);
    this.socketSubscriptions.delete(client);

    if (context) {
      this.logger.log(`WebSocket disconnected: user=${context.userId}`);
    }
  }

  // ── Message Handlers ──────────────────────────────────────────────────

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: RawWebSocket,
    @MessageBody() data: WsSubscribeData,
  ): Promise<void> {
    const context = this.socketContexts.get(client);
    if (!context) return;

    const { clusterId, scope } = data;

    // RBAC: validate cluster access
    if (!this.userCanAccessCluster(context.user, clusterId)) {
      this.sendToSocket(client, 'cluster:update', {
        error: 'Access denied for this cluster',
        clusterId,
      });
      return;
    }

    // Add to subscription room
    const entry: SubscriptionEntry = {
      socket: client,
      context,
      scope: scope ?? 'all',
    };

    this.addToRoom(clusterId, entry);

    // Track subscription on the socket
    const subs = this.socketSubscriptions.get(client);
    if (subs) {
      subs.add(clusterId);
    }

    // Send current cluster state snapshot
    await this.sendInitialState(client, clusterId);

    this.logger.debug(
      `User ${context.userId} subscribed to cluster ${clusterId} (scope=${scope ?? 'all'})`,
    );
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: RawWebSocket,
    @MessageBody() data: WsUnsubscribeData,
  ): void {
    const context = this.socketContexts.get(client);
    if (!context) return;

    this.removeFromRoom(client, data.clusterId);

    const subs = this.socketSubscriptions.get(client);
    if (subs) {
      subs.delete(data.clusterId);
    }

    this.logger.debug(`User ${context.userId} unsubscribed from cluster ${data.clusterId}`);
  }

  @SubscribeMessage('query:history')
  async handleHistoryQuery(
    @ConnectedSocket() client: RawWebSocket,
    @MessageBody() data: WsHistoryQueryData,
  ): Promise<void> {
    const context = this.socketContexts.get(client);
    if (!context) return;

    try {
      const result = await this.historyQueryService.queryHistory(
        data,
        context.user.roles,
        context.user.clusterScopes,
      );

      this.sendToSocket(client, 'history:result', {
        requestId: data.requestId,
        data: result,
      });
    } catch (err) {
      this.logger.error(
        `History query failed for requestId=${data.requestId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );

      this.sendToSocket(client, 'history:result', {
        requestId: data.requestId,
        error: 'Query failed',
        data: [],
      });
    }
  }

  @SubscribeMessage('ws:pong')
  handlePong(@ConnectedSocket() client: RawWebSocket): void {
    this.heartbeatService.handlePong(client);
  }

  // ── Event Listeners (connector -> WebSocket clients) ──────────────────

  @OnEvent('sample.received')
  onSampleReceived(payload: {
    clusterId: string;
    memberAddr: string;
    sample: MemberMetricsSample;
  }): void {
    const room = this.rooms.get(payload.clusterId);
    if (!room || room.size === 0) return;

    const message = encodeServerMessage('member:sample', {
      clusterId: payload.clusterId,
      memberAddr: payload.memberAddr,
      sample: payload.sample,
    });

    for (const entry of room) {
      if (!this.userCanAccessCluster(entry.context.user, payload.clusterId)) continue;

      // Respect scope filtering: if scope is a specific member address,
      // only forward that member's samples
      if (entry.scope !== 'all' && entry.scope !== payload.memberAddr) continue;

      this.sendRaw(entry.socket, message);
    }
  }

  @OnEvent('payload.received')
  onPayloadReceived(payload: {
    clusterId: string;
    memberAddr: string;
    payload: MonitorPayload;
  }): void {
    const clusterState = this.clusterStateStore.getClusterState(payload.clusterId);
    if (!clusterState) return;

    // Forward cluster state update
    this.broadcastToRoom(payload.clusterId, 'cluster:update', {
      clusterId: payload.clusterId,
      clusterState: serializeClusterState(clusterState),
    });

    // Forward distributed objects update
    this.broadcastToRoom(payload.clusterId, 'data:update', {
      clusterId: payload.clusterId,
      distributedObjects: clusterState.distributedObjects,
      mapStats: clusterState.mapStats,
      queueStats: clusterState.queueStats,
      topicStats: clusterState.topicStats,
    });
  }

  @OnEvent('jobs.received')
  onJobsReceived(payload: { clusterId: string; jobs: unknown }): void {
    this.broadcastToRoom(payload.clusterId, 'jobs:update', {
      clusterId: payload.clusterId,
      jobs: payload.jobs,
    });
  }

  @OnEvent('alert.fired')
  onAlertFired(payload: {
    clusterId: string;
    ruleId: string;
    memberAddr: string;
    severity: string;
    message: string;
    metricValue: number;
    threshold: number;
  }): void {
    this.broadcastToRoom(payload.clusterId, 'alert:fired', payload);
  }

  @OnEvent('alert.resolved')
  onAlertResolved(payload: {
    clusterId: string;
    ruleId: string;
    memberAddr: string;
    message: string;
  }): void {
    this.broadcastToRoom(payload.clusterId, 'alert:resolved', payload);
  }

  @OnEvent('admin.action.completed')
  onAdminActionCompleted(payload: {
    clusterId: string;
    action: string;
    result: unknown;
    userId: string;
  }): void {
    this.broadcastToRoom(payload.clusterId, 'admin:result', payload);
  }

  @OnEvent('cluster.stateChanged')
  onClusterStateChanged(payload: { clusterId: string; newState: string }): void {
    const clusterState = this.clusterStateStore.getClusterState(payload.clusterId);
    if (!clusterState) return;

    this.broadcastToRoom(payload.clusterId, 'cluster:update', {
      clusterId: payload.clusterId,
      clusterState: serializeClusterState(clusterState),
    });
  }

  // ── Room Management ───────────────────────────────────────────────────

  private addToRoom(clusterId: string, entry: SubscriptionEntry): void {
    let room = this.rooms.get(clusterId);
    if (!room) {
      room = new Set();
      this.rooms.set(clusterId, room);
    }

    // Remove any existing subscription for this socket in this room
    // (handles re-subscribe with different scope)
    for (const existing of room) {
      if (existing.socket === entry.socket) {
        room.delete(existing);
        break;
      }
    }

    room.add(entry);
  }

  private removeFromRoom(socket: RawWebSocket, clusterId: string): void {
    const room = this.rooms.get(clusterId);
    if (!room) return;

    for (const entry of room) {
      if (entry.socket === socket) {
        room.delete(entry);
        break;
      }
    }

    // Clean up empty rooms
    if (room.size === 0) {
      this.rooms.delete(clusterId);
    }
  }

  /**
   * Broadcasts a server message to all sockets subscribed to a cluster,
   * checking RBAC entitlements per socket.
   */
  private broadcastToRoom(
    clusterId: string,
    event: Parameters<typeof encodeServerMessage>[0],
    data: unknown,
  ): void {
    const room = this.rooms.get(clusterId);
    if (!room || room.size === 0) return;

    const message = encodeServerMessage(event, data);

    for (const entry of room) {
      if (!this.userCanAccessCluster(entry.context.user, clusterId)) continue;
      this.sendRaw(entry.socket, message);
    }
  }

  // ── Initial State Push ────────────────────────────────────────────────

  /**
   * Sends the current cluster snapshot to a newly-subscribed socket,
   * including cluster state, latest member samples, distributed objects,
   * and blitz info.
   */
  private async sendInitialState(socket: RawWebSocket, clusterId: string): Promise<void> {
    const clusterState = this.clusterStateStore.getClusterState(clusterId);
    if (!clusterState) {
      this.sendToSocket(socket, 'cluster:update', {
        clusterId,
        error: 'Cluster not found or not yet connected',
      });
      return;
    }

    // Send cluster state snapshot
    this.sendToSocket(socket, 'cluster:update', {
      clusterId,
      clusterState: serializeClusterState(clusterState),
    });

    // Send latest member samples
    for (const [memberAddr, member] of clusterState.members) {
      if (member.latestSample) {
        this.sendToSocket(socket, 'member:sample', {
          clusterId,
          memberAddr,
          sample: member.latestSample,
        });
      }
    }

    // Send distributed objects and data structure stats
    this.sendToSocket(socket, 'data:update', {
      clusterId,
      distributedObjects: clusterState.distributedObjects,
      mapStats: clusterState.mapStats,
      queueStats: clusterState.queueStats,
      topicStats: clusterState.topicStats,
    });
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  /** Checks if a user is entitled to access a specific cluster. */
  private userCanAccessCluster(user: User, clusterId: string): boolean {
    // Empty clusterScopes means access to all clusters
    if (user.clusterScopes.length === 0) return true;
    return user.clusterScopes.includes(clusterId);
  }

  /** Sends a typed server message to a single socket. */
  private sendToSocket(
    socket: RawWebSocket,
    event: Parameters<typeof encodeServerMessage>[0],
    data: unknown,
  ): void {
    this.sendRaw(socket, encodeServerMessage(event, data));
  }

  /** Sends a pre-encoded message string to a socket. */
  private sendRaw(socket: RawWebSocket, message: string): void {
    if (socket.readyState !== socket.OPEN) return;

    socket.send(message, (err) => {
      if (err) {
        this.logger.debug(`Send failed: ${err.message}`);
      }
    });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extracts the `ticket` query parameter from a WebSocket upgrade URL. */
function extractTicketFromUrl(url: string | undefined): string | null {
  if (!url) return null;

  try {
    // The URL may be relative (e.g., /ws?ticket=xxx) — use a dummy base
    const parsed = new URL(url, 'http://localhost');
    return parsed.searchParams.get('ticket');
  } catch {
    return null;
  }
}

/**
 * Serializes a ClusterState for transmission, converting the members Map
 * to a plain object and stripping the in-memory sample ring buffer.
 */
function serializeClusterState(state: ClusterState): Record<string, unknown> {
  const members: Record<string, unknown> = {};

  for (const [addr, member] of state.members) {
    members[addr] = {
      address: member.address,
      restAddress: member.restAddress,
      connected: member.connected,
      lastSeen: member.lastSeen,
      info: member.info,
      error: member.error,
      // Only include latestSample, not the full recentSamples ring
      latestSample: member.latestSample,
    };
  }

  return {
    clusterId: state.clusterId,
    clusterName: state.clusterName,
    clusterState: state.clusterState,
    clusterSize: state.clusterSize,
    members,
    distributedObjects: state.distributedObjects,
    partitions: state.partitions,
    blitz: state.blitz ?? null,
    lastUpdated: state.lastUpdated,
  };
}
