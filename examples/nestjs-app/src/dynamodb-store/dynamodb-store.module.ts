/**
 * DynamoDbStoreModule — demonstrates @zenystx/helios-dynamodb as a write-behind MapStore.
 *
 * The 'trading-signals' IMap is backed by a DynamoDbMapStore targeting Scylla Cloud
 * via the Alternator (DynamoDB-compatible) API. Write-behind mode: puts are buffered
 * and flushed to Scylla every 2 seconds, smoothing write latency.
 *
 * Scylla/Alternator is the first production-proof provider for the DynamoDB-compatible
 * MapStore adapter.
 */

import { Module } from '@nestjs/common';
import { HeliosObjectExtractionModule } from '@zenystx/helios-nestjs';
import { DynamoDbStoreService } from './dynamodb-store.service';

@Module({
    imports: [
        HeliosObjectExtractionModule.forRoot({
            namedMaps: ['trading-signals'],
        }),
    ],
    providers: [DynamoDbStoreService],
    exports: [DynamoDbStoreService],
})
export class DynamoDbStoreModule {}
