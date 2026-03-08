/**
 * Scatter-backed async serialization strategy for TCP cluster protocol.
 *
 * Offloads JSON.stringify/JSON.parse to scatter worker threads, freeing the
 * main Bun event loop for I/O. This mirrors Hazelcast's NIO architecture where
 * serialization/deserialization runs on dedicated threads rather than the
 * reactor I/O thread.
 *
 * Uses @zenystx/scatterjs pool with least-busy strategy for optimal load
 * distribution across workers. Each worker runs JSON.stringify or JSON.parse
 * in its own OS thread with zero contention on the main event loop.
 *
 * The pool is created lazily on first use and can be destroyed when the
 * transport shuts down.
 */
import type { ClusterMessage } from '@zenystx/helios-core/cluster/tcp/ClusterMessage';
import type { ThreadPool } from '@zenystx/scatterjs';
import { scatter } from '@zenystx/scatterjs';

interface EncodeTask {
    op: 'encode';
    json: ClusterMessage;
}

interface DecodeTask {
    op: 'decode';
    bytes: Uint8Array;
}

type SerTask = EncodeTask | DecodeTask;
type SerResult = { encoded: Uint8Array } | { decoded: ClusterMessage };

export interface ScatterSerializationOptions {
    /** Number of worker threads for serialization (default: 4). */
    poolSize?: number;
}

export class ScatterSerializationStrategy {
    private readonly _poolSize: number;
    private _pool: ThreadPool<SerTask, SerResult> | null = null;
    private _destroyed = false;

    constructor(options?: ScatterSerializationOptions) {
        this._poolSize = options?.poolSize ?? 4;
    }

    /**
     * Serialize a ClusterMessage to a Buffer, using a worker thread for
     * the JSON.stringify work.
     */
    async serializeAsync(message: ClusterMessage): Promise<Buffer> {
        const pool = this._ensurePool();
        const result = await pool.exec({ op: 'encode', json: message }) as { encoded: Uint8Array };
        return Buffer.from(result.encoded);
    }

    /**
     * Deserialize a Buffer into a ClusterMessage, using a worker thread for
     * the JSON.parse work.
     */
    async deserializeAsync(buffer: Buffer): Promise<ClusterMessage> {
        const pool = this._ensurePool();
        const result = await pool.exec({
            op: 'decode',
            bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
        }) as { decoded: ClusterMessage };
        return result.decoded;
    }

    /**
     * Synchronous fallback for non-critical paths (HELLO, JOIN_REQUEST, etc.)
     * that don't need worker offloading.
     */
    serialize(message: ClusterMessage): Buffer {
        return Buffer.from(JSON.stringify(message), 'utf8');
    }

    /**
     * Synchronous fallback for non-critical paths.
     */
    deserialize(buffer: Buffer): ClusterMessage {
        return JSON.parse(buffer.toString('utf8')) as ClusterMessage;
    }

    destroy(): void {
        this._destroyed = true;
        if (this._pool) {
            this._pool.terminate();
            this._pool = null;
        }
    }

    private _ensurePool(): ThreadPool<SerTask, SerResult> {
        if (this._pool) return this._pool;
        if (this._destroyed) throw new Error('ScatterSerializationStrategy has been destroyed');

        this._pool = scatter.pool(
            (_ctx: unknown, task: SerTask) => {
                if (task.op === 'encode') {
                    const json = JSON.stringify(task.json);
                    const encoded = new TextEncoder().encode(json);
                    return { encoded } as SerResult;
                }
                const text = new TextDecoder().decode(task.bytes);
                const decoded = JSON.parse(text);
                return { decoded } as SerResult;
            },
            {
                size: this._poolSize,
                strategy: 'least-busy',
                concurrency: 4, // multiple async tasks per worker for I/O overlap
            },
        ) as unknown as ThreadPool<SerTask, SerResult>;

        return this._pool;
    }
}
