/**
 * Block 21.1 — Wire codec for serializing/deserializing map operations
 * for remote execution via OPERATION/OPERATION_RESPONSE cluster messages.
 *
 * Each operation type has a unique string identifier and a payload format
 * that carries the operation's constructor arguments.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import { PutOperation } from '@zenystx/helios-core/map/impl/operation/PutOperation';
import { GetOperation } from '@zenystx/helios-core/map/impl/operation/GetOperation';
import { RemoveOperation } from '@zenystx/helios-core/map/impl/operation/RemoveOperation';
import { DeleteOperation } from '@zenystx/helios-core/map/impl/operation/DeleteOperation';
import { SetOperation } from '@zenystx/helios-core/map/impl/operation/SetOperation';
import { PutIfAbsentOperation } from '@zenystx/helios-core/map/impl/operation/PutIfAbsentOperation';
import { ClearOperation } from '@zenystx/helios-core/map/impl/operation/ClearOperation';
import { PutBackupOperation } from '@zenystx/helios-core/map/impl/operation/PutBackupOperation';
import { RemoveBackupOperation } from '@zenystx/helios-core/map/impl/operation/RemoveBackupOperation';

interface WirePayload {
    mapName: string;
    key?: string;
    value?: string;
    ttl?: number;
    maxIdle?: number;
}

function encodeData(data: Data): string {
    const bytes = data.toByteArray();
    if (bytes === null) throw new Error('Cannot encode null Data');
    return bytes.toString('base64');
}

function decodeData(encoded: string): Data {
    return new HeapData(Buffer.from(encoded, 'base64'));
}

/** Serialize a response value for the wire. */
export function encodeResponsePayload(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        return value;
    }
    // Data objects
    if (value !== null && typeof value === 'object' && typeof (value as Data).toByteArray === 'function') {
        return { __data: encodeData(value as Data) };
    }
    return value;
}

/** Deserialize a response value from the wire. */
export function decodeResponsePayload(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        return value;
    }
    if (typeof value === 'object' && value !== null && '__data' in value) {
        return decodeData((value as { __data: string }).__data);
    }
    return value;
}

/** Serialize an operation to a wire-friendly payload. */
export function serializeOperation(op: Operation): { operationType: string; payload: WirePayload } {
    if (op instanceof PutOperation) {
        const o = op as any;
        return {
            operationType: 'MAP_PUT_OP',
            payload: { mapName: o.mapName, key: encodeData(o._key), value: encodeData(o._value), ttl: o._ttl, maxIdle: o._maxIdle },
        };
    }
    if (op instanceof GetOperation) {
        const o = op as any;
        return {
            operationType: 'MAP_GET_OP',
            payload: { mapName: o.mapName, key: encodeData(o._key) },
        };
    }
    if (op instanceof RemoveOperation) {
        const o = op as any;
        return {
            operationType: 'MAP_REMOVE_OP',
            payload: { mapName: o.mapName, key: encodeData(o._key) },
        };
    }
    if (op instanceof DeleteOperation) {
        const o = op as any;
        return {
            operationType: 'MAP_DELETE_OP',
            payload: { mapName: o.mapName, key: encodeData(o._key) },
        };
    }
    if (op instanceof SetOperation) {
        const o = op as any;
        return {
            operationType: 'MAP_SET_OP',
            payload: { mapName: o.mapName, key: encodeData(o._key), value: encodeData(o._value), ttl: o._ttl, maxIdle: o._maxIdle },
        };
    }
    if (op instanceof PutIfAbsentOperation) {
        const o = op as any;
        return {
            operationType: 'MAP_PUT_IF_ABSENT_OP',
            payload: { mapName: o.mapName, key: encodeData(o._key), value: encodeData(o._value), ttl: o._ttl, maxIdle: o._maxIdle },
        };
    }
    if (op instanceof ClearOperation) {
        const o = op as any;
        return {
            operationType: 'MAP_CLEAR_OP',
            payload: { mapName: o.mapName },
        };
    }
    if (op instanceof PutBackupOperation) {
        const o = op as any;
        return {
            operationType: 'MAP_PUT_BACKUP_OP',
            payload: { mapName: o.mapName, key: encodeData(o._key), value: encodeData(o._value), ttl: o._ttl, maxIdle: o._maxIdle },
        };
    }
    if (op instanceof RemoveBackupOperation) {
        const o = op as any;
        return {
            operationType: 'MAP_REMOVE_BACKUP_OP',
            payload: { mapName: o.mapName, key: encodeData(o._key) },
        };
    }
    throw new Error(`Unsupported operation type for wire serialization: ${op.constructor.name}`);
}

/** Deserialize an operation from wire payload. */
export function deserializeOperation(operationType: string, payload: WirePayload): Operation {
    switch (operationType) {
        case 'MAP_PUT_OP':
            return new PutOperation(payload.mapName, decodeData(payload.key!), decodeData(payload.value!), payload.ttl ?? -1, payload.maxIdle ?? -1);
        case 'MAP_GET_OP':
            return new GetOperation(payload.mapName, decodeData(payload.key!));
        case 'MAP_REMOVE_OP':
            return new RemoveOperation(payload.mapName, decodeData(payload.key!));
        case 'MAP_DELETE_OP':
            return new DeleteOperation(payload.mapName, decodeData(payload.key!));
        case 'MAP_SET_OP':
            return new SetOperation(payload.mapName, decodeData(payload.key!), decodeData(payload.value!), payload.ttl ?? -1, payload.maxIdle ?? -1);
        case 'MAP_PUT_IF_ABSENT_OP':
            return new PutIfAbsentOperation(payload.mapName, decodeData(payload.key!), decodeData(payload.value!), payload.ttl ?? -1, payload.maxIdle ?? -1);
        case 'MAP_CLEAR_OP':
            return new ClearOperation(payload.mapName);
        case 'MAP_PUT_BACKUP_OP':
            return new PutBackupOperation(payload.mapName, decodeData(payload.key!), decodeData(payload.value!), payload.ttl ?? -1, payload.maxIdle ?? -1);
        case 'MAP_REMOVE_BACKUP_OP':
            return new RemoveBackupOperation(payload.mapName, decodeData(payload.key!));
        default:
            throw new Error(`Unknown operation type: ${operationType}`);
    }
}
