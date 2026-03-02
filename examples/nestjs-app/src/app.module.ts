/**
 * AppModule — root NestJS module for the nestjs-app example.
 *
 * Registers:
 *   - HeliosModule.forRoot(instance)  : makes the HeliosInstance globally available
 *   - NearCacheModule                 : near-cache demo
 *   - PredicatesModule                : predicate query demo
 *
 * The HeliosInstance is created in main.ts (before bootstrapping) with:
 *   - a MapConfig for 'catalog' that has a NearCacheConfig attached
 *   - a plain MapConfig for 'products' (used by predicates)
 */

import 'reflect-metadata';
import { Module } from '@nestjs/common';
import type { HeliosInstance } from '@helios/core/core/HeliosInstance';
import { HeliosModule } from '@helios/nestjs';
import { NearCacheModule } from './near-cache/near-cache.module';
import { PredicatesModule } from './predicates/predicates.module';

@Module({
    imports: [
        HeliosModule.forRoot(AppModule._instance!),
        NearCacheModule,
        PredicatesModule,
    ],
})
export class AppModule {
    /** Set before the module is constructed (see main.ts). */
    static _instance: HeliosInstance | null = null;
}
