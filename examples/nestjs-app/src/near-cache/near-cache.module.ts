/**
 * NearCacheModule — demonstrates two caching patterns side-by-side:
 *
 *   1. Helios near-cache (transparent, infrastructure-level):
 *      MapConfig + NearCacheConfig on the HeliosInstance → IMap.get() reads are
 *      served from the local near-cache after the first miss. No application code
 *      changes required; the near-cache is part of the map infrastructure.
 *
 *   2. @Cacheable (application-level, Spring-Cache-style):
 *      HeliosCacheModule provides CACHE_MANAGER. @Cacheable on a service method
 *      stores the return value in that cache, so subsequent calls with the same
 *      key skip the method body entirely.
 *
 * HeliosObjectExtractionModule exposes the named IMap instances as injectable
 * providers via @InjectMap().
 */

import { Module } from '@nestjs/common';
import { HeliosCacheModule, HeliosObjectExtractionModule } from '@zenystx/nestjs';
import { NearCacheService } from './near-cache.service';

@Module({
    imports: [
        // Exposes the 'catalog' IMap (near-cache-enabled via MapConfig in main.ts).
        HeliosObjectExtractionModule.forRoot({
            namedMaps: ['catalog'],
        }),
        // Provides CACHE_MANAGER for the @Cacheable decorator (in-memory store).
        HeliosCacheModule.register(),
    ],
    providers: [NearCacheService],
    exports: [NearCacheService],
})
export class NearCacheModule {}
