/**
 * Multi-structure persistence adapter.
 * Supports WAL recording for MAP, QUEUE, CACHE, and RINGBUFFER data structures.
 */
import type { WriteAheadLog } from './WriteAheadLog.js';
import { WALEntryType } from './WriteAheadLog.js';

export enum StructureType {
    MAP = 0,
    QUEUE = 1,
    CACHE = 2,
    RINGBUFFER = 3,
}

export interface PersistenceRecord {
    readonly structureType: StructureType;
    readonly structureName: string;
    readonly operation: 'PUT' | 'REMOVE' | 'CLEAR' | 'OFFER' | 'POLL' | 'ADD';
    readonly keyData: Buffer | null;
    readonly valueData: Buffer | null;
    readonly sequence: number;
    readonly timestamp: number;
}

/**
 * Maps PersistenceRecord operation names to WALEntryType values.
 */
function operationToWALType(operation: PersistenceRecord['operation']): WALEntryType {
    switch (operation) {
        case 'PUT':
            return WALEntryType.PUT;
        case 'REMOVE':
            return WALEntryType.REMOVE;
        case 'CLEAR':
            return WALEntryType.CLEAR;
        case 'OFFER':
            return WALEntryType.OFFER;
        case 'POLL':
            return WALEntryType.POLL;
        case 'ADD':
            return WALEntryType.ADD;
    }
}

/**
 * Encodes the structure type and name into the mapName field with a prefix,
 * so the WAL records carry full structure identity without a schema change.
 *
 * Format: "<structureTypeByte>:<structureName>"
 */
function encodeStructureKey(structureType: StructureType, structureName: string): string {
    return `${structureType}:${structureName}`;
}

export interface StructurePersistenceAdapter {
    recordPut(structureName: string, key: Buffer, value: Buffer): void;
    recordRemove(structureName: string, key: Buffer): void;
    recordClear(structureName: string): void;
    recordOffer(structureName: string, value: Buffer): void;
    recordPoll(structureName: string): void;
    recordRingbufferAdd(structureName: string, sequence: number, value: Buffer): void;
}

/**
 * Base adapter that writes to a shared WriteAheadLog.
 */
abstract class BaseStructureAdapter {
    protected readonly _wal: WriteAheadLog;
    protected readonly _structureType: StructureType;

    constructor(wal: WriteAheadLog, structureType: StructureType) {
        this._wal = wal;
        this._structureType = structureType;
    }

    protected _append(
        structureName: string,
        operation: WALEntryType,
        key: Uint8Array | null,
        value: Uint8Array | null,
        partitionId = 0,
    ): void {
        const structureKey = encodeStructureKey(this._structureType, structureName);
        this._wal.append({
            type: operation,
            mapName: structureKey,
            partitionId,
            key,
            value,
        });
    }
}

/**
 * Persistence adapter for IMap.
 */
export class MapPersistenceAdapter extends BaseStructureAdapter implements StructurePersistenceAdapter {
    constructor(wal: WriteAheadLog) {
        super(wal, StructureType.MAP);
    }

    recordPut(structureName: string, key: Buffer, value: Buffer): void {
        this._append(structureName, WALEntryType.PUT, new Uint8Array(key), new Uint8Array(value));
    }

    recordRemove(structureName: string, key: Buffer): void {
        this._append(structureName, WALEntryType.REMOVE, new Uint8Array(key), null);
    }

    recordClear(structureName: string): void {
        this._append(structureName, WALEntryType.CLEAR, null, null);
    }

    recordOffer(_structureName: string, _value: Buffer): void {
        // Not applicable for maps
    }

    recordPoll(_structureName: string): void {
        // Not applicable for maps
    }

    recordRingbufferAdd(_structureName: string, _sequence: number, _value: Buffer): void {
        // Not applicable for maps
    }
}

/**
 * Persistence adapter for IQueue.
 */
