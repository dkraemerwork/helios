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
import { ExternalStoreClearOperation } from '@zenystx/helios-core/map/impl/operation/ExternalStoreClearOperation';
import { PutBackupOperation } from '@zenystx/helios-core/map/impl/operation/PutBackupOperation';
import { RemoveBackupOperation } from '@zenystx/helios-core/map/impl/operation/RemoveBackupOperation';
import { ExecuteCallableOperation } from '@zenystx/helios-core/executor/impl/ExecuteCallableOperation';
import { MemberCallableOperation } from '@zenystx/helios-core/executor/impl/MemberCallableOperation';
import { CancellationOperation } from '@zenystx/helios-core/executor/impl/CancellationOperation';
import { ShutdownOperation } from '@zenystx/helios-core/executor/impl/ShutdownOperation';

type WirePayload = Record<string, unknown>;

const DATA_MARKER = '__data';

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
    if (value !== null && typeof value === 'object' && typeof (value as Data).toByteArray === 'function') {
        return { [DATA_MARKER]: encodeData(value as Data) };
    }
    if (Array.isArray(value)) {
        return value.map((entry) => encodeResponsePayload(entry));
    }
    if (typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, encodeResponsePayload(entry)]),
        );
    }
    return value;
}

/** Deserialize a response value from the wire. */
export function decodeResponsePayload(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => decodeResponsePayload(entry));
    }
    if (typeof value === 'object' && value !== null && DATA_MARKER in value) {
        return decodeData((value as { [DATA_MARKER]: string })[DATA_MARKER]);
    }
    if (typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, decodeResponsePayload(entry)]),
        );
    }
    return value;
}

function encodeBuffer(value: Buffer): string {
    return value.toString('base64');
}

function decodeBuffer(value: string): Buffer {
    return Buffer.from(value, 'base64');
}

function stringField(payload: WirePayload, key: string): string {
    const value = payload[key];
    if (typeof value !== 'string') {
        throw new Error(`Expected string field "${key}" in operation payload`);
    }
    return value;
}

function numberField(payload: WirePayload, key: string, defaultValue: number): number {
    const value = payload[key];
    if (typeof value === 'number') {
        return value;
    }
    if (value === undefined) {
        return defaultValue;
    }
    throw new Error(`Expected numeric field "${key}" in operation payload`);
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
    if (op instanceof ExternalStoreClearOperation) {
        const o = op as any;
        return {
            operationType: 'MAP_EXTERNAL_CLEAR_OP',
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
    if (op instanceof MemberCallableOperation) {
        return {
            operationType: 'EXECUTOR_MEMBER_CALLABLE_OP',
            payload: {
                taskUuid: op.descriptor.taskUuid,
                executorName: op.descriptor.executorName,
                taskType: op.descriptor.taskType,
                registrationFingerprint: op.descriptor.registrationFingerprint,
                inputData: encodeBuffer(op.descriptor.inputData),
                submitterMemberUuid: op.descriptor.submitterMemberUuid,
                timeoutMillis: op.descriptor.timeoutMillis,
                targetMemberUuid: op.targetMemberUuid,
            },
        };
    }
    if (op instanceof ExecuteCallableOperation) {
        return {
            operationType: 'EXECUTOR_CALLABLE_OP',
            payload: {
                taskUuid: op.descriptor.taskUuid,
                executorName: op.descriptor.executorName,
                taskType: op.descriptor.taskType,
                registrationFingerprint: op.descriptor.registrationFingerprint,
                inputData: encodeBuffer(op.descriptor.inputData),
                submitterMemberUuid: op.descriptor.submitterMemberUuid,
                timeoutMillis: op.descriptor.timeoutMillis,
            },
        };
    }
    if (op instanceof CancellationOperation) {
        return {
            operationType: 'EXECUTOR_CANCEL_OP',
            payload: {
                executorName: op.executorName,
                taskUuid: op.taskUuid,
            },
        };
    }
    if (op instanceof ShutdownOperation) {
        return {
            operationType: 'EXECUTOR_SHUTDOWN_OP',
            payload: {
                executorName: op.executorName,
            },
        };
    }
    throw new Error(`Unsupported operation type for wire serialization: ${op.constructor.name}`);
}

/** Deserialize an operation from wire payload. */
export function deserializeOperation(operationType: string, payload: WirePayload): Operation {
    switch (operationType) {
        case 'MAP_PUT_OP':
            return new PutOperation(stringField(payload, 'mapName'), decodeData(stringField(payload, 'key')), decodeData(stringField(payload, 'value')), numberField(payload, 'ttl', -1), numberField(payload, 'maxIdle', -1));
        case 'MAP_GET_OP':
            return new GetOperation(stringField(payload, 'mapName'), decodeData(stringField(payload, 'key')));
        case 'MAP_REMOVE_OP':
            return new RemoveOperation(stringField(payload, 'mapName'), decodeData(stringField(payload, 'key')));
        case 'MAP_DELETE_OP':
            return new DeleteOperation(stringField(payload, 'mapName'), decodeData(stringField(payload, 'key')));
        case 'MAP_SET_OP':
            return new SetOperation(stringField(payload, 'mapName'), decodeData(stringField(payload, 'key')), decodeData(stringField(payload, 'value')), numberField(payload, 'ttl', -1), numberField(payload, 'maxIdle', -1));
        case 'MAP_PUT_IF_ABSENT_OP':
            return new PutIfAbsentOperation(stringField(payload, 'mapName'), decodeData(stringField(payload, 'key')), decodeData(stringField(payload, 'value')), numberField(payload, 'ttl', -1), numberField(payload, 'maxIdle', -1));
        case 'MAP_CLEAR_OP':
            return new ClearOperation(stringField(payload, 'mapName'));
        case 'MAP_EXTERNAL_CLEAR_OP':
            return new ExternalStoreClearOperation(stringField(payload, 'mapName'));
        case 'MAP_PUT_BACKUP_OP':
            return new PutBackupOperation(stringField(payload, 'mapName'), decodeData(stringField(payload, 'key')), decodeData(stringField(payload, 'value')), numberField(payload, 'ttl', -1), numberField(payload, 'maxIdle', -1));
        case 'MAP_REMOVE_BACKUP_OP':
            return new RemoveBackupOperation(stringField(payload, 'mapName'), decodeData(stringField(payload, 'key')));
        case 'EXECUTOR_CALLABLE_OP':
            return new ExecuteCallableOperation({
                taskUuid: String(payload.taskUuid),
                executorName: String(payload.executorName),
                taskType: String(payload.taskType),
                registrationFingerprint: String(payload.registrationFingerprint),
                inputData: decodeBuffer(String(payload.inputData)),
                submitterMemberUuid: String(payload.submitterMemberUuid),
                timeoutMillis: Number(payload.timeoutMillis),
            });
        case 'EXECUTOR_MEMBER_CALLABLE_OP':
            return new MemberCallableOperation({
                taskUuid: String(payload.taskUuid),
                executorName: String(payload.executorName),
                taskType: String(payload.taskType),
                registrationFingerprint: String(payload.registrationFingerprint),
                inputData: decodeBuffer(String(payload.inputData)),
                submitterMemberUuid: String(payload.submitterMemberUuid),
                timeoutMillis: Number(payload.timeoutMillis),
            }, String(payload.targetMemberUuid));
        case 'EXECUTOR_CANCEL_OP':
            return new CancellationOperation(String(payload.executorName), String(payload.taskUuid));
        case 'EXECUTOR_SHUTDOWN_OP':
            return new ShutdownOperation(String(payload.executorName));
        default:
            throw new Error(`Unknown operation type: ${operationType}`);
    }
}
