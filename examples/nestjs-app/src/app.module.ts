/**
 * AppModule — root NestJS module for the nestjs-app example.
 *
 * Use AppModule.create(instance) to get a configured DynamicModule rather
 * than decorating a static class with @Module, which would run at import time
 * before the HeliosInstance is created.
 */

import 'reflect-metadata';
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import type { HeliosInstance } from '@helios/core/core/HeliosInstance';
import { HeliosModule } from '@helios/nestjs';
import { MongoDbStoreModule } from './mongodb-store/mongodb-store.module';
import { NearCacheModule } from './near-cache/near-cache.module';
import { PredicatesModule } from './predicates/predicates.module';
import { S3StoreModule } from './s3-store/s3-store.module';
import { TursoStoreModule } from './turso-store/turso-store.module';

@Module({})
export class AppModule {
    /**
     * Create a configured DynamicModule with the provided HeliosInstance.
     * Call this from main.ts after the instance is ready.
     */
    static create(instance: HeliosInstance): DynamicModule {
        return {
            module: AppModule,
            imports: [
                HeliosModule.forRoot(instance),
                NearCacheModule,
                PredicatesModule,
                MongoDbStoreModule,
                S3StoreModule,
                TursoStoreModule,
            ],
        };
    }
}
