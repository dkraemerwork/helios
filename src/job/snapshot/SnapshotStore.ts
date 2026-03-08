import type { KV } from '@nats-io/kv';
import type { Kvm } from '@nats-io/kv';

const BUCKET_PREFIX = '__blitz.snapshots';
const COMMIT_KEY_PREFIX = '_committed';

/**
 * SnapshotStore — NATS KV-backed snapshot persistence for Blitz jobs.
 *
 * Each job gets its own KV bucket: `__blitz.snapshots.{jobId}`.
 * Processor state is keyed by `{snapshotId}.{vertexName}.{processorIndex}`.
 * Committed snapshots are tracked via metadata keys: `_committed.{snapshotId}`.
 */
export class SnapshotStore {
    private _kv: KV | null = null;

    constructor(
        private readonly _kvm: Kvm,
        private readonly _jobId: string,
    ) {}

    /** Save processor state for a given snapshot, vertex, and processor index. */
    async saveProcessorState(
        snapshotId: string,
        vertexName: string,
        processorIndex: number,
        state: unknown,
    ): Promise<void> {
        const kv = await this._bucket();
        const key = this._stateKey(snapshotId, vertexName, processorIndex);
        const data = this._encode(state);
        await kv.put(key, data);
    }

    /** Load processor state. Returns null if no state exists for the given key. */
    async loadProcessorState(
        snapshotId: string,
        vertexName: string,
        processorIndex: number,
    ): Promise<unknown | null> {
        const kv = await this._bucket();
        const key = this._stateKey(snapshotId, vertexName, processorIndex);
        const entry = await kv.get(key);
        if (entry === null || entry.operation !== 'PUT') {
            return null;
        }
        return this._decode(entry.value);
    }

    /** Mark a snapshot as committed. */
    async commitSnapshot(snapshotId: string): Promise<void> {
        const kv = await this._bucket();
        const key = `${COMMIT_KEY_PREFIX}.${snapshotId}`;
        await kv.put(key, snapshotId);
    }

    /** Return the most recently committed snapshot ID, or null if none. */
    async getLatestSnapshotId(): Promise<string | null> {
        const kv = await this._bucket();
        const commitPrefix = `${COMMIT_KEY_PREFIX}.`;

        let latestId: string | null = null;
        let latestRevision = 0;

        const keysIter = await kv.keys(`${COMMIT_KEY_PREFIX}.*`);
        for await (const key of keysIter) {
            if (!key.startsWith(commitPrefix)) continue;
            const entry = await kv.get(key);
            if (entry === null || entry.operation !== 'PUT') continue;

            // Use KV revision as ordering — monotonically increasing per bucket
            if (entry.revision > latestRevision) {
                latestRevision = entry.revision;
                latestId = key.slice(commitPrefix.length);
            }
        }

        return latestId;
    }

    /** Prune old committed snapshots, keeping only the last `keepLast` committed snapshots. */
    async pruneSnapshots(keepLast: number): Promise<void> {
        const kv = await this._bucket();
        const commitPrefix = `${COMMIT_KEY_PREFIX}.`;

        // Collect all committed snapshots with their revisions
        const committed: Array<{ snapshotId: string; revision: number }> = [];
        const keysIter = await kv.keys(`${COMMIT_KEY_PREFIX}.*`);
        for await (const key of keysIter) {
            if (!key.startsWith(commitPrefix)) continue;
            const entry = await kv.get(key);
            if (entry === null || entry.operation !== 'PUT') continue;
            const snapshotId = key.slice(commitPrefix.length);
            committed.push({ snapshotId, revision: entry.revision });
        }

        // Sort by revision ascending (oldest first)
        committed.sort((a, b) => a.revision - b.revision);

        // Remove oldest snapshots beyond keepLast
        const toRemove = committed.slice(0, Math.max(0, committed.length - keepLast));

        for (const { snapshotId } of toRemove) {
            // Delete the commit marker
            await kv.purge(`${COMMIT_KEY_PREFIX}.${snapshotId}`);

            // Delete all processor state keys for this snapshot
            // Use `>` wildcard to match all tokens after snapshotId
            const stateKeys = await kv.keys(`${snapshotId}.>`);
            for await (const stateKey of stateKeys) {
                await kv.purge(stateKey);
            }
        }
    }

    /** Destroy the entire KV bucket for this job. Idempotent. */
    async destroy(): Promise<void> {
        try {
            const kv = await this._bucket();
            await kv.destroy();
        } catch {
            // Bucket may already be destroyed or never created — idempotent
        }
        this._kv = null;
    }

    private async _bucket(): Promise<KV> {
        if (this._kv !== null) return this._kv;
        const bucketName = `${BUCKET_PREFIX}.${this._jobId}`;
        // Sanitize bucket name: NATS KV bucket names use underscores, not dots
        const sanitized = bucketName.replace(/\./g, '_');
        this._kv = await this._kvm.create(sanitized, {
            history: 2,
            replicas: 1,
        });
        return this._kv;
    }

    private _stateKey(snapshotId: string, vertexName: string, processorIndex: number): string {
        return `${snapshotId}.${vertexName}.${processorIndex}`;
    }

    private _encode(state: unknown): Uint8Array {
        if (state instanceof Uint8Array) {
            // Wrap binary data with a type marker
            const marker = new Uint8Array([0x00]); // binary marker
            const result = new Uint8Array(1 + state.length);
            result.set(marker);
            result.set(state, 1);
            return result;
        }
        // JSON with a type marker
        const json = JSON.stringify(state);
        const encoded = new TextEncoder().encode(json);
        const marker = new Uint8Array([0x01]); // JSON marker
        const result = new Uint8Array(1 + encoded.length);
        result.set(marker);
        result.set(encoded, 1);
        return result;
    }

    private _decode(data: Uint8Array): unknown {
        if (data.length === 0) return null;
        const marker = data[0];
        const payload = data.slice(1);
        if (marker === 0x00) {
            return payload;
        }
        // JSON
        const json = new TextDecoder().decode(payload);
        return JSON.parse(json);
    }
}
