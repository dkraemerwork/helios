/**
 * BinanceQuotesService — production-grade NestJS service that materializes
 * real-time market data into a Helios IMap via a write-coalescing accumulator.
 *
 * Supports two ingestion modes:
 *
 *   1. **Direct WebSocket** (start):
 *      Binance WS → normalize → accumulator → periodic flush → IMap
 *
 *   2. **NATS subject** (startFromNats):
 *      NatsSource('market.ticks') → accumulator → periodic flush → IMap
 *      An external client publishes ticks to the embedded NATS cluster.
 *      The Helios instance's main thread is completely unaffected.
 *
 * Both modes share the same accumulator → flush → IMap write path.
 * The IMap is NOT hammered on every tick — the accumulator collapses
 * all ticks for a symbol into the latest quote, and the flush interval
 * controls write frequency.
 */

import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { JsonCodec, NatsSource } from '@zenystx/helios-blitz';
import type { HeliosBlitzService } from '@zenystx/helios-blitz/nestjs';
import { InjectBlitz } from '@zenystx/helios-blitz/nestjs';
import type { HeliosInstance } from '@zenystx/helios-core/core/HeliosInstance';
import type { IMap } from '@zenystx/helios-core/map/IMap';
import { InjectHelios, InjectMap } from '@zenystx/helios-nestjs';
import { BinanceWebSocketSource, toQuote, type Quote } from './binance-ws.source';

// ── Metrics ───────────────────────────────────────────────────────────────────

export interface QuotePipelineMetrics {
    /** Total raw ticks received. */
    ticksReceived: number;
    /** Number of flush cycles executed. */
    flushCount: number;
    /** Total individual quote writes to the IMap across all flushes. */
    quotesWritten: number;
    /** Number of unique symbols currently tracked. */
    symbolsTracked: number;
    /** Pipeline uptime in milliseconds. */
    uptimeMs: number;
    /** Ingestion mode. */
    mode: 'ws' | 'nats' | 'idle';
}

// ── Service ───────────────────────────────────────────────────────────────────

const DEFAULT_FLUSH_INTERVAL_MS = 2_000;
const NATS_SUBJECT = 'market.ticks';

@Injectable()
export class BinanceQuotesService implements OnModuleDestroy {
    private _abortController: AbortController | null = null;
    private _flushTimer: ReturnType<typeof setInterval> | null = null;
    private _running = false;
    private _startedAt = 0;
    private _mode: 'ws' | 'nats' | 'idle' = 'idle';

    // ── Accumulator: latest quote per symbol (write-coalescing buffer) ─────
    private readonly _buffer = new Map<string, Quote>();

    // ── Metrics ───────────────────────────────────────────────────────────
    private _ticksReceived = 0;
    private _flushCount = 0;
    private _quotesWritten = 0;
    private readonly _allSymbols = new Set<string>();

    constructor(
        @InjectHelios() private readonly _helios: HeliosInstance,
        @InjectBlitz() private readonly _blitz: HeliosBlitzService,
        @InjectMap('quotes') private readonly _quotesMap: IMap<string, Quote>,
    ) {}

    // ── Mode 1: Direct WebSocket ──────────────────────────────────────────

    /**
     * Start consuming Binance mini-ticker quotes directly via WebSocket.
     *
     * @param symbols         Optional symbol filter (e.g. ['BTCUSDT', 'ETHUSDT']).
     * @param flushIntervalMs Flush interval in ms (default: 2000).
     */
    async start(symbols?: string[], flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS): Promise<void> {
        if (this._running) return;
        this._reset('ws');

        const source = BinanceWebSocketSource.miniTicker(this._abortController!.signal, symbols);
        this._consumeWsLoop(source);
        this._startFlushTimer(flushIntervalMs);
    }

    // ── Mode 2: NATS subject consumer ─────────────────────────────────────

