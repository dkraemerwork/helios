import type { ExecutorOperationResult } from '@zenystx/helios-core/executor/ExecutorOperationResult';
import { CancellationOperation } from '@zenystx/helios-core/executor/impl/CancellationOperation';
import { ExecuteCallableOperation } from '@zenystx/helios-core/executor/impl/ExecuteCallableOperation';
import { MemberCallableOperation } from '@zenystx/helios-core/executor/impl/MemberCallableOperation';
import { ShutdownOperation } from '@zenystx/helios-core/executor/impl/ShutdownOperation';
import { BIG_ENDIAN, ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';
import { IdentifiedDataSerializableRegistry } from '@zenystx/helios-core/internal/serialization/IdentifiedDataSerializableRegistry';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { ClearOperation } from '@zenystx/helios-core/map/impl/operation/ClearOperation';
import { DeleteOperation } from '@zenystx/helios-core/map/impl/operation/DeleteOperation';
import { ExternalStoreClearOperation } from '@zenystx/helios-core/map/impl/operation/ExternalStoreClearOperation';
import { GetOperation } from '@zenystx/helios-core/map/impl/operation/GetOperation';
import { PutBackupOperation } from '@zenystx/helios-core/map/impl/operation/PutBackupOperation';
import { PutIfAbsentOperation } from '@zenystx/helios-core/map/impl/operation/PutIfAbsentOperation';
import { PutOperation } from '@zenystx/helios-core/map/impl/operation/PutOperation';
import { RemoveBackupOperation } from '@zenystx/helios-core/map/impl/operation/RemoveBackupOperation';
import { RemoveOperation } from '@zenystx/helios-core/map/impl/operation/RemoveOperation';
import { SetOperation } from '@zenystx/helios-core/map/impl/operation/SetOperation';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';

const IDS_FLAG = 0x01;

const RESPONSE_KIND_VOID = 0;
const RESPONSE_KIND_DATA = 1;
const RESPONSE_KIND_BOOLEAN = 2;
const RESPONSE_KIND_NUMBER = 3;
const RESPONSE_KIND_STRING = 4;
const RESPONSE_KIND_DATA_ARRAY = 5;
const RESPONSE_KIND_EXECUTOR_RESULT = 6;
const RESPONSE_KIND_ERROR = 7;

export const MAP_OPERATION_FACTORY_ID = 1;
export const EXECUTOR_OPERATION_FACTORY_ID = 2;

const operationRegistry = new IdentifiedDataSerializableRegistry<Operation>();

type MapWireOperation = {
    readonly mapName: string;
    readonly _key: Data;
    readonly _value?: Data;
    readonly _ttl?: number;
    readonly _maxIdle?: number;
};

function writeMapName(out: ByteArrayObjectDataOutput, op: { readonly mapName: string }): void {
    out.writeString(op.mapName);
}

function writeKeyOnly(out: ByteArrayObjectDataOutput, op: MapWireOperation): void {
    out.writeString(op.mapName);
    out.writeData(op._key);
}

function writeKeyValue(out: ByteArrayObjectDataOutput, op: MapWireOperation): void {
    out.writeString(op.mapName);
    out.writeData(op._key);
    out.writeData(op._value ?? null);
    out.writeLong(BigInt(op._ttl ?? -1));
    out.writeLong(BigInt(op._maxIdle ?? -1));
}

function registerOperations(): void {
    operationRegistry.register(PutOperation, MAP_OPERATION_FACTORY_ID, 1, (out, op) => writeKeyValue(out, op as unknown as MapWireOperation), (inp) =>
        new PutOperation(readRequiredString(inp), readRequiredData(inp), readRequiredData(inp), readLongAsNumber(inp), readLongAsNumber(inp)));
    operationRegistry.register(GetOperation, MAP_OPERATION_FACTORY_ID, 2, (out, op) => writeKeyOnly(out, op as unknown as MapWireOperation), (inp) =>
        new GetOperation(readRequiredString(inp), readRequiredData(inp)));
    operationRegistry.register(RemoveOperation, MAP_OPERATION_FACTORY_ID, 3, (out, op) => writeKeyOnly(out, op as unknown as MapWireOperation), (inp) =>
        new RemoveOperation(readRequiredString(inp), readRequiredData(inp)));
    operationRegistry.register(DeleteOperation, MAP_OPERATION_FACTORY_ID, 4, (out, op) => writeKeyOnly(out, op as unknown as MapWireOperation), (inp) =>
        new DeleteOperation(readRequiredString(inp), readRequiredData(inp)));
    operationRegistry.register(SetOperation, MAP_OPERATION_FACTORY_ID, 5, (out, op) => writeKeyValue(out, op as unknown as MapWireOperation), (inp) =>
        new SetOperation(readRequiredString(inp), readRequiredData(inp), readRequiredData(inp), readLongAsNumber(inp), readLongAsNumber(inp)));
    operationRegistry.register(PutIfAbsentOperation, MAP_OPERATION_FACTORY_ID, 6, (out, op) => writeKeyValue(out, op as unknown as MapWireOperation), (inp) =>
        new PutIfAbsentOperation(readRequiredString(inp), readRequiredData(inp), readRequiredData(inp), readLongAsNumber(inp), readLongAsNumber(inp)));
    operationRegistry.register(ClearOperation, MAP_OPERATION_FACTORY_ID, 7, (out, op) => writeMapName(out, op as unknown as { mapName: string }), (inp) =>
        new ClearOperation(readRequiredString(inp)));
    operationRegistry.register(ExternalStoreClearOperation, MAP_OPERATION_FACTORY_ID, 8, (out, op) => writeMapName(out, op as unknown as { mapName: string }), (inp) =>
        new ExternalStoreClearOperation(readRequiredString(inp)));
    operationRegistry.register(PutBackupOperation, MAP_OPERATION_FACTORY_ID, 9, (out, op) => writeKeyValue(out, op as unknown as MapWireOperation), (inp) =>
        new PutBackupOperation(readRequiredString(inp), readRequiredData(inp), readRequiredData(inp), readLongAsNumber(inp), readLongAsNumber(inp)));
    operationRegistry.register(RemoveBackupOperation, MAP_OPERATION_FACTORY_ID, 10, (out, op) => writeKeyOnly(out, op as unknown as MapWireOperation), (inp) =>
        new RemoveBackupOperation(readRequiredString(inp), readRequiredData(inp)));

    operationRegistry.register(ExecuteCallableOperation, EXECUTOR_OPERATION_FACTORY_ID, 1, (out, op) => {
        out.writeString(op.descriptor.taskUuid);
        out.writeString(op.descriptor.executorName);
        out.writeString(op.descriptor.taskType);
        out.writeString(op.descriptor.registrationFingerprint);
        out.writeByteArray(op.descriptor.inputData);
        out.writeString(op.descriptor.submitterMemberUuid);
        out.writeLong(BigInt(op.descriptor.timeoutMillis));
    }, (inp) => new ExecuteCallableOperation({
        taskUuid: readRequiredString(inp),
        executorName: readRequiredString(inp),
        taskType: readRequiredString(inp),
        registrationFingerprint: readRequiredString(inp),
        inputData: inp.readByteArray() ?? Buffer.alloc(0),
        submitterMemberUuid: readRequiredString(inp),
        timeoutMillis: readLongAsNumber(inp),
    }));

    operationRegistry.register(MemberCallableOperation, EXECUTOR_OPERATION_FACTORY_ID, 2, (out, op) => {
        out.writeString(op.descriptor.taskUuid);
        out.writeString(op.descriptor.executorName);
        out.writeString(op.descriptor.taskType);
        out.writeString(op.descriptor.registrationFingerprint);
        out.writeByteArray(op.descriptor.inputData);
        out.writeString(op.descriptor.submitterMemberUuid);
        out.writeLong(BigInt(op.descriptor.timeoutMillis));
        out.writeString(op.targetMemberUuid);
    }, (inp) => new MemberCallableOperation({
        taskUuid: readRequiredString(inp),
        executorName: readRequiredString(inp),
        taskType: readRequiredString(inp),
        registrationFingerprint: readRequiredString(inp),
        inputData: inp.readByteArray() ?? Buffer.alloc(0),
        submitterMemberUuid: readRequiredString(inp),
        timeoutMillis: readLongAsNumber(inp),
    }, readRequiredString(inp)));

    operationRegistry.register(CancellationOperation, EXECUTOR_OPERATION_FACTORY_ID, 3, (out, op) => {
        out.writeString(op.executorName);
        out.writeString(op.taskUuid);
    }, (inp) => new CancellationOperation(readRequiredString(inp), readRequiredString(inp)));

    operationRegistry.register(ShutdownOperation, EXECUTOR_OPERATION_FACTORY_ID, 4, (out, op) => {
        out.writeString(op.executorName);
    }, (inp) => new ShutdownOperation(readRequiredString(inp)));
}

registerOperations();

export function serializeOperation(op: Operation): { factoryId: number; classId: number; payload: Buffer } {
    const out = new ByteArrayObjectDataOutput(128, null, BIG_ENDIAN);
    const { factoryId, classId } = operationRegistry.encode(out, op);
    return {
        factoryId,
        classId,
        payload: out.toByteArray(),
    };
}

export function deserializeOperation(factoryId: number, classId: number, payload: Buffer): Operation {
    const inp = new ByteArrayObjectDataInput(payload, null as never, BIG_ENDIAN);
    return operationRegistry.decode(factoryId, classId, inp);
}

export function writeOperationPayload(out: ByteArrayObjectDataOutput, op: Operation): { factoryId: number; classId: number } {
    out.writeByte(IDS_FLAG);
    const ids = operationRegistry.getIds(op);
    out.writeShort(ids.factoryId);
    out.writeShort(ids.classId);
    operationRegistry.encode(out, op);
    return ids;
}

export function readOperationPayload(inp: ByteArrayObjectDataInput): Operation {
    const idsFlag = inp.readUnsignedByte();
    if ((idsFlag & IDS_FLAG) === 0) {
        throw new Error('Unsupported operation payload without IDS flag');
    }
    return operationRegistry.decode(inp.readUnsignedShort(), inp.readUnsignedShort(), inp);
}

export function encodeResponsePayload(value: unknown): { kind: number; payload: Buffer } {
    const out = new ByteArrayObjectDataOutput(128, null, BIG_ENDIAN);
    const kind = writeResponsePayload(out, value);
    return { kind, payload: out.toByteArray() };
}

export function decodeResponsePayload(kind: number, payload: Buffer): unknown {
    const inp = new ByteArrayObjectDataInput(payload, null as never, BIG_ENDIAN);
    return readResponsePayload(kind, inp);
}

export function writeResponsePayload(out: ByteArrayObjectDataOutput, value: unknown): number {
    if (value === null || value === undefined) {
        return RESPONSE_KIND_VOID;
    }
    if (isData(value)) {
        out.writeData(value);
        return RESPONSE_KIND_DATA;
    }
    if (typeof value === 'boolean') {
        out.writeBoolean(value);
        return RESPONSE_KIND_BOOLEAN;
    }
    if (typeof value === 'number') {
        out.writeLong(BigInt(value));
        return RESPONSE_KIND_NUMBER;
    }
    if (typeof value === 'string') {
        out.writeString(value);
        return RESPONSE_KIND_STRING;
    }
    if (Array.isArray(value) && value.every((entry) => isData(entry))) {
        out.writeInt(value.length);
        for (const entry of value) {
            out.writeData(entry);
        }
        return RESPONSE_KIND_DATA_ARRAY;
    }
    if (isExecutorOperationResult(value)) {
        out.writeString(value.taskUuid);
        out.writeString(value.status);
        out.writeString(value.originMemberUuid);
        out.writeData(value.resultData);
        out.writeString(value.errorName);
        out.writeString(value.errorMessage);
        return RESPONSE_KIND_EXECUTOR_RESULT;
    }
    if (value instanceof Error) {
        out.writeString(value.name);
        out.writeString(value.message);
        out.writeString(value.stack ?? null);
        return RESPONSE_KIND_ERROR;
    }
    throw new Error(`Unsupported operation response payload: ${describeValue(value)}`);
}

export function readResponsePayload(kind: number, inp: ByteArrayObjectDataInput): unknown {
    switch (kind) {
        case RESPONSE_KIND_VOID:
            return null;
        case RESPONSE_KIND_DATA:
            return inp.readData();
        case RESPONSE_KIND_BOOLEAN:
            return inp.readBoolean();
        case RESPONSE_KIND_NUMBER:
            return Number(inp.readLong());
        case RESPONSE_KIND_STRING:
            return inp.readString();
        case RESPONSE_KIND_DATA_ARRAY: {
            const length = inp.readInt();
            const values: Data[] = new Array(length);
            for (let index = 0; index < length; index++) {
                values[index] = readRequiredData(inp);
            }
            return values;
        }
        case RESPONSE_KIND_EXECUTOR_RESULT:
            return {
                taskUuid: readRequiredString(inp),
                status: readRequiredString(inp) as ExecutorOperationResult['status'],
                originMemberUuid: readRequiredString(inp),
                resultData: inp.readData(),
                errorName: inp.readString(),
                errorMessage: inp.readString(),
            } satisfies ExecutorOperationResult;
        case RESPONSE_KIND_ERROR:
            return new Error(readRequiredString(inp));
        default:
            throw new Error(`Unknown operation response kind: ${kind}`);
    }
}

function isData(value: unknown): value is Data {
    return value !== null && typeof value === 'object' && typeof (value as Data).toByteArray === 'function';
}

function isExecutorOperationResult(value: unknown): value is ExecutorOperationResult {
    return value !== null
        && typeof value === 'object'
        && typeof (value as ExecutorOperationResult).taskUuid === 'string'
        && typeof (value as ExecutorOperationResult).status === 'string'
        && typeof (value as ExecutorOperationResult).originMemberUuid === 'string'
        && 'resultData' in (value as ExecutorOperationResult);
}

function readRequiredString(inp: ByteArrayObjectDataInput): string {
    const value = inp.readString();
    if (value === null) {
        throw new Error('Expected string value');
    }
    return value;
}

function readRequiredData(inp: ByteArrayObjectDataInput): Data {
    const value = inp.readData();
    if (value === null) {
        throw new Error('Expected data value');
    }
    return value;
}

function readLongAsNumber(inp: ByteArrayObjectDataInput): number {
    return Number(inp.readLong());
}

function describeValue(value: unknown): string {
    if (value === null) {
        return 'null';
    }
    if (value === undefined) {
        return 'undefined';
    }
    if (Buffer.isBuffer(value)) {
        return 'Buffer';
    }
    if (typeof value === 'object') {
        return (value as object).constructor.name;
    }
    return typeof value;
}

export function encodeData(data: Data): Buffer {
    const bytes = data.toByteArray();
    if (bytes === null) {
        throw new Error('Cannot encode null Data');
    }
    return Buffer.from(bytes);
}

export function decodeData(encoded: Buffer): Data {
    return new HeapData(Buffer.from(encoded));
}
