/**
 * NearCacheModule — wires up the near-cache demo.
 *
 * Imports:
 *   - HeliosCacheModule.register()      : provides CACHE_MANAGER (used by @Cacheable)
 *   - HeliosObjectExtractionModule      : exposes the 'catalog' IMap under @InjectMap('catalog')
 *
 * The 'catalog' map is pre-configured with a NearCacheConfig on the HeliosInstance
 * created in AppModule / main.ts, so near-cache reads are automatic.
 */

import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { HeliosCacheModule, HeliosObjectExtractionModule } from '@helios/nestjs';
import { NearCacheService } from './near-cache.service';

@Module({
    imports: [
        // Provides CACHE_MANAGER for @Cacheable decorator (method-level cache)
        HeliosCacheModule.register({ isGlobal: false }),
        // Exposes hz.getMap('catalog') as an injectable provider
        HeliosObjectExtractionModule.forRoot({ namedMaps: ['catalog'] }),
    ],
    providers: [NearCacheService],
    exports: [NearCacheService],
})
export class NearCacheModule {}
