/**
 * Clustered MapStore — Two-node Helios cluster with owner-only persistence.
 *
 * Demonstrates:
 * - Two Helios nodes sharing one MapStore-backed map
 * - Owner-only external writes (partition owner is the sole writer)
 * - Write-through (default) persistence
 * - Load-on-miss through partition owner
 * - putAll/getAll routing through partition owners
 *
 * Clustered MapStore Semantics:
 * - Partition owner is the only member that calls store/delete/load on the external adapter
 * - Backup replicas shadow in-memory state but never write externally
 * - Durability is at-least-once at the adapter boundary
 * - Exactly-once is not guaranteed across crash/failover (at-least-once may replay)
 *
 * Adapter Eligibility:
 * - An adapter is cluster-safe only after it passes the clustered proof suite
 * - Proven adapters: CountingMapStore (test), MongoDB (after Phase 19 readiness)
 * - Clustered proof requires separate Helios member processes over real TCP
 *   with transport-boundary crash/drop/delay injection (Block 21.4 proof gate)
 *
 * Prerequisites:
 *   - For MongoDB: HELIOS_MONGODB_TEST_URI=mongodb://127.0.0.1:27017
 *
 * Run:
 *   bun run src/clustered-mapstore-example.ts
 */

import { Helios } from '@zenystx/helios-core/Helios';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import type { MapStore } from '@zenystx/helios-core/map/MapStore';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';

// ── In-memory counting adapter (for demonstration) ─────────────────────────

class DemoMapStore implements MapStore<string, string> {
    private readonly _data = new Map<string, string>();
    private readonly _name: string;

    constructor(name: string) {
        this._name = name;
    }

    async store(key: string, value: string): Promise<void> {
        console.log(`  [${this._name}] store("${key}", "${value}")`);
        this._data.set(key, value);
    }

    async storeAll(entries: Map<string, string>): Promise<void> {
        console.log(`  [${this._name}] storeAll(${entries.size} entries)`);
        for (const [k, v] of entries) this._data.set(k, v);
    }

    async delete(key: string): Promise<void> {
        console.log(`  [${this._name}] delete("${key}")`);
        this._data.delete(key);
    }

    async deleteAll(keys: string[]): Promise<void> {
        console.log(`  [${this._name}] deleteAll(${keys.length} keys)`);
        for (const k of keys) this._data.delete(k);
    }

    async load(key: string): Promise<string | null> {
        const v = this._data.get(key) ?? null;
        console.log(`  [${this._name}] load("${key}") → ${v}`);
        return v;
    }

    async loadAll(keys: string[]): Promise<Map<string, string>> {
        console.log(`  [${this._name}] loadAll(${keys.length} keys)`);
        const result = new Map<string, string>();
        for (const k of keys) {
            const v = this._data.get(k);
            if (v !== undefined) result.set(k, v);
        }
        return result;
    }

    async loadAllKeys(): Promise<MapKeyStream<string>> {
        console.log(`  [${this._name}] loadAllKeys()`);
        return MapKeyStream.fromIterable([...this._data.keys()]);
    }
}

// ── Cluster configuration ──────────────────────────────────────────────────

function makeNodeConfig(
    name: string,
    port: number,
    peerPorts: number[],
    store: DemoMapStore,
): HeliosConfig {
    const cfg = new HeliosConfig(name);
    cfg.getNetworkConfig()
        .setPort(port)
        .getJoin()
        .getTcpIpConfig()
        .setEnabled(true);
    for (const pp of peerPorts) {
        cfg.getNetworkConfig().getJoin().getTcpIpConfig().addMember(`localhost:${pp}`);
    }

    const msCfg = new MapStoreConfig();
    msCfg.setEnabled(true);
    msCfg.setImplementation(store);

    const mc = new MapConfig();
    mc.setName('products');
    mc.setMapStoreConfig(msCfg);
    cfg.addMapConfig(mc);

    return cfg;
}

// ── Main ───────────────────────────────────────────────────────────────────

console.log('Clustered MapStore Example');
console.log('=========================');
console.log('');
console.log('Key semantics:');
console.log('  - Partition owner is the sole external writer');
console.log('  - Backup replicas do not call store/delete/load');
console.log('  - Durability: at-least-once at adapter boundary');
console.log('');
console.log('Watch which node handles each external call:');
console.log('');

const storeA = new DemoMapStore('NodeA');
const storeB = new DemoMapStore('NodeB');

const nodeA = await Helios.newInstance(makeNodeConfig('NodeA', 15800, [], storeA));
const nodeB = await Helios.newInstance(makeNodeConfig('NodeB', 15801, [15800], storeB));

// Wait for cluster formation
await Bun.sleep(1000);

const mapA = nodeA.getMap<string, string>('products');
const mapB = nodeB.getMap<string, string>('products');

console.log('1. Put from NodeB — external store happens on partition owner only:');
await mapB.put('widget', 'Widget v1');

console.log('');
console.log('2. Get from NodeA — value is available cluster-wide:');
const v = await mapA.get('widget');
console.log(`   Result: ${v}`);

console.log('');
console.log('3. Remove from NodeB — external delete on owner only:');
await mapB.remove('widget');

console.log('');
nodeA.shutdown();
nodeB.shutdown();
console.log('Done.');