    /**
     * Start consuming quotes from the NATS subject 'market.ticks'.
     *
     * An external client publishes normalized Quote JSON to this subject.
     * The Blitz embedded NATS server receives the messages and this service
     * consumes them via NatsSource — no Helios binary protocol overhead.
     *
     * @param flushIntervalMs Flush interval in ms (default: 2000).
     */
    async startFromNats(flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS): Promise<void> {
        if (this._running) return;
        this._reset('nats');

        const source = NatsSource.fromSubject<Quote>(this._blitz.blitz.nc, NATS_SUBJECT, JsonCodec<Quote>());
        this._consumeNatsLoop(source);
        this._startFlushTimer(flushIntervalMs);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    /** Stop the pipeline gracefully. Performs a final flush before shutdown. */
    async stop(): Promise<void> {
        if (!this._running) return;

        this._running = false;
        this._abortController?.abort();

        if (this._flushTimer !== null) {
            clearInterval(this._flushTimer);
            this._flushTimer = null;
        }

        await this._flush();
        this._mode = 'idle';
    }

    get isRunning(): boolean {
        return this._running;
    }

    /** Current pipeline metrics. */
    getMetrics(): QuotePipelineMetrics {
        return {
            ticksReceived: this._ticksReceived,
            flushCount: this._flushCount,
            quotesWritten: this._quotesWritten,
            symbolsTracked: this._allSymbols.size,
            uptimeMs: this._running ? Date.now() - this._startedAt : 0,
            mode: this._mode,
        };
    }

    // ── Read accessors (query the materialized view) ──────────────────────

    async getQuote(symbol: string): Promise<Quote | null> {
        return this._quotesMap.get(symbol.toUpperCase());
    }

    getSymbols(): string[] {
        return [...this._quotesMap.keySet()];
    }

    getQuoteCount(): number {
        return this._quotesMap.size();
    }

    getAllQuotes(): Quote[] {
        return [...this._quotesMap.values()];
    }

    getTopByVolume(n: number): Quote[] {
        return this.getAllQuotes()
            .sort((a, b) => b.quoteVolume - a.quoteVolume)
            .slice(0, n);
    }

    async onModuleDestroy(): Promise<void> {
        await this.stop();
    }

    // ── Internal: shared state reset ──────────────────────────────────────

    private _reset(mode: 'ws' | 'nats'): void {
        this._abortController = new AbortController();
        this._running = true;
        this._startedAt = Date.now();
        this._ticksReceived = 0;
        this._flushCount = 0;
        this._quotesWritten = 0;
        this._allSymbols.clear();
        this._buffer.clear();
        this._mode = mode;
    }

    // ── Internal: consumer loops ──────────────────────────────────────────

    private _consumeWsLoop(source: ReturnType<typeof BinanceWebSocketSource.miniTicker>): void {
        (async () => {
            try {
                for await (const msg of source.messages()) {
                    this._ticksReceived++;
                    const quote = toQuote(msg.value);
                    this._allSymbols.add(quote.symbol);
                    this._buffer.set(quote.symbol, quote);
                    msg.ack();
                }
            } catch (err) {
                if (!this._running) return;
                if (err instanceof Error && err.name === 'AbortError') return;
                console.error('  [BinanceQuotes] WS consumer error:', err);
            }
        })();
    }

    private _consumeNatsLoop(source: ReturnType<typeof NatsSource.fromSubject<Quote>>): void {
        (async () => {
            try {
                for await (const msg of source.messages()) {
                    this._ticksReceived++;
                    const quote = msg.value;
                    this._allSymbols.add(quote.symbol);
                    this._buffer.set(quote.symbol, quote);
                    msg.ack();
                }
            } catch (err) {
                if (!this._running) return;
                console.error('  [BinanceQuotes] NATS consumer error:', err);
            }
        })();
    }

    // ── Internal: flush timer + flush logic ───────────────────────────────

    private _startFlushTimer(intervalMs: number): void {
        this._flushTimer = setInterval(() => {
            this._flush().catch(err => {
                console.error('  [BinanceQuotes] Flush error:', err);
            });
        }, intervalMs);
    }

    private async _flush(): Promise<void> {
        if (this._buffer.size === 0) return;

        const snapshot = new Map(this._buffer);
        this._buffer.clear();

        const writes: Promise<unknown>[] = [];
        for (const [symbol, quote] of snapshot) {
            writes.push(this._quotesMap.put(symbol, quote));
        }
        await Promise.all(writes);

        this._quotesWritten += snapshot.size;
        this._flushCount++;
    }
}
