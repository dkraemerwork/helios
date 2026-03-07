/**
 * BinanceQuotesModule — two consumption patterns for Binance market data:
 *
 * 1. **Warm path** (BinanceQuotesService):
 *    WS → write-coalescing accumulator → periodic flush → IMap('quotes')
 *    Low-frequency materialized view. Any module can @InjectMap('quotes').
 *
 * 2. **Hot path** (BinanceTickStreamService):
 *    WS → Blitz Source → for-await loop → emit every tick to listeners
 *    Full-fidelity, zero-buffer, per-tick delivery. No IMap writes.
 */

import { Module } from '@nestjs/common';
import { HeliosObjectExtractionModule } from '@zenystx/helios-nestjs';
import { BinanceQuotesService } from './binance-quotes.service';
import { BinanceTickStreamService } from './binance-tick-stream.service';

@Module({
    imports: [
        // Expose the 'quotes' IMap as an injectable provider.
        HeliosObjectExtractionModule.forRoot({
            namedMaps: ['quotes'],
        }),
    ],
    providers: [BinanceQuotesService, BinanceTickStreamService],
    exports: [BinanceQuotesService, BinanceTickStreamService],
})
export class BinanceQuotesModule {}