export class QueuePersistenceAdapter extends BaseStructureAdapter implements StructurePersistenceAdapter {
    constructor(wal: WriteAheadLog) {
        super(wal, StructureType.QUEUE);
    }

    recordPut(_structureName: string, _key: Buffer, _value: Buffer): void {
        // Not applicable for queues (use recordOffer instead)
    }

    recordRemove(_structureName: string, _key: Buffer): void {
        // Not applicable for queues (use recordPoll instead)
    }

    recordClear(structureName: string): void {
        this._append(structureName, WALEntryType.CLEAR, null, null);
    }

    recordOffer(structureName: string, value: Buffer): void {
        this._append(structureName, WALEntryType.OFFER, null, new Uint8Array(value));
    }

    recordPoll(structureName: string): void {
        this._append(structureName, WALEntryType.POLL, null, null);
    }

    recordRingbufferAdd(_structureName: string, _sequence: number, _value: Buffer): void {
        // Not applicable for queues
    }
}

/**
 * Persistence adapter for ICache (JCache-compatible).
 */
export class CachePersistenceAdapter extends BaseStructureAdapter implements StructurePersistenceAdapter {
    constructor(wal: WriteAheadLog) {
        super(wal, StructureType.CACHE);
    }

    recordPut(structureName: string, key: Buffer, value: Buffer): void {
        this._append(structureName, WALEntryType.PUT, new Uint8Array(key), new Uint8Array(value));
    }

    recordRemove(structureName: string, key: Buffer): void {
        this._append(structureName, WALEntryType.REMOVE, new Uint8Array(key), null);
    }

    recordClear(structureName: string): void {
        this._append(structureName, WALEntryType.CLEAR, null, null);
    }

    recordOffer(_structureName: string, _value: Buffer): void {
        // Not applicable for caches
    }

    recordPoll(_structureName: string): void {
        // Not applicable for caches
    }

    recordRingbufferAdd(_structureName: string, _sequence: number, _value: Buffer): void {
        // Not applicable for caches
    }
}

/**
 * Persistence adapter for Ringbuffer.
 * Encodes the sequence number in the key field as a big-endian 8-byte buffer.
 */
export class RingbufferPersistenceAdapter extends BaseStructureAdapter implements StructurePersistenceAdapter {
    constructor(wal: WriteAheadLog) {
        super(wal, StructureType.RINGBUFFER);
    }

    recordPut(_structureName: string, _key: Buffer, _value: Buffer): void {
        // Not applicable for ringbuffers
    }

    recordRemove(_structureName: string, _key: Buffer): void {
        // Not applicable for ringbuffers
    }

    recordClear(structureName: string): void {
        this._append(structureName, WALEntryType.CLEAR, null, null);
    }

    recordOffer(_structureName: string, _value: Buffer): void {
        // Not applicable for ringbuffers (use recordRingbufferAdd)
    }

    recordPoll(_structureName: string): void {
        // Not applicable for ringbuffers
    }

    recordRingbufferAdd(structureName: string, sequence: number, value: Buffer): void {
        // Encode the sequence as an 8-byte big-endian key
        const keyBuf = Buffer.allocUnsafe(8);
        keyBuf.writeBigInt64BE(BigInt(sequence), 0);
        this._append(structureName, WALEntryType.ADD, new Uint8Array(keyBuf), new Uint8Array(value));
    }
}

/**
 * Decode a WAL mapName field back to structure type and name.
 */
export function decodeStructureKey(mapName: string): { structureType: StructureType; structureName: string } | null {
    const colonIndex = mapName.indexOf(':');
    if (colonIndex === -1) return null;

    const typeStr = mapName.substring(0, colonIndex);
    const structureType = parseInt(typeStr, 10) as StructureType;
    if (isNaN(structureType) || !(structureType in StructureType)) return null;

    const structureName = mapName.substring(colonIndex + 1);
    return { structureType, structureName };
}
