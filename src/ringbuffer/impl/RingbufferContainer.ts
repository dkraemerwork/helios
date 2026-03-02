import type { Data } from '@helios/internal/serialization/Data';
import type { ObjectNamespace } from '@helios/internal/services/ObjectNamespace';
import type { SerializationService } from '@helios/internal/serialization/SerializationService';
import type { NodeEngine } from '@helios/spi/NodeEngine';
import { InMemoryFormat } from '@helios/config/InMemoryFormat';
import { RingbufferConfig } from '@helios/config/RingbufferConfig';
import { ArrayRingbuffer } from '@helios/ringbuffer/impl/ArrayRingbuffer';
import { RingbufferExpirationPolicy } from '@helios/ringbuffer/impl/RingbufferExpirationPolicy';
import { RingbufferWaitNotifyKey } from '@helios/ringbuffer/impl/RingbufferWaitNotifyKey';
import { ReadResultSetImpl } from '@helios/ringbuffer/impl/ReadResultSetImpl';
import { StaleSequenceException } from '@helios/ringbuffer/StaleSequenceException';

/**
 * Port of {@code com.hazelcast.ringbuffer.impl.RingbufferContainer}.
 *
 * Manages the ringbuffer data structure: TTL expiration, store integration,
 * wait/notify key, and serialization format conversion.
 */
export class RingbufferContainer<T = unknown, E = unknown> {
    private static readonly TTL_DISABLED = 0;

    private readonly objectNamespace: ObjectNamespace;
    private readonly emptyRingWaitNotifyKey: RingbufferWaitNotifyKey;
    private _expirationPolicy: RingbufferExpirationPolicy | null = null;
    private inMemoryFormat: InMemoryFormat;
    private _config: RingbufferConfig;
    private serializationService: SerializationService;
    private readonly ringbuffer: ArrayRingbuffer<E>;

    constructor(
        namespace: ObjectNamespace,
        config: RingbufferConfig,
        nodeEngine: NodeEngine,
        partitionId: number,
    ) {
        this.objectNamespace = namespace;
        this._config = config;
        this.emptyRingWaitNotifyKey = new RingbufferWaitNotifyKey(namespace, partitionId);
        this.inMemoryFormat = config.getInMemoryFormat();
        this.ringbuffer = new ArrayRingbuffer<E>(config.getCapacity());
        this.serializationService = nodeEngine.getSerializationService();

        const ttlMs = config.getTimeToLiveSeconds() * 1000;
        if (ttlMs !== RingbufferContainer.TTL_DISABLED) {
            this._expirationPolicy = new RingbufferExpirationPolicy(this.ringbuffer.getCapacity(), ttlMs);
        }
    }

    getConfig(): RingbufferConfig { return this._config; }
    getExpirationPolicy(): RingbufferExpirationPolicy | null { return this._expirationPolicy; }
    getRingbuffer(): ArrayRingbuffer<E> { return this.ringbuffer; }
    getRingEmptyWaitNotifyKey(): RingbufferWaitNotifyKey { return this.emptyRingWaitNotifyKey; }
    getObjectNamespace(): ObjectNamespace { return this.objectNamespace; }

    tailSequence(): number { return this.ringbuffer.tailSequence(); }
    headSequence(): number { return this.ringbuffer.headSequence(); }

    setHeadSequence(sequence: number): void { this.ringbuffer.setHeadSequence(sequence); }
    setTailSequence(sequence: number): void { this.ringbuffer.setTailSequence(sequence); }

    getCapacity(): number { return this.ringbuffer.getCapacity(); }
    size(): number { return this.ringbuffer.size(); }
    isEmpty(): boolean { return this.ringbuffer.isEmpty(); }

    /**
     * Remaining capacity. If TTL is enabled, it's capacity - size.
     * If TTL disabled, it's always full capacity.
     */
    remainingCapacity(): number {
        if (this._expirationPolicy !== null) {
            return this.ringbuffer.getCapacity() - this.size();
        }
        return this.ringbuffer.getCapacity();
    }

    isStaleSequence(sequence: number): boolean {
        return sequence < this.headSequence();
    }

    isTooLargeSequence(sequence: number): boolean {
        return sequence > this.tailSequence() + 1;
    }

    /**
     * Check whether the caller should wait for the sequence.
     * Throws if the sequence is invalid.
     */
    shouldWait(sequence: number): boolean {
        this.checkBlockableReadSequence(sequence);
        return sequence === this.ringbuffer.tailSequence() + 1;
    }

    checkBlockableReadSequence(readSequence: number): void {
        if (this.isTooLargeSequence(readSequence)) {
            throw new Error(
                `sequence:${readSequence} is too large. The current tailSequence is:${this.tailSequence()}`
            );
        }
        if (this.isStaleSequence(readSequence)) {
            throw new StaleSequenceException(
                `sequence:${readSequence} is too small. The current headSequence is:${this.headSequence()} tailSequence is:${this.tailSequence()}`,
                this.headSequence()
            );
        }
    }

