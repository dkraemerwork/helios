/**
 * AppModule — root NestJS module for the nestjs-app example.
 *
 * Use AppModule.create(instance, blitz) to get a configured DynamicModule
 * rather than decorating a static class with @Module, which would run at
 * import time before the HeliosInstance and BlitzService are created.
 */

import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import type { BlitzService } from '@zenystx/helios-blitz';
import { HELIOS_BLITZ_SERVICE_TOKEN, HeliosBlitzModule, HeliosBlitzService } from '@zenystx/helios-blitz/nestjs';
import type { HeliosInstance } from '@zenystx/helios-core/core/HeliosInstance';
import { HeliosModule } from '@zenystx/helios-nestjs';
import 'reflect-metadata';
import { BinanceQuotesModule } from './binance-quotes/binance-quotes.module';
import { DynamoDbStoreModule } from './dynamodb-store/dynamodb-store.module';
import { MongoDbStoreModule } from './mongodb-store/mongodb-store.module';
import { NearCacheModule } from './near-cache/near-cache.module';
import { PredicatesModule } from './predicates/predicates.module';
import { S3StoreModule } from './s3-store/s3-store.module';
import { TursoStoreModule } from './turso-store/turso-store.module';

@Module({})
export class AppModule {
    /**
     * Create a configured DynamicModule with the provided HeliosInstance
     * and a pre-started BlitzService (embedded NATS already running).
     *
     * Call this from main.ts after both the Helios instance and BlitzService
     * are ready. This avoids the forRoot({ embedded: {} }) pitfall where
     * BlitzService.connect() requires `servers` but embedded mode only
     * provides them after BlitzService.start().
     */
    static create(instance: HeliosInstance, blitz: BlitzService): DynamicModule {
        return {
            module: AppModule,
            imports: [
                HeliosModule.forRoot(instance),

                // Blitz stream processing — reuse the pre-started BlitzService.
                // Embedded NATS on port 4222. External NATS clients can connect
                // to nats://localhost:4222 to publish ticks directly.
                HeliosBlitzModule.forHeliosInstance({
                    provide: HELIOS_BLITZ_SERVICE_TOKEN,
                    useFactory: () => new HeliosBlitzService(blitz),
                }),

                // Feature modules
                NearCacheModule,
                PredicatesModule,
                BinanceQuotesModule,
                MongoDbStoreModule,
                S3StoreModule,
                TursoStoreModule,
                DynamoDbStoreModule,
            ],
        };
    }
}
