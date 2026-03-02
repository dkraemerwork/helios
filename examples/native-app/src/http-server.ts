/**
 * HTTP REST server wrapping a HeliosInstanceImpl.
 *
 * Uses Bun.serve() with simple URL-pattern routing.
 * No external dependencies — just Bun built-ins.
 */
import type { HeliosInstanceImpl } from '@helios/instance/impl/HeliosInstanceImpl';
import type { NearCacheStats } from '@helios/nearcache/NearCacheStats';
import type { Predicate } from '@helios/query/Predicate';
import { Predicates } from '@helios/query/Predicates';
import { NearCachedIMapWrapper } from '@helios/map/impl/nearcache/NearCachedIMapWrapper';
import type { Server } from 'bun';

export interface HttpServerOptions {
    instance: HeliosInstanceImpl;
    httpPort: number;
}

export class HeliosHttpServer {
    private readonly _instance: HeliosInstanceImpl;
    private readonly _httpPort: number;
    private _server: Server<undefined> | null = null;

    constructor(opts: HttpServerOptions) {
        this._instance = opts.instance;
        this._httpPort = opts.httpPort;
    }

    start(): void {
        this._server = Bun.serve({
            port: this._httpPort,
            fetch: (req) => this._handleRequest(req),
        });
    }

    stop(): void {
        this._server?.stop(true);
        this._server = null;
    }

    getPort(): number {
        return this._httpPort;
    }