    /**
     * Clamp a read sequence to valid bounds. Used by ReadManyOperation.
     */
    clampReadSequenceToBounds(readSequence: number): number {
        const headSequence = this.headSequence();
        if (readSequence < headSequence) {
            return headSequence;
        }
        const tailSequence = this.tailSequence();
        if (readSequence > tailSequence + 1) {
            return tailSequence + 1;
        }
        return readSequence;
    }

    /**
     * Add one item. Sets expiration if TTL configured.
     * The item can be Data or a plain object; it is converted to the configured
     * in-memory format.
     */
    add(item: T): number {
        const storedSequence = this.addInternal(item);
        return storedSequence;
    }

    /**
     * Add all items. Returns sequence of last added item.
     */
    addAll(items: T[]): number {
        let lastSequence = this.ringbuffer.peekNextTailSequence();
        for (const item of items) {
            lastSequence = this.addInternal(item);
        }
        return lastSequence;
    }

    /**
     * Set an item at a specific sequence (used for replication/migration).
     */
    set(sequenceId: number, item: T): void {
        const rbItem = this.convertToRingbufferFormat(item);
        this.ringbuffer.set(sequenceId, rbItem);

        if (sequenceId > this.tailSequence()) {
            this.ringbuffer.setTailSequence(sequenceId);
            if (this.ringbuffer.size() > this.ringbuffer.getCapacity()) {
                this.ringbuffer.setHeadSequence(this.ringbuffer.tailSequence() - this.ringbuffer.getCapacity() + 1);
            }
        }
        if (sequenceId < this.headSequence()) {
            this.ringbuffer.setHeadSequence(sequenceId);
        }
        if (this._expirationPolicy !== null) {
            this._expirationPolicy.setExpirationAt(sequenceId);
        }
    }

    /**
     * Read one item as Data (serialized). Throws if sequence is out of range.
     */
    readAsData(sequence: number): Data {
        this.checkReadSequence(sequence);
        const rbItem = this.ringbuffer.read(sequence);
        const data = this.serializationService.toData(rbItem);
        if (data === null) {
            throw new Error(`readAsData: null data at sequence ${sequence}`);
        }
        return data;
    }

    /**
     * Read multiple items from beginSequence into result.
     * Returns the next sequence to read from.
     */
    readMany<O>(beginSequence: number, result: ReadResultSetImpl<O>): number {
        this.checkReadSequence(beginSequence);
        let seq = beginSequence;
        while (seq <= this.ringbuffer.tailSequence()) {
            result.addItem(seq, this.ringbuffer.read(seq));
            seq++;
            if (result.isMaxSizeReached()) {
                break;
            }
        }
        return seq;
    }

    /** Remove expired items from the head. */
    cleanup(): void {
        if (this._expirationPolicy !== null) {
            this._expirationPolicy.cleanup(this.ringbuffer);
        }
    }

    /** Remove expired items only if remaining capacity is below a threshold. */
    maybeCleanup(threshold: number): void {
        if (this._expirationPolicy !== null && this.remainingCapacity() < threshold) {
            this._expirationPolicy.cleanup(this.ringbuffer);
        }
    }

    /** Clear all data. */
    clear(): void {
        this.ringbuffer.clear();
        if (this._expirationPolicy !== null) {
            this._expirationPolicy.clear();
        }
    }

    // ── private helpers ──────────────────────────────────────────────────

    private addInternal(item: T): number {
        const rbItem = this.convertToRingbufferFormat(item);
        const tailSequence = this.ringbuffer.add(rbItem);
        if (this._expirationPolicy !== null) {
            this._expirationPolicy.setExpirationAt(tailSequence);
        }
        return tailSequence;
    }

    private convertToRingbufferFormat(item: unknown): E {
        if (this.inMemoryFormat === InMemoryFormat.OBJECT) {
            // Store as object (deserialized)
            if (item !== null && typeof item === 'object' && 'toByteArray' in item) {
                // item is Data, deserialize it
                return this.serializationService.toObject<E>(item as Data) as E;
            }
            return item as E;
        } else {
            // Store as Data (serialized)
            if (item !== null && typeof item === 'object' && 'toByteArray' in item) {
                return item as unknown as E;
            }
            return this.serializationService.toData(item) as unknown as E;
        }
    }

    private checkReadSequence(sequence: number): void {
        const tailSequence = this.ringbuffer.tailSequence();
        if (sequence > tailSequence) {
            throw new Error(
                `sequence:${sequence} is too large. The current tailSequence is:${tailSequence}`
            );
        }
        if (this.isStaleSequence(sequence)) {
            throw new StaleSequenceException(
                `sequence:${sequence} is too small. The current headSequence is:${this.headSequence()} tailSequence is:${tailSequence}`,
                this.headSequence()
            );
        }
    }
}
