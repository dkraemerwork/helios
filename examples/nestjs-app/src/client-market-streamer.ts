#!/usr/bin/env bun
/**
 * client-market-streamer.ts — Standalone NATS client that streams Binance
 * market data directly into the embedded NATS cluster.
 *
 * Architecture:
 *   Binance WS → normalize to Quote → nc.publish('market.ticks', JSON)
 *
 * No Hazelcast remote client needed. No binary protocol. No partition load.
 * Pure NATS publish — sub-microsecond per message.
 *
 * Uses BlitzService.connect() to get a raw NATS connection to the embedded
 * NATS server running inside the NestJS app. This avoids needing
 * @nats-io/transport-node as a direct dependency.
 *
 * The NestJS app's BinanceQuotesService (in NATS mode) consumes from
 * the same 'market.ticks' subject and materializes into the IMap.
 *
 * Usage:
 *   # Terminal 1: Start the NestJS app (Helios + embedded NATS + consumer)
 *   bun run start
 *
 *   # Terminal 2: Start this streamer
 *   bun run stream
 *
 *   # Or with custom symbols:
 *   bun run stream -- BTCUSDT ETHUSDT SOLUSDT
 */

import { BlitzService } from '@zenystx/helios-blitz';
import { BinanceWebSocketSource, toQuote } from './binance-quotes/binance-ws.source';

// ── Configuration ─────────────────────────────────────────────────────────────

const NATS_URL = process.env['NATS_URL'] ?? 'nats://localhost:4222';
const SUBJECT = 'market.ticks';

// Parse symbols from CLI args (skip 'bun', 'run', 'src/...', '--')
const cliSymbols = process.argv
    .slice(2)
    .filter(a => a !== '--' && !a.startsWith('-'))
    .map(s => s.toUpperCase());

const symbols = cliSymbols.length > 0
    ? cliSymbols
    : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  Helios Market Data Streamer (NATS client)              ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log(`  NATS server:   ${NATS_URL}`);
console.log(`  NATS subject:  ${SUBJECT}`);
console.log(`  Symbols:       ${symbols.join(', ')}`);
console.log('');

// Connect to the embedded NATS server via BlitzService (lightweight — no embedded spawn)
console.log('  Connecting to NATS...');
const blitz = await BlitzService.connect({ servers: NATS_URL, connectTimeoutMs: 5_000 });
const nc = blitz.nc;
console.log('  Connected.\n');

// Encoder for NATS payload
const encoder = new TextEncoder();

// Metrics
let ticksPublished = 0;
const startedAt = Date.now();

// Graceful shutdown
const ac = new AbortController();
let shuttingDown = false;

const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log('\n\n  Shutting down...');
    ac.abort();

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`  Total ticks published: ${ticksPublished.toLocaleString()}`);
    console.log(`  Duration:              ${elapsed}s`);
    console.log(`  Throughput:            ${(ticksPublished / parseFloat(elapsed)).toFixed(1)} ticks/sec`);

    await blitz.shutdown();
    console.log('  NATS connection drained. Goodbye.\n');
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start the Binance WebSocket source
console.log('  Streaming started — press Ctrl+C to stop.\n');

const source = BinanceWebSocketSource.miniTicker(ac.signal, symbols);

// Status line timer — print throughput every 2 seconds
const statusTimer = setInterval(() => {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
    const rate = (ticksPublished / parseFloat(elapsed || '1')).toFixed(1);
    process.stdout.write(
        `\r  [${elapsed}s] published: ${ticksPublished.toLocaleString().padStart(8)} | ${rate} ticks/sec`,
    );
}, 2_000);

try {
    for await (const msg of source.messages()) {
        const quote = toQuote(msg.value);
        const payload = encoder.encode(JSON.stringify(quote));
        nc.publish(SUBJECT, payload);
        ticksPublished++;
        msg.ack();
    }
} catch (err) {
    if (!shuttingDown) {
        console.error('\n  Stream error:', err);
    }
} finally {
    clearInterval(statusTimer);
}

await shutdown();
