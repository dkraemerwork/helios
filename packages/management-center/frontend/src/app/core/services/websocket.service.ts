import { Injectable, PLATFORM_ID, inject, signal, NgZone } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, Subject, filter, map, share } from 'rxjs';
import { AuthService } from './auth.service';

// ── Protocol Types ───────────────────────────────────────────────────────────

interface WsMessage {
  event: string;
  data: unknown;
}

type ClientMessageEvent = 'subscribe' | 'unsubscribe' | 'query:history';

interface WsSubscribePayload {
  clusterId: string;
  scope?: 'all' | string;
}

interface WsUnsubscribePayload {
  clusterId: string;
}

interface WsHistoryQueryPayload {
  requestId: string;
  clusterId: string;
  memberAddr: string | null;
  from: number;
  to: number;
  maxPoints: number;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

// ── Constants ────────────────────────────────────────────────────────────────

const HEARTBEAT_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_BACKOFF_FACTOR = 1.5;

/** Close codes that indicate an auth failure — do not retry with the same ticket. */
const AUTH_FAILURE_CODES = new Set([4000, 4001, 4003]);

/**
 * WebSocket service for real-time cluster updates.
 *
 * SSR-safe: all WebSocket operations are skipped when running on the server.
 * Implements automatic heartbeat response and reconnection with exponential backoff.
 * Tickets are one-time-use, so a fresh ticket is fetched from the server on every
 * reconnect attempt (both after normal disconnects and auth-failure close codes).
 */

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly zone = inject(NgZone);
  private readonly authService = inject(AuthService);

  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private manualClose = false;

  /** All incoming messages as a hot observable. */
  private readonly messages$ = new Subject<WsMessage>();

  /** Current connection state signal. */
  readonly connectionState = signal<ConnectionState>('disconnected');

  /** Active subscriptions for resubscribe after reconnect. */
  private readonly activeSubscriptions = new Map<string, string>();

  /**
   * Connects to the WebSocket endpoint using a short-lived ticket.
   */
  connect(ticket: string): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.manualClose = false;
    this.doConnect(ticket);
  }

  /**
   * Disconnects and stops reconnection attempts.
   */
  disconnect(): void {
    this.manualClose = true;
    this.clearTimers();
    this.activeSubscriptions.clear();

    if (this.ws) {
      this.ws.close(1000, 'client disconnect');
      this.ws = null;
    }

    this.connectionState.set('disconnected');
  }

  /**
   * Subscribes to cluster updates.
   */
  subscribe(clusterId: string, scope: 'all' | string = 'all'): void {
    this.activeSubscriptions.set(clusterId, scope);
    this.send('subscribe', { clusterId, scope } satisfies WsSubscribePayload);
  }

  /**
   * Unsubscribes from cluster updates.
   */
  unsubscribe(clusterId: string): void {
    this.activeSubscriptions.delete(clusterId);
    this.send('unsubscribe', { clusterId } satisfies WsUnsubscribePayload);
  }

  /**
   * Queries historical metric data via the WebSocket channel.
   */
  queryHistory(params: {
    requestId: string;
    clusterId: string;
    memberAddr: string | null;
    from: number;
    to: number;
    maxPoints: number;
  }): void {
    this.send('query:history', params satisfies WsHistoryQueryPayload);
  }

  /**
   * Returns an observable stream of messages for a specific server event type.
   */
  onMessage<T>(event: string): Observable<T> {
    return this.messages$.pipe(
      filter(msg => msg.event === event),
      map(msg => msg.data as T),
      share(),
    );
  }

  // ── Private ────────────────────────────────────────────────────────────

  private doConnect(ticket: string): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.connectionState.set(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws?ticket=${encodeURIComponent(ticket)}`;

    // Run WebSocket creation outside Angular zone to avoid excessive change detection
    this.zone.runOutsideAngular(() => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.zone.run(() => {
          this.connectionState.set('connected');
          this.reconnectAttempts = 0;
          this.resubscribeAll();
        });
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string) as WsMessage;
          this.handleMessage(msg);
        } catch {
          // Ignore malformed messages
        }
      };

      this.ws.onclose = (event: CloseEvent) => {
        this.zone.run(() => {
          this.clearHeartbeatTimer();

          if (!this.manualClose && event.code !== 1000) {
            // Auth failures need a fresh ticket — fetch one then reconnect.
            // All other disconnects reconnect with exponential backoff.
            if (AUTH_FAILURE_CODES.has(event.code)) {
              this.scheduleReconnectWithFreshTicket();
            } else {
              this.scheduleReconnect();
            }
          } else {
            this.connectionState.set('disconnected');
          }
        });
      };

      this.ws.onerror = () => {
        // onclose will fire after onerror, so reconnect is handled there
      };
    });
  }

  private handleMessage(msg: WsMessage): void {
    if (msg.event === 'ws:ping') {
      this.send('ws:pong' as ClientMessageEvent, {});
      this.resetHeartbeatTimer();
      return;
    }

    this.zone.run(() => {
      this.messages$.next(msg);
    });
  }

  private send(event: ClientMessageEvent | 'ws:pong', data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }));
    }
  }

  private resubscribeAll(): void {
    for (const [clusterId, scope] of this.activeSubscriptions) {
      this.send('subscribe', { clusterId, scope } satisfies WsSubscribePayload);
    }
  }

  /**
   * Schedules a reconnect attempt for transient disconnects (network blip,
   * server restart, etc.). Uses the same auth session — no new ticket needed
   * because the previous ticket was already consumed on connect, not on close.
   */
  private scheduleReconnect(): void {
    this.connectionState.set('reconnecting');
    this.reconnectAttempts++;

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(RECONNECT_BACKOFF_FACTOR, this.reconnectAttempts - 1),
      RECONNECT_MAX_MS,
    );

    this.reconnectTimer = setTimeout(() => {
      this.scheduleReconnectWithFreshTicket();
    }, delay);
  }

  /**
   * Fetches a fresh one-time ticket from the server and reconnects.
   * Used both for auth-failure close codes and for normal reconnects
   * (tickets are one-time-use, so a new one is always required).
   */
  private scheduleReconnectWithFreshTicket(): void {
    this.connectionState.set('reconnecting');

    this.authService.requestWsTicket().then(ticket => {
      if (!this.manualClose) {
        this.doConnect(ticket);
      }
    }).catch(() => {
      if (!this.manualClose) {
        this.scheduleReconnect();
      }
    });
  }

  private resetHeartbeatTimer(): void {
    this.clearHeartbeatTimer();

    this.heartbeatTimer = setTimeout(() => {
      // Missed heartbeat — server may have disconnected
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.close(4000, 'heartbeat timeout');
      }
    }, HEARTBEAT_TIMEOUT_MS * 2);
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer !== null) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearHeartbeatTimer();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
