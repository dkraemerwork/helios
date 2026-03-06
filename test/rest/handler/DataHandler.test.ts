/**
 * Block 11.5 — DataHandler (IMap CRUD + IQueue ops over REST)
 *
 * Tests:
 *  Map endpoints (DATA group):
 *   1. GET /hazelcast/rest/maps/{name}/{key}  → 200 + JSON value
 *   2. GET /hazelcast/rest/maps/{name}/{key}  → 204 when key absent
 *   3. POST /hazelcast/rest/maps/{name}/{key} → 200 OK (stores value)
 *   4. DELETE /hazelcast/rest/maps/{name}/{key} → 200 OK
 *   5. DATA group disabled → 403
 *
 *  Queue endpoints (DATA group):
 *   6. GET  /hazelcast/rest/queues/{name}/size → {"size": N}
 *   7. POST /hazelcast/rest/queues/{name}      → 200 OK (offer succeeds)
 *   8. POST /hazelcast/rest/queues/{name}      → 503 when queue full
 *   9. GET  /hazelcast/rest/queues/{name}/{timeout} → 200 + value (queue has item)
 *  10. GET  /hazelcast/rest/queues/{name}/{timeout} → 204 on timeout (queue empty)
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { RestApiConfig } from '@zenystx/core/config/RestApiConfig';
import { RestEndpointGroup } from '@zenystx/core/rest/RestEndpointGroup';
import { HeliosRestServer } from '@zenystx/core/rest/HeliosRestServer';
import { DataHandler, type DataHandlerStore } from '@zenystx/core/rest/handler/DataHandler';

// ─── helpers ──────────────────────────────────────────────────────────────────

const SERVERS: HeliosRestServer[] = [];

afterEach(() => {
    for (const s of SERVERS) s.stop();
    SERVERS.length = 0;
});

function makeMapStore(initial: Map<string, unknown> = new Map()): DataHandlerStore {
    const maps = new Map<string, Map<string, unknown>>();
    return {
        getMap: async (name: string) => {
            if (!maps.has(name)) maps.set(name, initial);
            const store = maps.get(name)!;
            return {
                get: async (key: string) => store.get(key) ?? null,
                put: async (key: string, value: unknown) => { store.set(key, value); return null; },
                remove: async (key: string) => { const v = store.get(key) ?? null; store.delete(key); return v; },
            };
        },
        getQueue: async () => null,
    };
}

function makeQueueStore(items: unknown[] = [], maxSize = Infinity): DataHandlerStore {
    return {
        getMap: async () => null,
        getQueue: async (_name: string) => {
            return {
                size: () => items.length,
                offer: (element: unknown) => {
                    if (items.length >= maxSize) return false;
                    items.push(element);
                    return true;
                },
                poll: () => items.length > 0 ? items.shift()! : null,
            };
        },
    };
}

function makeDataServer(store: DataHandlerStore, enabled = true): { port: number } {
    const cfg = new RestApiConfig()
        .setEnabled(true)
        .setPort(0)
        .enableGroups(enabled ? RestEndpointGroup.DATA : RestEndpointGroup.HEALTH_CHECK);

    const server = new HeliosRestServer(cfg);
    const handler = new DataHandler(store);
    server.registerHandler('/hazelcast/rest/maps', (req) => handler.handle(req));
    server.registerHandler('/hazelcast/rest/queues', (req) => handler.handle(req));
    server.start();
    SERVERS.push(server);
    return { port: server.getBoundPort() };
}

// ─── IMap tests ───────────────────────────────────────────────────────────────

describe('DataHandler — IMap CRUD', () => {
    it('GET /hazelcast/rest/maps/{name}/{key} returns 200 + JSON value when key present', async () => {
        const initial = new Map<string, unknown>([['hello', { greeting: 'world' }]]);
        const { port } = makeDataServer(makeMapStore(initial));
        const res = await fetch(`http://localhost:${port}/hazelcast/rest/maps/mymap/hello`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/json');
        const body = await res.json();
        expect(body).toEqual({ greeting: 'world' });
    });

    it('GET /hazelcast/rest/maps/{name}/{key} returns 204 when key is absent', async () => {
        const { port } = makeDataServer(makeMapStore());
        const res = await fetch(`http://localhost:${port}/hazelcast/rest/maps/mymap/missing`);
        expect(res.status).toBe(204);
    });

    it('POST /hazelcast/rest/maps/{name}/{key} stores value and returns 200', async () => {
        const store = makeMapStore();
        const { port } = makeDataServer(store);

        const res = await fetch(`http://localhost:${port}/hazelcast/rest/maps/mymap/foo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: 42 }),
        });
        expect(res.status).toBe(200);

        // Verify stored by reading back
        const getRes = await fetch(`http://localhost:${port}/hazelcast/rest/maps/mymap/foo`);
        expect(getRes.status).toBe(200);
        const body = await getRes.json();
        expect(body).toEqual({ value: 42 });
    });

    it('DELETE /hazelcast/rest/maps/{name}/{key} removes the key and returns 200', async () => {
        const initial = new Map<string, unknown>([['k1', 'v1']]);
        const { port } = makeDataServer(makeMapStore(initial));

        const res = await fetch(`http://localhost:${port}/hazelcast/rest/maps/mymap/k1`, {
            method: 'DELETE',
        });
        expect(res.status).toBe(200);

        // Key should be gone
        const getRes = await fetch(`http://localhost:${port}/hazelcast/rest/maps/mymap/k1`);
        expect(getRes.status).toBe(204);
    });

    it('returns 403 when DATA group is disabled', async () => {
        const { port } = makeDataServer(makeMapStore(), false);
        const res = await fetch(`http://localhost:${port}/hazelcast/rest/maps/mymap/key`);
        expect(res.status).toBe(403);
    });
});

// ─── IQueue tests ─────────────────────────────────────────────────────────────

describe('DataHandler — IQueue ops', () => {
    it('GET /hazelcast/rest/queues/{name}/size returns {"size": N}', async () => {
        const items: unknown[] = [1, 2, 3];
        const { port } = makeDataServer(makeQueueStore(items));
        const res = await fetch(`http://localhost:${port}/hazelcast/rest/queues/myqueue/size`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/json');
        const body = await res.json() as { size: number };
        expect(body.size).toBe(3);
    });

    it('POST /hazelcast/rest/queues/{name} offers element and returns 200', async () => {
        const { port } = makeDataServer(makeQueueStore());
        const res = await fetch(`http://localhost:${port}/hazelcast/rest/queues/myqueue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ msg: 'hello' }),
        });
        expect(res.status).toBe(200);
    });

    it('POST /hazelcast/rest/queues/{name} returns 503 when queue is full', async () => {
        const { port } = makeDataServer(makeQueueStore([1, 2], 2));
        const res = await fetch(`http://localhost:${port}/hazelcast/rest/queues/myqueue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify('item'),
        });
        expect(res.status).toBe(503);
    });

    it('GET /hazelcast/rest/queues/{name}/{timeout} returns 200 + value when queue has item', async () => {
        const items: unknown[] = ['first'];
        const { port } = makeDataServer(makeQueueStore(items));
        const res = await fetch(`http://localhost:${port}/hazelcast/rest/queues/myqueue/5`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toBe('first');
    });

    it('GET /hazelcast/rest/queues/{name}/{timeout} returns 204 when queue is empty (timeout)', async () => {
        const { port } = makeDataServer(makeQueueStore([]));
        const res = await fetch(`http://localhost:${port}/hazelcast/rest/queues/myqueue/1`);
        expect(res.status).toBe(204);
    });
});
