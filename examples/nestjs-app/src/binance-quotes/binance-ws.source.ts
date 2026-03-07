/**
 * BinanceWebSocketSource — custom Blitz Source that connects to Binance's
 * public WebSocket API and emits real-time mini-ticker events.
 *
 * Endpoint: wss://stream.binance.com:9443/ws/!miniTicker@arr
 *
 * Each WebSocket frame is an array of 24h mini-ticker objects for all symbols.
 * We flatten it so each yielded SourceMessage contains a single ticker.
 *
 * This is an **unbounded** source — it streams indefinitely until the
 * AbortSignal fires, at which point iteration terminates cleanly.
 */

import type { Source, SourceMessage } from '@zenystx/helios-blitz';
import { JsonCodec, type BlitzCodec } from '@zenystx/helios-blitz';

// ── Binance mini-ticker raw shape ─────────────────────────────────────────────

/** Raw 24hr Mini Ticker event from Binance WebSocket. */
export interface BinanceMiniTicker {
    /** Event type (always '24hrMiniTicker'). */
    e: string;
    /** Event time (unix ms). */
    E: number;
    /** Symbol (e.g. 'BTCUSDT'). */
    s: string;
    /** Close price. */
    c: string;
    /** Open price. */
    o: string;
    /** High price. */
    h: string;
    /** Low price. */
    l: string;
    /** Total traded base asset volume. */
    v: string;
    /** Total traded quote asset volume. */
    q: string;
}

// ── Normalized quote type ─────────────────────────────────────────────────────

/** Normalized quote record stored in the Helios IMap. */
export interface Quote {
    symbol: string;
    price: number;
    open: number;
    high: number;
    low: number;
    volume: number;
    quoteVolume: number;
    timestamp: number;
}

/** Convert a raw Binance mini-ticker to our normalized Quote. */
export function toQuote(ticker: BinanceMiniTicker): Quote {
    return {
        symbol: ticker.s,
        price: parseFloat(ticker.c),
        open: parseFloat(ticker.o),
        high: parseFloat(ticker.h),
        low: parseFloat(ticker.l),
        volume: parseFloat(ticker.v),
        quoteVolume: parseFloat(ticker.q),
        timestamp: ticker.E,
    };
}

// ── Source implementation ──────────────────────────────────────────────────────

const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws/!miniTicker@arr';

class BinanceWebSocketSourceImpl implements Source<BinanceMiniTicker> {
    readonly name = 'binance-ws-source';
    readonly codec: BlitzCodec<BinanceMiniTicker> = JsonCodec<BinanceMiniTicker>();

    private readonly _symbols: Set<string> | null;
    private readonly _signal: AbortSignal;

    constructor(symbols: string[] | undefined, signal: AbortSignal) {
        this._symbols = symbols ? new Set(symbols.map(s => s.toUpperCase())) : null;
        this._signal = signal;
    }

    async *messages(): AsyncIterable<SourceMessage<BinanceMiniTicker>> {
        const pending: BinanceMiniTicker[] = [];
        let resolve: (() => void) | null = null;
        let done = false;

        const ws = new WebSocket(BINANCE_WS_URL);

        // Clean shutdown on abort
        const onAbort = (): void => {
            done = true;
            ws.close();
            resolve?.();
        };
        this._signal.addEventListener('abort', onAbort, { once: true });

        ws.addEventListener('message', (event: MessageEvent) => {
            const tickers: BinanceMiniTicker[] = JSON.parse(
                typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer),
            );

            for (const t of tickers) {
                if (this._symbols === null || this._symbols.has(t.s)) {
                    pending.push(t);
                }
            }

            const r = resolve;
            resolve = null;
            r?.();
        });

        ws.addEventListener('error', () => {
            done = true;
            resolve?.();
        });

        ws.addEventListener('close', () => {
            done = true;
            resolve?.();
        });

        // Wait for open
        await new Promise<void>((res, rej) => {
            ws.addEventListener('open', () => res(), { once: true });
            ws.addEventListener('error', () => rej(new Error('Binance WebSocket connection failed')), { once: true });
            if (this._signal.aborted) {
                rej(new Error('Aborted before connect'));
            }
        });

        try {
            while (!done) {
                if (pending.length > 0) {
                    const value = pending.shift()!;
                    yield { value, ack: () => {}, nak: () => {} };
                } else {
                    await new Promise<void>(r => { resolve = r; });
                }
            }

            // Drain remaining
            while (pending.length > 0) {
                const value = pending.shift()!;
                yield { value, ack: () => {}, nak: () => {} };
            }
        } finally {
            this._signal.removeEventListener('abort', onAbort);
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        }
    }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/** Factory for the Binance WebSocket streaming source. */
export const BinanceWebSocketSource = {
    /**
     * Connect to Binance's public mini-ticker stream.
     *
     * @param signal   AbortSignal to stop the stream gracefully.
     * @param symbols  Optional list of symbols to filter (e.g. ['BTCUSDT', 'ETHUSDT']).
     *                 If omitted, all symbols are emitted.
     */
    miniTicker(signal: AbortSignal, symbols?: string[]): Source<BinanceMiniTicker> {
        return new BinanceWebSocketSourceImpl(symbols, signal);
    },
};