    private async _handleRequest(req: Request): Promise<Response> {
        const url = new URL(req.url);
        const path = url.pathname;
        const method = req.method;

        try {
            // GET /health
            if (method === 'GET' && path === '/health') {
                return json({
                    status: 'ok',
                    instance: this._instance.getName(),
                    peers: this._instance.getTcpPeerCount(),
                    running: this._instance.isRunning(),
                });
            }

            // GET /cluster/info
            if (method === 'GET' && path === '/cluster/info') {
                return json({
                    instance: this._instance.getName(),
                    tcpPort: this._instance.getConfig().getNetworkConfig().getPort(),
                    httpPort: this._httpPort,
                    peers: this._instance.getTcpPeerCount(),
                });
            }

            // ── Predicate query endpoints (MUST come before /map/:name/:key) ──

            // POST /map/:name/query — query entries with a predicate
            //
            // Body: { "predicate": <predicate-spec>, "projection": "values" | "keys" | "entries" }
            //
            // Predicate spec examples:
            //   { "equal": { "attribute": "age", "value": 30 } }
            //   { "greaterThan": { "attribute": "age", "value": 25 } }
            //   { "between": { "attribute": "age", "from": 20, "to": 35 } }
            //   { "like": { "attribute": "name", "expression": "A%" } }
            //   { "regex": { "attribute": "name", "regex": "^A.*e$" } }
            //   { "in": { "attribute": "department", "values": ["Engineering", "Design"] } }
            //   { "and": [ <predicate-spec>, <predicate-spec>, ... ] }
            //   { "or": [ <predicate-spec>, <predicate-spec>, ... ] }
            //   { "not": <predicate-spec> }
            //
            const queryMatch = path.match(/^\/map\/([^/]+)\/query$/);
            if (method === 'POST' && queryMatch) {
                const [, mapName] = queryMatch;
                const map = this._instance.getMap<string, unknown>(mapName);
                const body = await req.json() as { predicate: unknown; projection?: string };

                const predicate = buildPredicate(body.predicate);
                const projection = body.projection ?? 'entries';

                if (projection === 'values') {
                    const values = map.values(predicate);
                    return json({ map: mapName, count: values.length, values });
                } else if (projection === 'keys') {
                    const keys = Array.from(map.keySet(predicate));
                    return json({ map: mapName, count: keys.length, keys });
                } else {
                    const entries: Record<string, unknown> = {};
                    for (const [k, v] of map.entrySet(predicate)) {
                        entries[k] = v;
                    }
                    return json({ map: mapName, count: Object.keys(entries).length, entries });
                }
            }

            // GET /map/:name/values?attribute=X&op=equal&value=Y — simple query via query params
            const valuesMatch = path.match(/^\/map\/([^/]+)\/values$/);
            if (method === 'GET' && valuesMatch) {
                const [, mapName] = valuesMatch;
                const map = this._instance.getMap<string, unknown>(mapName);
                const predicate = buildPredicateFromParams(url.searchParams);
                const values = map.values(predicate);
                return json({ map: mapName, count: values.length, values });
            }

            // GET /map/:name/keys?attribute=X&op=equal&value=Y — simple query via query params
            const keysMatch = path.match(/^\/map\/([^/]+)\/keys$/);
            if (method === 'GET' && keysMatch) {
                const [, mapName] = keysMatch;
                const map = this._instance.getMap<string, unknown>(mapName);
                const predicate = buildPredicateFromParams(url.searchParams);
                const keys = Array.from(map.keySet(predicate));
                return json({ map: mapName, count: keys.length, keys });
            }

            // === Map endpoints: /map/:name/:key (generic — checked AFTER specific routes) ===
            const mapKeyMatch = path.match(/^\/map\/([^/]+)\/([^/]+)$/);
            if (mapKeyMatch) {
                const [, mapName, key] = mapKeyMatch;
                const map = this._instance.getMap<string, unknown>(mapName);

                // PUT /map/:name/:key — store value
                if (method === 'PUT') {
                    const body = await req.json();
                    const old = map.put(key, body);
                    return json({ key, old, stored: true });
                }

                // GET /map/:name/:key — read value
                if (method === 'GET') {
                    const isNearCached = map instanceof NearCachedIMapWrapper;
                    let nearCacheHitBefore = 0;
                    if (isNearCached) {
                        const nc = (map as NearCachedIMapWrapper<string, unknown>).getNearCache();
                        nearCacheHitBefore = nc.getNearCacheStats().getHits();
                    }

                    const value = map.get(key);

                    let source: 'near-cache' | 'store' = 'store';
                    if (isNearCached) {
                        const nc = (map as NearCachedIMapWrapper<string, unknown>).getNearCache();
                        if (nc.getNearCacheStats().getHits() > nearCacheHitBefore) {
                            source = 'near-cache';
                        }
                    }

                    return json({ key, value, source });
                }

                // DELETE /map/:name/:key — remove value
                if (method === 'DELETE') {
                    const old = map.remove(key);
                    return json({ key, old, removed: true });
                }

                return json({ error: `Method ${method} not allowed on /map/:name/:key` }, 405);
            }

            // GET /map/:name — list all entries
            const mapListMatch = path.match(/^\/map\/([^/]+)$/);
            if (method === 'GET' && mapListMatch) {
                const [, mapName] = mapListMatch;
                const map = this._instance.getMap<string, unknown>(mapName);
                const entries: Record<string, unknown> = {};
                for (const [k, v] of map.entrySet()) {
                    entries[k] = v;
                }
                return json({ map: mapName, size: map.size(), entries });
            }

            // GET /near-cache/:name/stats — near-cache statistics
            const ncStatsMatch = path.match(/^\/near-cache\/([^/]+)\/stats$/);
            if (method === 'GET' && ncStatsMatch) {
                const [, mapName] = ncStatsMatch;
                const nc = this._instance.getNearCacheManager().getNearCache(mapName);
                if (!nc) {
                    return json({ error: `No near-cache for map "${mapName}"` }, 404);
                }
                const stats: NearCacheStats = nc.getNearCacheStats();
                return json({
                    map: mapName,
                    entries: nc.size(),
                    hits: stats.getHits(),
                    misses: stats.getMisses(),
                    ratio: stats.getRatio(),
                    evictions: stats.getEvictions(),
                    expirations: stats.getExpirations(),
                    invalidations: stats.getInvalidations(),
                    invalidationRequests: stats.getInvalidationRequests(),
                });
            }

            return json({ error: 'Not found', path }, 404);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return json({ error: message }, 500);
        }
    }
}

// ── Predicate builder from JSON DSL ─────────────────────────────────────

