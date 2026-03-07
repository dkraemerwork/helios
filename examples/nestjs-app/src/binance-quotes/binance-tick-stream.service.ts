/**
 * BinanceTickStreamService — hot-path consumer that reads the raw Binance
 * WebSocket tick stream via the Blitz Source API and emits every single tick.
 *
 * This is the counterpart to BinanceQuotesService (the warm path).
 * Where the quotes service coalesces and flushes to an IMap at a controlled
 * rate, this service delivers full-fidelity, per-tick data to registered
 * listeners with zero buffering.
 *
 * Use cases:
 *   - Real-time logging / audit trail
 *   - Tick-level analytics (VWAP, micro-structure)
 *   - Alerting on price thresholds
 *   - Feeding downstream Blitz pipelines via ITopic
 *
 * Architecture:
 *   Binance WS → BinanceWebSocketSource (Blitz Source<T>)
 *     → for-await loop → normalize → emit to listeners + optional console log
 *
 * No IMap writes. No batching. Every tick hits the listeners immediately.
 */

import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { BinanceWebSocketSource, toQuote, type Quote } from './binance-ws.source';

// ── Listener types ────────────────────────────────────────────────────────────

/** Callback invoked on every raw tick. */
export type TickListener = (quote: Quote) => void;

/** Stream metrics exposed for observability. */
export interface TickStreamMetrics {
    /** Total ticks delivered to listeners. */
    ticksEmitted: number;
    /** Number of registered listeners. */
    listenerCount: number;
    /** Unique symbols seen. */
    symbolsSeen: number;
    /** Stream uptime in milliseconds. */
    uptimeMs: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class BinanceTickStreamService implements OnModuleDestroy {
    private _abortController: AbortController | null = null;
    private _running = false;
    private _startedAt = 0;
    private _stoppedAt = 0;
    private _ticksEmitted = 0;
    private _logToConsole = false;
    private readonly _listeners: TickListener[] = [];
    private readonly _symbolsSeen = new Set<string>();

    /**
     * Start the raw tick stream.
     *
     * @param symbols        Optional symbol filter (e.g. ['BTCUSDT']).
     * @param logToConsole   If true, logs each tick to stdout (demo/debug use).
     */
    async start(symbols?: string[], logToConsole = false): Promise<void> {
        if (this._running) return;

        this._abortController = new AbortController();
        this._running = true;
        this._startedAt = Date.now();
        this._ticksEmitted = 0;
        this._logToConsole = logToConsole;
        this._symbolsSeen.clear();

        const source = BinanceWebSocketSource.miniTicker(this._abortController.signal, symbols);
        this._consumeLoop(source);
    }

    /** Stop the tick stream gracefully. */
    async stop(): Promise<void> {
        if (!this._running) return;
        this._stoppedAt = Date.now();
        this._running = false;
        this._abortController?.abort();
    }

    /** Whether the stream is active. */
    get isRunning(): boolean {
        return this._running;
    }

    /**
     * Register a tick listener. Called on every raw tick with the normalized Quote.
     * Returns an unsubscribe function.
     */
    onTick(listener: TickListener): () => void {
        this._listeners.push(listener);
        return () => {
            const idx = this._listeners.indexOf(listener);
            if (idx !== -1) this._listeners.splice(idx, 1);
        };
    }

    /** Current stream metrics. */
    getMetrics(): TickStreamMetrics {
        return {
            ticksEmitted: this._ticksEmitted,
            listenerCount: this._listeners.length,
            symbolsSeen: this._symbolsSeen.size,
            uptimeMs: this._running
                ? Date.now() - this._startedAt
                : this._stoppedAt - this._startedAt,
        };
    }

    /** NestJS lifecycle. */
    async onModuleDestroy(): Promise<void> {
        await this.stop();
    }

    // ── Internal: raw consumer loop ───────────────────────────────────────

    private _consumeLoop(source: ReturnType<typeof BinanceWebSocketSource.miniTicker>): void {
        (async () => {
            try {
                for await (const msg of source.messages()) {
                    const quote = toQuote(msg.value);
                    this._ticksEmitted++;
                    this._symbolsSeen.add(quote.symbol);

                    // Console logging (demo mode)
                    if (this._logToConsole) {
                        const dir = quote.price >= quote.open ? '\u2191' : '\u2193';
                        const change = ((quote.price - quote.open) / quote.open * 100);
                        const changeStr = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
                        console.log(
                            `  ${dir} ${quote.symbol.padEnd(10)} ` +
                            `$${quote.price.toFixed(2).padStart(12)}  ` +
                            `${changeStr.padStart(8)}  ` +
                            `H: ${quote.high.toFixed(2)} L: ${quote.low.toFixed(2)}  ` +
                            `vol: $${(quote.quoteVolume / 1e6).toFixed(1)}M`,
                        );
                    }

                    // Emit to all registered listeners
                    for (const listener of this._listeners) {
                        try {
                            listener(quote);
                        } catch {
                            // Swallow listener errors — don't let one bad listener kill the stream
                        }
                    }

                    msg.ack();
                }
            } catch (err) {
                if (!this._running) return;
                if (err instanceof Error && err.name === 'AbortError') return;
                console.error('  [TickStream] Consumer loop error:', err);
            }
        })();
    }
}
