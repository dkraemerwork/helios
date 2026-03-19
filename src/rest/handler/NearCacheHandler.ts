/**
 * NearCacheHandler — serves Near Cache statistics via REST.
 *
 * Endpoints:
 *   GET /hazelcast/rest/nearcache/stats — All near cache stats as JSON
 *   GET /hazelcast/rest/nearcache/stats/:name — Stats for a specific near cache
 */
import type { NearCache } from '@zenystx/helios-core/internal/nearcache/NearCache';
import type { NearCacheManager } from '@zenystx/helios-core/internal/nearcache/NearCacheManager';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS_HEADERS };

function serializeStats(nc: NearCache): Record<string, unknown> {
    const stats = nc.getNearCacheStats();
    return {
        name: nc.getName(),
        ownedEntryCount: stats.getOwnedEntryCount(),
        ownedEntryMemoryCost: stats.getOwnedEntryMemoryCost(),
        hits: stats.getHits(),
        misses: stats.getMisses(),
        ratio: stats.getRatio(),
        evictions: stats.getEvictions(),
        expirations: stats.getExpirations(),
        invalidations: stats.getInvalidations(),
        invalidationRequests: stats.getInvalidationRequests(),
        persistenceCount: stats.getPersistenceCount(),
        lastPersistenceTime: stats.getLastPersistenceTime(),
        lastPersistenceDuration: stats.getLastPersistenceDuration(),
        lastPersistenceWrittenBytes: stats.getLastPersistenceWrittenBytes(),
        lastPersistenceKeyCount: stats.getLastPersistenceKeyCount(),
        lastPersistenceFailure: stats.getLastPersistenceFailure(),
        creationTime: stats.getCreationTime(),
        size: nc.size(),
        inMemoryFormat: nc.getNearCacheConfig().getInMemoryFormat(),
        serializeKeys: nc.isSerializeKeys(),
    };
}

export class NearCacheHandler {
    constructor(private readonly _manager: NearCacheManager) {}

    handle(req: Request): Response {
        if (req.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const path = new URL(req.url).pathname;
        const statsBase = '/hazelcast/rest/nearcache/stats';

        if (path === statsBase || path === `${statsBase}/`) {
            return this._allStats();
        }

        if (path.startsWith(`${statsBase}/`)) {
            const name = decodeURIComponent(path.slice(statsBase.length + 1));
            return this._singleStats(name);
        }

        return new Response(
            JSON.stringify({ status: 404, message: 'Unknown near cache endpoint.' }),
            { status: 404, headers: JSON_HEADERS },
        );
    }

    private _allStats(): Response {
        const caches = this._manager.listAllNearCaches();
        const stats = caches.map((nc) => serializeStats(nc));
        return new Response(JSON.stringify({ nearCaches: stats }), {
            status: 200,
            headers: JSON_HEADERS,
        });
    }

    private _singleStats(name: string): Response {
        const nc = this._manager.getNearCache(name);
        if (nc === null) {
            return new Response(
                JSON.stringify({ status: 404, message: `Near cache '${name}' not found.` }),
                { status: 404, headers: JSON_HEADERS },
            );
        }
        return new Response(JSON.stringify(serializeStats(nc)), {
            status: 200,
            headers: JSON_HEADERS,
        });
    }
}