function buildPredicate(spec: unknown): Predicate {
    if (spec === null || spec === undefined) {
        return Predicates.alwaysTrue();
    }
    if (typeof spec !== 'object') {
        throw new Error(`Invalid predicate spec: expected object, got ${typeof spec}`);
    }

    const obj = spec as Record<string, unknown>;

    if ('equal' in obj) {
        const { attribute, value } = obj.equal as { attribute: string; value: unknown };
        return Predicates.equal(attribute, value);
    }
    if ('notEqual' in obj) {
        const { attribute, value } = obj.notEqual as { attribute: string; value: unknown };
        return Predicates.notEqual(attribute, value);
    }
    if ('greaterThan' in obj) {
        const { attribute, value } = obj.greaterThan as { attribute: string; value: unknown };
        return Predicates.greaterThan(attribute, value);
    }
    if ('greaterEqual' in obj) {
        const { attribute, value } = obj.greaterEqual as { attribute: string; value: unknown };
        return Predicates.greaterEqual(attribute, value);
    }
    if ('lessThan' in obj) {
        const { attribute, value } = obj.lessThan as { attribute: string; value: unknown };
        return Predicates.lessThan(attribute, value);
    }
    if ('lessEqual' in obj) {
        const { attribute, value } = obj.lessEqual as { attribute: string; value: unknown };
        return Predicates.lessEqual(attribute, value);
    }
    if ('between' in obj) {
        const { attribute, from, to } = obj.between as { attribute: string; from: unknown; to: unknown };
        return Predicates.between(attribute, from, to);
    }
    if ('in' in obj) {
        const { attribute, values } = obj.in as { attribute: string; values: unknown[] };
        return Predicates.in(attribute, ...values);
    }
    if ('like' in obj) {
        const { attribute, expression } = obj.like as { attribute: string; expression: string };
        return Predicates.like(attribute, expression);
    }
    if ('ilike' in obj) {
        const { attribute, expression } = obj.ilike as { attribute: string; expression: string };
        return Predicates.ilike(attribute, expression);
    }
    if ('regex' in obj) {
        const { attribute, regex } = obj.regex as { attribute: string; regex: string };
        return Predicates.regex(attribute, regex);
    }
    if ('and' in obj) {
        const inner = (obj.and as unknown[]).map(buildPredicate);
        return Predicates.and(...inner);
    }
    if ('or' in obj) {
        const inner = (obj.or as unknown[]).map(buildPredicate);
        return Predicates.or(...inner);
    }
    if ('not' in obj) {
        return Predicates.not(buildPredicate(obj.not));
    }

    throw new Error(`Unknown predicate type: ${JSON.stringify(Object.keys(obj))}`);
}

// ── Simple predicate from URL query params ──────────────────────────────
//
// ?attribute=age&op=greaterThan&value=25
// ?attribute=department&op=in&value=Engineering&value=Design
// ?attribute=name&op=like&value=A%
//
function buildPredicateFromParams(params: URLSearchParams): Predicate {
    const attribute = params.get('attribute');
    const op = params.get('op') ?? 'equal';

    if (!attribute) {
        return Predicates.alwaysTrue();
    }

    // Parse value — try JSON number/boolean, fall back to string
    const rawValues = params.getAll('value');
    const parseVal = (raw: string): unknown => {
        if (raw === 'true') return true;
        if (raw === 'false') return false;
        if (raw === 'null') return null;
        const num = Number(raw);
        if (!isNaN(num) && raw.trim() !== '') return num;
        return raw;
    };

    const value = rawValues.length === 1 ? parseVal(rawValues[0]) : rawValues.map(parseVal);

    switch (op) {
        case 'equal':       return Predicates.equal(attribute, value);
        case 'notEqual':    return Predicates.notEqual(attribute, value);
        case 'greaterThan': return Predicates.greaterThan(attribute, value);
        case 'greaterEqual': return Predicates.greaterEqual(attribute, value);
        case 'lessThan':    return Predicates.lessThan(attribute, value);
        case 'lessEqual':   return Predicates.lessEqual(attribute, value);
        case 'like':        return Predicates.like(attribute, String(value));
        case 'ilike':       return Predicates.ilike(attribute, String(value));
        case 'regex':       return Predicates.regex(attribute, String(value));
        case 'between': {
            const from = rawValues.length >= 1 ? parseVal(rawValues[0]) : null;
            const to = rawValues.length >= 2 ? parseVal(rawValues[1]) : null;
            return Predicates.between(attribute, from, to);
        }
        case 'in':          return Predicates.in(attribute, ...rawValues.map(parseVal));
        default:
            throw new Error(`Unknown op: "${op}". Use: equal|notEqual|greaterThan|greaterEqual|lessThan|lessEqual|between|in|like|ilike|regex`);
    }
}

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
