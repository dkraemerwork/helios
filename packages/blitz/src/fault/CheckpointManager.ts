/**
 * Minimal KV store interface — implemented by NatsKvWindowState.kv in production,
 * or a simple in-memory mock in tests.
 */
export interface CheckpointStore {
    put(key: string, value: Uint8Array): Promise<void>;
    get(key: string): Promise<{ value: Uint8Array } | null>;
}

export interface CheckpointData {
    sequence: number;
    ts: number;
    windowKeys: string[];
}

export interface CheckpointManagerOptions {
    /**
     * Number of consecutive acks between checkpoint writes.
     * @default 100
     */
    intervalAcks?: number;
    /**
     * Time interval in milliseconds between checkpoint writes.
     * Whichever of acks or ms fires first triggers a checkpoint.
     * @default 5000
     */
    intervalMs?: number;
}

/**
 * Persists pipeline progress to a KV store so that a consumer can resume
 * from the last known-good sequence after a crash.
 *
 * KV key format: `checkpoint.{pipelineName}.{consumerName}`
 * KV value format: `{ sequence: number; ts: number; windowKeys: string[] }`
 *
 * Checkpoint triggers (whichever fires first):
 *   - Every `intervalAcks` consecutive acks (default 100)
 *   - Every `intervalMs` milliseconds (default 5000)
 *
 * A missed checkpoint (KV write failure) is logged and does NOT propagate.
 */
export class CheckpointManager {
    private readonly _key: string;
    private readonly _intervalAcks: number;
    private _acksSinceLastCheckpoint = 0;
    private _lastSequence = 0;
    private _lastWindowKeys: string[] = [];
    private _timer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly _store: CheckpointStore,
        pipelineName: string,
        consumerName: string,
        opts?: CheckpointManagerOptions,
    ) {
        this._key = `checkpoint.${pipelineName}.${consumerName}`;
        this._intervalAcks = opts?.intervalAcks ?? 100;
        const intervalMs = opts?.intervalMs ?? 5000;

        this._timer = setInterval(async () => {
            if (this._acksSinceLastCheckpoint > 0 || this._lastSequence > 0) {
                await this._trySave();
            }
        }, intervalMs);
        // Unref so the timer doesn't keep the process alive
        if (typeof (this._timer as any)?.unref === 'function') {
            (this._timer as any).unref();
        }
    }

    /**
     * Called after each successfully ack'd message.
     * Saves checkpoint after every `intervalAcks` calls.
     */
    async onAck(sequence: number, openWindowKeys: string[] = []): Promise<void> {
        this._lastSequence = sequence;
        this._lastWindowKeys = openWindowKeys;
        this._acksSinceLastCheckpoint++;
        if (this._acksSinceLastCheckpoint >= this._intervalAcks) {
            await this._trySave();
        }
    }

    async saveCheckpoint(sequence: number, windowKeys: string[] = []): Promise<void> {
        const data: CheckpointData = { sequence, ts: Date.now(), windowKeys };
        const bytes = new TextEncoder().encode(JSON.stringify(data));
        await this._store.put(this._key, bytes);
        this._acksSinceLastCheckpoint = 0;
    }

    async getCheckpoint(): Promise<CheckpointData | null> {
        const entry = await this._store.get(this._key);
        if (!entry) return null;
        const text = new TextDecoder().decode(entry.value);
        return JSON.parse(text) as CheckpointData;
    }

    shutdown(): void {
        if (this._timer != null) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    private async _trySave(): Promise<void> {
        try {
            await this.saveCheckpoint(this._lastSequence, this._lastWindowKeys);
        } catch (err) {
            console.warn('[CheckpointManager] Failed to write checkpoint:', err);
        }
    }
}
