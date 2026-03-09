/**
 * Heartbeat lifecycle manager for WebSocket connections.
 *
 * Maintains a registry of connected sockets with their session context.
 * Periodically sends ws:ping messages and checks for missed pongs. Sockets
 * that miss WS_MAX_MISSED_HEARTBEATS consecutive heartbeats are terminated.
 * Also revalidates sessions on each heartbeat cycle — if a session has been
 * revoked or expired, the socket is closed immediately.
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SessionService } from '../auth/SessionService.js';
import { encodeServerMessage } from './WsProtocol.js';
import {
  WS_HEARTBEAT_INTERVAL_MS,
  WS_MAX_MISSED_HEARTBEATS,
} from '../shared/constants.js';

/** Internal tracking state for a single WebSocket connection. */
interface SocketEntry {
  sessionId: string;
  userId: string;
  lastPongAt: number;
  missedHeartbeats: number;
}

/**
 * Minimal interface for the raw WebSocket object provided by @nestjs/platform-ws.
 * Avoids depending on @types/ws which is not installed.
 */
interface RawWebSocket {
  readyState: number;
  send(data: string, cb?: (err?: Error) => void): void;
  close(code?: number, reason?: string): void;
  OPEN: number;
}

@Injectable()
export class WsHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WsHeartbeatService.name);
  private readonly sockets = new Map<RawWebSocket, SocketEntry>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly sessionService: SessionService) {}

  onModuleInit(): void {
    this.heartbeatTimer = setInterval(() => {
      this.tick();
    }, WS_HEARTBEAT_INTERVAL_MS);

    this.logger.log(
      `Heartbeat service started (interval=${WS_HEARTBEAT_INTERVAL_MS}ms, ` +
        `maxMissed=${WS_MAX_MISSED_HEARTBEATS})`,
    );
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Registers a newly connected socket for heartbeat tracking. */
  register(socket: RawWebSocket, sessionId: string, userId: string): void {
    this.sockets.set(socket, {
      sessionId,
      userId,
      lastPongAt: Date.now(),
      missedHeartbeats: 0,
    });
  }

  /** Removes a socket from heartbeat tracking. */
  unregister(socket: RawWebSocket): void {
    this.sockets.delete(socket);
  }

  /** Records a pong response, resetting the missed-heartbeat counter. */
  handlePong(socket: RawWebSocket): void {
    const entry = this.sockets.get(socket);
    if (entry) {
      entry.lastPongAt = Date.now();
      entry.missedHeartbeats = 0;
    }
  }

  /** Returns the number of currently tracked sockets (for self-metrics). */
  get activeSocketCount(): number {
    return this.sockets.size;
  }

  /**
   * Heartbeat tick: sends ws:ping to all connected sockets, increments
   * missed counters, closes stale connections, and revalidates sessions.
   */
  private tick(): void {
    const pingMessage = encodeServerMessage('ws:ping', { ts: Date.now() });

    for (const [socket, entry] of this.sockets) {
      // Check if the socket is still open (readyState 1 = OPEN for ws lib)
      if (socket.readyState !== socket.OPEN) {
        this.sockets.delete(socket);
        continue;
      }

      // Increment missed heartbeats before sending new ping
      entry.missedHeartbeats++;

      if (entry.missedHeartbeats > WS_MAX_MISSED_HEARTBEATS) {
        this.logger.warn(
          `Socket for user=${entry.userId} session=${entry.sessionId} ` +
            `missed ${entry.missedHeartbeats} heartbeats, closing`,
        );
        this.sockets.delete(socket);
        socket.close(4001, 'Heartbeat timeout');
        continue;
      }

      // Send ping
      socket.send(pingMessage, (err) => {
        if (err) {
          this.logger.debug(`Failed to send ping to user=${entry.userId}: ${err.message}`);
          this.sockets.delete(socket);
          socket.close(1011, 'Ping delivery failed');
        }
      });

      // Revalidate session asynchronously
      this.revalidateSession(socket, entry);
    }
  }

  /**
   * Checks whether the session is still valid. Closes the socket immediately
   * if the session has been revoked, expired, or the user is disabled.
   */
  private revalidateSession(socket: RawWebSocket, entry: SocketEntry): void {
    this.sessionService.getSession(entry.sessionId).then((result) => {
      if (!result) {
        this.logger.warn(
          `Session ${entry.sessionId} for user=${entry.userId} is no longer valid, closing socket`,
        );
        this.sockets.delete(socket);
        socket.close(4003, 'Session expired or revoked');
      }
    }).catch((err) => {
      this.logger.debug(
        `Session revalidation failed for ${entry.sessionId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
}
