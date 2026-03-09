/**
 * SSE client for connecting to a single Helios member's monitoring endpoint.
 *
 * Uses fetch() + ReadableStream + AbortController (never EventSource) to
 * consume server-sent events. Implements reconnection with capped exponential
 * backoff, skipping reconnect for permanent failures (401/403/404). All
 * lifecycle events are dispatched via typed callbacks.
 */

import { Logger } from '@nestjs/common';
import { parseSseStream } from './SseStreamParser.js';
import type { MonitorPayload, MemberMetricsSample } from '../shared/types.js';
import { isHeliosPayload, normalizeHeliosPayload } from './normalizePayload.js';

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

/** HTTP status codes that indicate permanent failures (no reconnect). */
const PERMANENT_FAILURE_CODES = new Set([401, 403, 404]);

export interface MemberSseClientOptions {
  memberAddr: string;
  restUrl: string;
  authToken?: string;
  requestTimeoutMs: number;
  onInit: (payload: MonitorPayload) => void;
  onSample: (sample: MemberMetricsSample) => void;
  onPayload: (payload: MonitorPayload) => void;
  onError: (error: string) => void;
  onDisconnect: () => void;
  onReconnect: (attempt: number) => void;
}

export class MemberSseClient {
  private readonly logger: Logger;
  private readonly abortController: AbortController;
  private reconnectAttempt = 0;
  private running = false;
  private disconnectRequested = false;

  constructor(private readonly options: MemberSseClientOptions) {
    this.logger = new Logger(`MemberSseClient[${options.memberAddr}]`);
    this.abortController = new AbortController();
  }

  /** Starts the SSE connection loop. Non-blocking — runs in background. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.disconnectRequested = false;
    this.connectionLoop().catch((err) => {
      if (!this.disconnectRequested) {
        this.logger.error(`Connection loop terminated unexpectedly: ${errorMsg(err)}`);
      }
    });
  }

  /** Gracefully stops the SSE connection and prevents reconnection. */
  disconnect(): void {
    this.disconnectRequested = true;
    this.running = false;
    this.abortController.abort();
  }

  /** Returns whether the client is still actively running. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Returns the member address this client is connected to. */
  get memberAddr(): string {
    return this.options.memberAddr;
  }

  private async connectionLoop(): Promise<void> {
    while (this.running && !this.disconnectRequested) {
      try {
        await this.connectAndConsume();
      } catch (err) {
        if (this.disconnectRequested || this.abortController.signal.aborted) {
          break;
        }

        const message = errorMsg(err);
        this.logger.warn(`SSE connection error: ${message}`);
        this.options.onError(message);
      }

      if (this.disconnectRequested || !this.running) break;

      // Reconnect with capped exponential backoff
      this.reconnectAttempt++;
      const backoff = Math.min(
        BASE_BACKOFF_MS * Math.pow(2, this.reconnectAttempt - 1),
        MAX_BACKOFF_MS,
      );

      this.logger.log(`Reconnecting in ${backoff}ms (attempt ${this.reconnectAttempt})`);
      this.options.onReconnect(this.reconnectAttempt);

      await sleep(backoff, this.abortController.signal);

      if (this.disconnectRequested) break;
    }

    this.running = false;
    this.options.onDisconnect();
  }

  private async connectAndConsume(): Promise<void> {
    const sseUrl = `${this.options.restUrl}/helios/monitor/stream`;
    this.logger.log(`Connecting to ${sseUrl}`);

    const headers: Record<string, string> = {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
    };

    if (this.options.authToken) {
      headers['Authorization'] = `Bearer ${this.options.authToken}`;
    }

    const response = await fetch(sseUrl, {
      method: 'GET',
      headers,
      signal: this.abortController.signal,
      keepalive: true,
    });

    if (!response.ok) {
      const statusText = `HTTP ${response.status} ${response.statusText}`;

      if (PERMANENT_FAILURE_CODES.has(response.status)) {
        this.logger.error(`Permanent failure connecting to ${sseUrl}: ${statusText}`);
        this.options.onError(`Permanent failure: ${statusText}`);
        this.running = false;
        return;
      }

      throw new Error(`SSE connection failed: ${statusText}`);
    }

    if (!response.body) {
      throw new Error('SSE response has no body');
    }

    // Reset reconnect counter on successful connection
    this.reconnectAttempt = 0;
    this.logger.log(`Connected to ${sseUrl}`);

    let isFirstPayload = true;

    for await (const sseEvent of parseSseStream(response.body)) {
      if (this.disconnectRequested) break;

      try {
        this.handleSseEvent(sseEvent.event, sseEvent.data, isFirstPayload);
        if (isFirstPayload && (sseEvent.event === 'message' || sseEvent.event === 'init')) {
          isFirstPayload = false;
        }
      } catch (err) {
        this.logger.warn(`Error processing SSE event "${sseEvent.event}": ${errorMsg(err)}`);
      }
    }
  }

  private handleSseEvent(eventType: string, data: string, isFirst: boolean): void {
    switch (eventType) {
      case 'init':
      case 'message': {
        if (data === '') return;

        const parsed: unknown = JSON.parse(data);

        // Detect if this is a metrics sample or a full payload
        if (isMemberMetricsSample(parsed)) {
          this.options.onSample(parsed as MemberMetricsSample);
        } else if (isHeliosPayload(parsed)) {
          const payload = normalizeHeliosPayload(parsed as Record<string, unknown>);
          if (isFirst) {
            this.options.onInit(payload);
          } else {
            this.options.onPayload(payload);
          }
        }
        break;
      }

      case 'sample': {
        if (data === '') return;
        const sample = JSON.parse(data) as MemberMetricsSample;
        this.options.onSample(sample);
        break;
      }

      case 'payload': {
        if (data === '') return;
        const rawPayload = JSON.parse(data) as Record<string, unknown>;
        this.options.onPayload(normalizeHeliosPayload(rawPayload));
        break;
      }

      default:
        this.logger.debug(`Ignoring unknown SSE event type: ${eventType}`);
        break;
    }
  }
}

/**
 * Type guard: checks if an object looks like a MemberMetricsSample.
 * Presence of `timestamp`, `cpu`, and `memory` is the discriminator.
 */
function isMemberMetricsSample(obj: unknown): obj is MemberMetricsSample {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  return (
    typeof record['timestamp'] === 'number' &&
    typeof record['cpu'] === 'object' &&
    typeof record['memory'] === 'object'
  );
}

function errorMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Sleeps for the specified duration, aborting early if the signal fires.
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}
