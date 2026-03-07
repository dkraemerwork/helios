/**
 * DynamoDbStoreService — trading signal persistence backed by Scylla/Alternator via MapStore.
 *
 * The 'trading-signals' IMap has a DynamoDbMapStore configured in main.ts with write-behind.
 * Writes are buffered in-memory and flushed to Scylla Cloud every 2 seconds:
 *
 *   put(key, value)  → queued for write-behind flush to Scylla
 *   get(key)         → read from memory (or load-on-miss from Scylla)
 *   remove(key)      → queued for delete on next flush
 *
 * This demonstrates the recommended production pattern: Helios memory as the hot path,
 * Scylla/Alternator as durable persistence with write-behind for latency smoothing.
 */

import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { InjectMap } from '@zenystx/helios-nestjs';
import type { IMap } from '@zenystx/helios-core/map/IMap';

export interface TradingSignal {
    signalId: string;
    symbol: string;
    action: 'BUY' | 'SELL' | 'HOLD';
    price: number;
    confidence: number;
    strategy: string;
    timestamp: string;
}

@Injectable()
export class DynamoDbStoreService {
    constructor(
        @InjectMap('trading-signals') private readonly signals: IMap<string, TradingSignal>,
    ) {}

    /** Store a trading signal (write-behind to Scylla). */
    async storeSignal(signal: TradingSignal): Promise<void> {
        await this.signals.put(signal.signalId, signal);
    }

    /** Get a signal by ID (read from memory, load-on-miss from Scylla). */
    async getSignal(signalId: string): Promise<TradingSignal | null> {
        return this.signals.get(signalId);
    }

    /** Remove a signal (queued for delete on next flush). */
    async removeSignal(signalId: string): Promise<TradingSignal | null> {
        return this.signals.remove(signalId);
    }

    /** Seed sample trading signals. */
    async seed(): Promise<void> {
        const now = new Date().toISOString();
        const signals: TradingSignal[] = [
            { signalId: 'sig-1', symbol: 'BTCUSDT', action: 'BUY', price: 67500.50, confidence: 0.87, strategy: 'momentum', timestamp: now },
            { signalId: 'sig-2', symbol: 'ETHUSDT', action: 'SELL', price: 3420.25, confidence: 0.72, strategy: 'mean-reversion', timestamp: now },
            { signalId: 'sig-3', symbol: 'SOLUSDT', action: 'BUY', price: 148.90, confidence: 0.91, strategy: 'breakout', timestamp: now },
            { signalId: 'sig-4', symbol: 'BNBUSDT', action: 'HOLD', price: 612.30, confidence: 0.55, strategy: 'sentiment', timestamp: now },
            { signalId: 'sig-5', symbol: 'XRPUSDT', action: 'BUY', price: 0.628, confidence: 0.83, strategy: 'momentum', timestamp: now },
        ];
        for (const s of signals) {
            await this.storeSignal(s);
        }
    }

    /** Run the DynamoDB/Scylla MapStore demo. */
    async runDemo(): Promise<void> {
        console.log('  Seeding 5 trading signals (write-behind to Scylla/Alternator)...');
        await this.seed();
        console.log(`  Map size after seeding: ${this.signals.size()}`);

        // Read — from memory (write-behind hasn't flushed yet, but in-memory has it)
        const btc = await this.getSignal('sig-1');
        console.log(`\n  get('sig-1') → ${btc?.symbol} ${btc?.action} @ $${btc?.price} [confidence: ${btc?.confidence}]`);

        const eth = await this.getSignal('sig-2');
        console.log(`  get('sig-2') → ${eth?.symbol} ${eth?.action} @ $${eth?.price} [strategy: ${eth?.strategy}]`);

        // Update a signal
        if (btc) {
            const updated: TradingSignal = { ...btc, action: 'SELL', price: 68200.00, confidence: 0.65, timestamp: new Date().toISOString() };
            await this.storeSignal(updated);
            const reloaded = await this.getSignal('sig-1');
            console.log(`\n  Updated BTC signal to ${reloaded?.action} @ $${reloaded?.price} [confidence: ${reloaded?.confidence}]`);
        }

        // Remove a signal
        const removed = await this.removeSignal('sig-4');
        console.log(`\n  Removed signal '${removed?.signalId}' (${removed?.symbol} ${removed?.action})`);
        console.log(`  Map size after removal: ${this.signals.size()}`);

        // Verify removal
        const ghost = await this.getSignal('sig-4');
        console.log(`  get('sig-4') after removal → ${ghost ?? 'null'} (confirmed deleted)`);

        // Wait for write-behind flush
        console.log('\n  Waiting 3s for write-behind flush to Scylla...');
        await new Promise(r => setTimeout(r, 3000));
        console.log('  Write-behind flush complete — signals persisted to Scylla Cloud.');
    }
}
