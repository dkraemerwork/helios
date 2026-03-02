/**
 * Integration test: two Helios instances with HTTP endpoints + near-cache.
 *
 * Proves the full distributed near-cache lifecycle:
 *   1. PUT on instance A via HTTP → data replicates to instance B via TCP
 *   2. GET on instance B via HTTP → near-cache MISS (first read)
 *   3. GET on instance B again → near-cache HIT
 *   4. PUT on instance A (update) → INVALIDATE flows to B → near-cache evicted
 *   5. GET on instance B → near-cache MISS again (re-fetched fresh data)
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Helios } from '@helios/Helios';
import { HeliosConfig } from '@helios/config/HeliosConfig';
import { MapConfig } from '@helios/config/MapConfig';
import { NearCacheConfig } from '@helios/config/NearCacheConfig';
import type { HeliosInstanceImpl } from '@helios/instance/impl/HeliosInstanceImpl';
import { HeliosHttpServer } from '../src/http-server';

// Use high ports to avoid conflicts
const TCP_PORT_A = 16901;
const TCP_PORT_B = 16902;
const HTTP_PORT_A = 16801;
const HTTP_PORT_B = 16802;

const URL_A = `http://localhost:${HTTP_PORT_A}`;
const URL_B = `http://localhost:${HTTP_PORT_B}`;

async function getJson<T>(res: Response): Promise<T> {
    return res.json() as Promise<T>;
}

describe('Distributed near-cache integration', () => {
    let nodeA: HeliosInstanceImpl;
    let nodeB: HeliosInstanceImpl;
    let httpA: HeliosHttpServer;
    let httpB: HeliosHttpServer;

    beforeAll(async () => {
        // ── Node A config ──────────────────────────────────────────
        const cfgA = new HeliosConfig('nodeA');
        cfgA.getNetworkConfig()
            .setPort(TCP_PORT_A)
            .getJoin()
            .getTcpIpConfig()
            .setEnabled(true);

        const demoMapA = new MapConfig('demo');
        demoMapA.setNearCacheConfig(new NearCacheConfig());
        cfgA.addMapConfig(demoMapA);

        nodeA = await Helios.newInstance(cfgA);

        // ── Node B config (connects to A) ──────────────────────────
        const cfgB = new HeliosConfig('nodeB');
        cfgB.getNetworkConfig()
            .setPort(TCP_PORT_B)
            .getJoin()
            .getTcpIpConfig()
            .setEnabled(true)
            .addMember(`localhost:${TCP_PORT_A}`);

        const demoMapB = new MapConfig('demo');
        demoMapB.setNearCacheConfig(new NearCacheConfig());
        cfgB.addMapConfig(demoMapB);

        nodeB = await Helios.newInstance(cfgB);

        // ── Start HTTP servers ─────────────────────────────────────
        httpA = new HeliosHttpServer({ instance: nodeA, httpPort: HTTP_PORT_A });
        httpA.start();

        httpB = new HeliosHttpServer({ instance: nodeB, httpPort: HTTP_PORT_B });
        httpB.start();

        // Wait for peering
        const deadline = Date.now() + 5000;
        while (nodeA.getTcpPeerCount() < 1 && Date.now() < deadline) {
            await Bun.sleep(20);
        }
        expect(nodeA.getTcpPeerCount()).toBeGreaterThanOrEqual(1);
    });

    afterAll(() => {
        httpB?.stop();
        httpA?.stop();
        nodeB?.shutdown();
        nodeA?.shutdown();
    });

    it('health endpoint works', async () => {
        const res = await fetch(`${URL_A}/health`);
        const body = await getJson<{ status: string; instance: string; peers: number }>(res);
        expect(body.status).toBe('ok');
        expect(body.instance).toBe('nodeA');
        expect(body.peers).toBeGreaterThanOrEqual(1);
    });

    it('cluster info endpoint works', async () => {
        const res = await fetch(`${URL_B}/cluster/info`);
        const body = await getJson<{ instance: string; tcpPort: number }>(res);
        expect(body.instance).toBe('nodeB');
        expect(body.tcpPort).toBe(TCP_PORT_B);
    });

    it('PUT on A → replicated → GET on B returns data', async () => {
        // PUT on A
        const putRes = await fetch(`${URL_A}/map/demo/user1`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Alice', age: 30 }),
        });
        const putBody = await getJson<{ stored: boolean }>(putRes);
        expect(putBody.stored).toBe(true);

        // Wait for replication
        await Bun.sleep(200);

        // GET on B
        const getRes = await fetch(`${URL_B}/map/demo/user1`);
        const getBody = await getJson<{ value: unknown; source: string }>(getRes);
        expect(getBody.value).toEqual({ name: 'Alice', age: 30 });
        expect(getBody.source).toBe('store'); // first read = miss
    });

    it('second GET on B returns from near-cache', async () => {
        // The key "user1" was fetched in the previous test → should be in near-cache
        const getRes = await fetch(`${URL_B}/map/demo/user1`);
        const getBody = await getJson<{ value: unknown; source: string }>(getRes);
        expect(getBody.value).toEqual({ name: 'Alice', age: 30 });
        expect(getBody.source).toBe('near-cache'); // second read = hit
    });

    it('near-cache stats show hit and miss', async () => {
        const res = await fetch(`${URL_B}/near-cache/demo/stats`);
        const body = await getJson<{ hits: number; misses: number }>(res);
        expect(body.hits).toBeGreaterThanOrEqual(1);
        expect(body.misses).toBeGreaterThanOrEqual(1);
    });

    it('UPDATE on A → invalidates near-cache on B → next GET is miss', async () => {
        // Check near-cache stats before update
        const statsBefore = await getJson<{ misses: number }>(
            await fetch(`${URL_B}/near-cache/demo/stats`)
        );
        const missesBefore: number = statsBefore.misses;

        // UPDATE on A
        await fetch(`${URL_A}/map/demo/user1`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Alice', age: 31 }),
        });

        // Wait for invalidation to propagate
        await Bun.sleep(200);

        // GET on B — should be a near-cache MISS (was invalidated)
        const getRes = await fetch(`${URL_B}/map/demo/user1`);
        const getBody = await getJson<{ value: unknown; source: string }>(getRes);
        expect(getBody.value).toEqual({ name: 'Alice', age: 31 }); // fresh data
        expect(getBody.source).toBe('store'); // miss after invalidation

        // Verify misses increased
        const statsAfter = await getJson<{ misses: number }>(
            await fetch(`${URL_B}/near-cache/demo/stats`)
        );
        expect(statsAfter.misses).toBeGreaterThan(missesBefore);
    });

    it('after re-fetch, third GET on B returns from near-cache again', async () => {
        const getRes = await fetch(`${URL_B}/map/demo/user1`);
        const getBody = await getJson<{ value: unknown; source: string }>(getRes);
        expect(getBody.value).toEqual({ name: 'Alice', age: 31 });
        expect(getBody.source).toBe('near-cache'); // re-populated after miss
    });

    it('DELETE on A → removes from B', async () => {
        // DELETE on A
        const delRes = await fetch(`${URL_A}/map/demo/user1`, { method: 'DELETE' });
        const delBody = await getJson<{ removed: boolean }>(delRes);
        expect(delBody.removed).toBe(true);

        // Wait for replication
        await Bun.sleep(200);

        // GET on B — should be null
        const getRes = await fetch(`${URL_B}/map/demo/user1`);
        const getBody = await getJson<{ value: unknown }>(getRes);
        expect(getBody.value).toBeNull();
    });

    it('list entries on both nodes', async () => {
        // Put some data
        await fetch(`${URL_A}/map/demo/k1`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify('value1'),
        });
        await fetch(`${URL_A}/map/demo/k2`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify('value2'),
        });

        await Bun.sleep(200);

        // List on A
        const listA = await getJson<{ size: number }>(await fetch(`${URL_A}/map/demo`));
        expect(listA.size).toBeGreaterThanOrEqual(2);

        // List on B (replicated)
        const listB = await getJson<{ size: number }>(await fetch(`${URL_B}/map/demo`));
        expect(listB.size).toBeGreaterThanOrEqual(2);
    });

    it('final near-cache stats show full lifecycle', async () => {
        const stats = await getJson<{ hits: number; misses: number; invalidations: number }>(
            await fetch(`${URL_B}/near-cache/demo/stats`)
        );
        // We've had multiple hits, misses, and invalidations
        expect(stats.hits).toBeGreaterThanOrEqual(2);
        expect(stats.misses).toBeGreaterThanOrEqual(2);
        expect(stats.invalidations).toBeGreaterThanOrEqual(1);
    });

    // ── Predicate query tests ──────────────────────────────────────────

    it('predicate: seed employees for query tests', async () => {
        const employees = [
            { name: 'Alice',   age: 30, department: 'Engineering', salary: 95000 },
            { name: 'Bob',     age: 25, department: 'Design',      salary: 72000 },
            { name: 'Charlie', age: 35, department: 'Engineering', salary: 110000 },
            { name: 'Diana',   age: 28, department: 'Marketing',   salary: 68000 },
            { name: 'Eve',     age: 32, department: 'Engineering', salary: 105000 },
            { name: 'Frank',   age: 45, department: 'Management',  salary: 130000 },
        ];

        // Use a non-near-cached map ("employees") for clean predicate testing
        for (const emp of employees) {
            await fetch(`${URL_A}/map/employees/${emp.name.toLowerCase()}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(emp),
            });
        }

        await Bun.sleep(300);

        // Verify replication
        const listB = await getJson<{ size: number }>(await fetch(`${URL_B}/map/employees`));
        expect(listB.size).toBe(6);
    });

    it('predicate: equal — find employees aged 30', async () => {
        const res = await fetch(`${URL_A}/map/employees/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                predicate: { equal: { attribute: 'age', value: 30 } },
                projection: 'values',
            }),
        });
        const body = await getJson<{ count: number; values: Array<{ name: string }> }>(res);
        expect(body.count).toBe(1);
        expect(body.values[0].name).toBe('Alice');
    });

    it('predicate: greaterThan — employees older than 30', async () => {
        const res = await fetch(`${URL_A}/map/employees/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                predicate: { greaterThan: { attribute: 'age', value: 30 } },
                projection: 'values',
            }),
        });
        const body = await getJson<{ count: number; values: Array<{ name: string }> }>(res);
        expect(body.count).toBe(3); // Charlie(35), Eve(32), Frank(45)
        const names = body.values.map(v => v.name).sort();
        expect(names).toEqual(['Charlie', 'Eve', 'Frank']);
    });

    it('predicate: between — employees aged 25-30', async () => {
        const res = await fetch(`${URL_A}/map/employees/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                predicate: { between: { attribute: 'age', from: 25, to: 30 } },
                projection: 'keys',
            }),
        });
        const body = await getJson<{ count: number; keys: string[] }>(res);
        expect(body.count).toBe(3); // Alice(30), Bob(25), Diana(28)
        expect(body.keys.sort()).toEqual(['alice', 'bob', 'diana']);
    });

    it('predicate: in — engineers and designers', async () => {
        const res = await fetch(`${URL_A}/map/employees/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                predicate: { in: { attribute: 'department', values: ['Engineering', 'Design'] } },
                projection: 'values',
            }),
        });
        const body = await getJson<{ count: number; values: Array<{ name: string }> }>(res);
        expect(body.count).toBe(4); // Alice, Bob, Charlie, Eve
    });

    it('predicate: like — names starting with "A"', async () => {
        const res = await fetch(`${URL_A}/map/employees/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                predicate: { like: { attribute: 'name', expression: 'A%' } },
                projection: 'values',
            }),
        });
        const body = await getJson<{ count: number; values: Array<{ name: string }> }>(res);
        expect(body.count).toBe(1);
        expect(body.values[0].name).toBe('Alice');
    });

    it('predicate: regex — names ending with "e"', async () => {
        const res = await fetch(`${URL_A}/map/employees/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                predicate: { regex: { attribute: 'name', regex: 'e$' } },
                projection: 'values',
            }),
        });
        const body = await getJson<{ count: number; values: Array<{ name: string }> }>(res);
        expect(body.count).toBe(3); // Alice, Charlie, Eve
        const names = body.values.map(v => v.name).sort();
        expect(names).toEqual(['Alice', 'Charlie', 'Eve']);
    });

    it('predicate: and — engineers earning > 100k', async () => {
        const res = await fetch(`${URL_A}/map/employees/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                predicate: {
                    and: [
                        { equal: { attribute: 'department', value: 'Engineering' } },
                        { greaterThan: { attribute: 'salary', value: 100000 } },
                    ],
                },
                projection: 'values',
            }),
        });
        const body = await getJson<{ count: number; values: Array<{ name: string }> }>(res);
        expect(body.count).toBe(2); // Charlie(110k), Eve(105k)
        const names = body.values.map(v => v.name).sort();
        expect(names).toEqual(['Charlie', 'Eve']);
    });

    it('predicate: or — management or under 26', async () => {
        const res = await fetch(`${URL_A}/map/employees/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                predicate: {
                    or: [
                        { equal: { attribute: 'department', value: 'Management' } },
                        { lessThan: { attribute: 'age', value: 26 } },
                    ],
                },
                projection: 'values',
            }),
        });
        const body = await getJson<{ count: number; values: Array<{ name: string }> }>(res);
        expect(body.count).toBe(2); // Frank(Management), Bob(age 25)
        const names = body.values.map(v => v.name).sort();
        expect(names).toEqual(['Bob', 'Frank']);
    });

    it('predicate: not — everyone except Engineering', async () => {
        const res = await fetch(`${URL_A}/map/employees/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                predicate: { not: { equal: { attribute: 'department', value: 'Engineering' } } },
                projection: 'values',
            }),
        });
        const body = await getJson<{ count: number; values: Array<{ name: string }> }>(res);
        expect(body.count).toBe(3); // Bob, Diana, Frank
    });

    it('predicate: query via GET params — salary > 100000', async () => {
        const res = await fetch(`${URL_A}/map/employees/values?attribute=salary&op=greaterThan&value=100000`);
        const body = await getJson<{ count: number; values: Array<{ name: string }> }>(res);
        expect(body.count).toBe(3); // Charlie(110k), Eve(105k), Frank(130k)
    });

    it('predicate: query keys via GET params — department=Engineering', async () => {
        const res = await fetch(`${URL_A}/map/employees/keys?attribute=department&op=equal&value=Engineering`);
        const body = await getJson<{ count: number; keys: string[] }>(res);
        expect(body.count).toBe(3); // alice, charlie, eve
        expect(body.keys.sort()).toEqual(['alice', 'charlie', 'eve']);
    });

    it('predicate: queries work on replicated node too', async () => {
        const res = await fetch(`${URL_B}/map/employees/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                predicate: { greaterEqual: { attribute: 'salary', value: 100000 } },
                projection: 'values',
            }),
        });
        const body = await getJson<{ count: number; values: Array<{ name: string }> }>(res);
        expect(body.count).toBe(3); // Charlie, Eve, Frank — same data on both nodes
    });

    // ── Original tests ──────────────────────────────────────────────────

    it('404 for unknown endpoints', async () => {
        const res = await fetch(`${URL_A}/unknown/path`);
        expect(res.status).toBe(404);
    });

    it('404 for near-cache stats on unconfigured map', async () => {
        const res = await fetch(`${URL_A}/near-cache/nonexistent/stats`);
        expect(res.status).toBe(404);
    });
});
