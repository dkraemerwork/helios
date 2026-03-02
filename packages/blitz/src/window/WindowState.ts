import type { WindowKey } from './WindowPolicy.ts';
import type { KvManager, KV } from '@nats-io/kv';

/**
 * Typed window accumulator store.
 *
 * `WindowState` uses one NATS KV bucket per pipeline (name: `blitz-{pipelineName}-windows`).
 * The bucket TTL is set to `maxWindowDuration * 3` as a safety backstop only —
 * primary cleanup is explicit deletion after window close.
 *
 * Lifecycle contract (enforced by WindowOperator):
 * 1. On event:        put(windowKey, serialize(accumulator))
 * 2. On window CLOSE: delete(windowKey) AFTER emitting the result.
 *                     If emit fails, delete is NOT called — window remains for retry.
 * 3. Bucket TTL:      Safety backstop; catches leaked state from crashes.
 */
export interface WindowState<A> {
    put(key: WindowKey, accumulator: A): Promise<void>;
    get(key: WindowKey): Promise<A | null>;
    /** Called explicitly after every successful window emit. */
    delete(key: WindowKey): Promise<void>;
    list(): Promise<WindowKey[]>;
}

/**
 * In-memory WindowState for unit testing.
 * No external dependencies required.
 */
export class InMemoryWindowState<A> implements WindowState<A> {
    private readonly _map = new Map<string, A>();

    async put(key: WindowKey, accumulator: A): Promise<void> {
        this._map.set(key, accumulator);
    }

    async get(key: WindowKey): Promise<A | null> {
        return this._map.get(key) ?? null;
    }

    async delete(key: WindowKey): Promise<void> {
        this._map.delete(key);
    }

    async list(): Promise<WindowKey[]> {
        return [...this._map.keys()];
    }

    /** Number of tracked windows (useful for test assertions). */
    get size(): number {
        return this._map.size;
    }
}

/**
 * NATS KV-backed WindowState for production use.
 *
 * Bucket name: `blitz-{pipelineName}-windows` (hyphens used — NATS KV requires [a-zA-Z0-9_-]).
 * Bucket TTL is set at creation to `maxDurationMs * 3` as a safety backstop.
 */
export class NatsKvWindowState<A> implements WindowState<A> {
    /** Exposed for status inspection in tests. */
    readonly kv: KV;

    private constructor(kv: KV) {
        this.kv = kv;
    }

    /**
     * Create (or open existing) NATS KV bucket for pipeline window state.
     *
     * @param kvm - KvManager from BlitzService.kvm
     * @param pipelineName - pipeline name (used in bucket name)
     * @param bucketTtlMs - TTL for the KV bucket in ms (pass windowPolicy.maxDurationMs * 3)
     */
    static async create<A>(
        kvm: KvManager,
        pipelineName: string,
        bucketTtlMs: number,
    ): Promise<NatsKvWindowState<A>> {
        // NATS KV bucket names must match [a-zA-Z0-9_-]; replace invalid chars with '-'
        const safeName = `blitz-${pipelineName.replace(/[^a-zA-Z0-9_-]/g, '-')}-windows`;
        const kv = await kvm.create(safeName, { ttl: bucketTtlMs });
        return new NatsKvWindowState<A>(kv);
    }

    async put(key: WindowKey, accumulator: A): Promise<void> {
        const bytes = new TextEncoder().encode(JSON.stringify(accumulator));
        await this.kv.put(key, bytes);
    }

    async get(key: WindowKey): Promise<A | null> {
        const entry = await this.kv.get(key);
        if (!entry || entry.operation !== 'PUT') return null;
        return entry.json<A>();
    }

    async delete(key: WindowKey): Promise<void> {
        await this.kv.delete(key);
    }

    async list(): Promise<WindowKey[]> {
        const iter = await this.kv.keys();
        const keys: WindowKey[] = [];
        for await (const k of iter) {
            keys.push(k);
        }
        return keys;
    }
}
