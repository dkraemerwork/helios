import { ClientMessage, ClientMessageFrame } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import {
    FixedSizeTypesCodec,
    INT_SIZE_IN_BYTES,
    LONG_SIZE_IN_BYTES,
} from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { SerializationConfig } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import { afterEach, describe, expect, test } from 'bun:test';

const AL_APPLY_REQUEST = 0x090100;
const AL_ALTER_REQUEST = 0x090200;
const AL_ADD_AND_GET_REQUEST = 0x090300;
const AL_COMPARE_AND_SET_REQUEST = 0x090400;
const AL_GET_REQUEST = 0x090500;
const AL_GET_AND_ADD_REQUEST = 0x090600;
const AL_GET_AND_SET_REQUEST = 0x090700;
const AL_GET_AND_ALTER_REQUEST = 0x090800;
const AL_ALTER_AND_GET_REQUEST = 0x090900;
const AL_SET_REQUEST = 0x090a00;

const CP_GROUP_CREATE_REQUEST = 0x1e0100;
const CP_GROUP_DESTROY_REQUEST = 0x1e0200;
const AR_COMPARE_AND_SET_REQUEST = 0x0a0200;
const AR_CONTAINS_REQUEST = 0x0a0300;
const AR_GET_REQUEST = 0x0a0400;
const AR_SET_REQUEST = 0x0a0500;
const AR_APPLY_REQUEST = 0x0a0600;
const AR_ALTER_REQUEST = 0x0a0700;
const AR_GET_AND_ALTER_REQUEST = 0x0a0800;
const AR_ALTER_AND_GET_REQUEST = 0x0a0900;
const AR_IS_NULL_REQUEST = 0x0c0800;
const AR_CLEAR_REQUEST = 0x0c0900;
const AR_COMPARE_AND_SET_LEGACY_REQUEST = 0x0c0a00;

const CDL_TRY_SET_COUNT_REQUEST = 0x0b0100;
const CDL_AWAIT_REQUEST = 0x0b0200;
const CDL_COUNT_DOWN_REQUEST = 0x0b0300;
const CDL_GET_COUNT_REQUEST = 0x0b0400;
const CDL_GET_ROUND_REQUEST = 0x0b0500;

const SEM_INIT_REQUEST = 0x0c0100;
const SEM_ACQUIRE_REQUEST = 0x0c0200;
const SEM_RELEASE_REQUEST = 0x0c0300;
const SEM_DRAIN_REQUEST = 0x0c0400;
const SEM_CHANGE_REQUEST = 0x0c0500;
const SEM_AVAILABLE_PERMITS_REQUEST = 0x0c0600;

const INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
const RESPONSE_VALUE_OFFSET = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1;

class TestClientSession {
    readonly events: ClientMessage[] = [];

    constructor(private readonly _sessionId: string) {}

    isAuthenticated(): boolean { return true; }
    getSessionId(): string { return this._sessionId; }
    pushEvent(message: ClientMessage): boolean { this.events.push(message); return true; }
    sendMessage(message: ClientMessage): boolean { this.events.push(message); return true; }
}

function createRequest(messageType: number, correlationId: number, extraBytes = 0): { msg: ClientMessage; frame: Buffer } {
    const msg = ClientMessage.createForEncode();
    const frame = Buffer.alloc(INITIAL_FRAME_SIZE + extraBytes);
    frame.writeUInt32LE(messageType >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
    frame.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
    msg.add(new ClientMessageFrame(frame));
    msg.setCorrelationId(correlationId);
    msg.setPartitionId(-1);
    return { msg, frame };
}

function encodeNullableData(msg: ClientMessage, value: Data | null): void {
    if (value === null) {
        msg.add(ClientMessage.NULL_FRAME);
        return;
    }
    DataCodec.encode(msg, value);
}

function buildNameRequest(messageType: number, correlationId: number, name: string): ClientMessage {
    const { msg } = createRequest(messageType, correlationId);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildCpNameRequest(messageType: number, correlationId: number, name: string, groupName = 'default'): ClientMessage {
    const { msg } = createRequest(messageType, correlationId);
    encodeRaftGroupId(msg, groupName);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function toPseudoUuid(seed: string): string {
    const hex = Buffer.from(seed, 'utf8').toString('hex').padEnd(32, '0').slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function encodeRaftGroupId(msg: ClientMessage, groupName: string): void {
    msg.add(ClientMessage.BEGIN_FRAME);
    msg.add(new ClientMessageFrame(Buffer.alloc(LONG_SIZE_IN_BYTES * 2)));
    StringCodec.encode(msg, groupName);
    msg.add(ClientMessage.END_FRAME);
}

function buildCpGroupCreateRequest(correlationId: number, proxyName: string): ClientMessage {
    const { msg } = createRequest(CP_GROUP_CREATE_REQUEST, correlationId);
    StringCodec.encode(msg, proxyName);
    msg.setFinal();
    return msg;
}

function buildCpGroupDestroyRequest(correlationId: number, groupName: string, serviceName: string, objectName: string): ClientMessage {
    const { msg } = createRequest(CP_GROUP_DESTROY_REQUEST, correlationId);
    encodeRaftGroupId(msg, groupName);
    StringCodec.encode(msg, serviceName);
    StringCodec.encode(msg, objectName);
    msg.setFinal();
    return msg;
}

function buildAtomicLongLongRequest(messageType: number, correlationId: number, name: string, value: bigint): ClientMessage {
    const { msg, frame } = createRequest(messageType, correlationId, LONG_SIZE_IN_BYTES);
    frame.writeBigInt64LE(value, INITIAL_FRAME_SIZE);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildAtomicLongCompareAndSetRequest(correlationId: number, name: string, expectValue: bigint, updateValue: bigint): ClientMessage {
    const { msg, frame } = createRequest(AL_COMPARE_AND_SET_REQUEST, correlationId, LONG_SIZE_IN_BYTES * 2);
    frame.writeBigInt64LE(expectValue, INITIAL_FRAME_SIZE);
    frame.writeBigInt64LE(updateValue, INITIAL_FRAME_SIZE + LONG_SIZE_IN_BYTES);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildAtomicLongFunctionRequest(messageType: number, correlationId: number, name: string, functionData: Data): ClientMessage {
    const { msg } = createRequest(messageType, correlationId);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, functionData);
    msg.setFinal();
    return msg;
}

function buildAtomicRefSetRequest(correlationId: number, name: string, value: Data | null): ClientMessage {
    const { msg } = createRequest(AR_SET_REQUEST, correlationId);
    encodeRaftGroupId(msg, 'default');
    StringCodec.encode(msg, name);
    encodeNullableData(msg, value);
    msg.setFinal();
    return msg;
}

function buildAtomicRefContainsRequest(correlationId: number, name: string, value: Data | null): ClientMessage {
    const { msg } = createRequest(AR_CONTAINS_REQUEST, correlationId);
    encodeRaftGroupId(msg, 'default');
    StringCodec.encode(msg, name);
    encodeNullableData(msg, value);
    msg.setFinal();
    return msg;
}

function buildAtomicRefCompareAndSetRequest(correlationId: number, name: string, expected: Data | null, updated: Data | null): ClientMessage {
    const { msg } = createRequest(AR_COMPARE_AND_SET_REQUEST, correlationId);
    encodeRaftGroupId(msg, 'default');
    StringCodec.encode(msg, name);
    encodeNullableData(msg, expected);
    encodeNullableData(msg, updated);
    msg.setFinal();
    return msg;
}

function buildAtomicRefCompareAndSetLegacyRequest(correlationId: number, name: string, expected: Data | null, updated: Data | null): ClientMessage {
    const { msg } = createRequest(AR_COMPARE_AND_SET_LEGACY_REQUEST, correlationId);
    StringCodec.encode(msg, name);
    encodeNullableData(msg, expected);
    encodeNullableData(msg, updated);
    msg.setFinal();
    return msg;
}

function buildAtomicRefFunctionRequest(messageType: number, correlationId: number, name: string, functionData: Data): ClientMessage {
    const { msg } = createRequest(messageType, correlationId);
    encodeRaftGroupId(msg, 'default');
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, functionData);
    msg.setFinal();
    return msg;
}

function buildCountDownLatchTrySetCountRequest(correlationId: number, name: string, count: number): ClientMessage {
    const { msg, frame } = createRequest(CDL_TRY_SET_COUNT_REQUEST, correlationId, INT_SIZE_IN_BYTES);
    frame.writeInt32LE(count, INITIAL_FRAME_SIZE);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildCountDownLatchAwaitRequest(correlationId: number, name: string, timeoutMs: bigint): ClientMessage {
    const { msg, frame } = createRequest(CDL_AWAIT_REQUEST, correlationId, LONG_SIZE_IN_BYTES + 17);
    FixedSizeTypesCodec.encodeUUID(frame, INITIAL_FRAME_SIZE, toPseudoUuid(`await-${correlationId}`));
    frame.writeBigInt64LE(timeoutMs, INITIAL_FRAME_SIZE + 17);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildCountDownLatchCountDownRequest(correlationId: number, name: string, expectedRound: number, invocationUuid: string): ClientMessage {
    const { msg, frame } = createRequest(CDL_COUNT_DOWN_REQUEST, correlationId, 17 + INT_SIZE_IN_BYTES);
    FixedSizeTypesCodec.encodeUUID(frame, INITIAL_FRAME_SIZE, toPseudoUuid(invocationUuid));
    frame.writeInt32LE(expectedRound, INITIAL_FRAME_SIZE + 17);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildSemaphoreInitRequest(correlationId: number, name: string, permits: number): ClientMessage {
    const { msg, frame } = createRequest(SEM_INIT_REQUEST, correlationId, INT_SIZE_IN_BYTES);
    frame.writeInt32LE(permits, INITIAL_FRAME_SIZE);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildSemaphoreRequest(
    messageType: number,
    correlationId: number,
    name: string,
    sessionId: bigint,
    threadId: bigint,
    permits: number,
    invocationUuid: string,
    timeoutMs?: bigint,
): ClientMessage {
    const extraBytes = LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + 17 + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES;
    const { msg, frame } = createRequest(messageType, correlationId, extraBytes);
    let offset = INITIAL_FRAME_SIZE;
    frame.writeBigInt64LE(sessionId, offset);
    offset += LONG_SIZE_IN_BYTES;
    frame.writeBigInt64LE(threadId, offset);
    offset += LONG_SIZE_IN_BYTES;
    FixedSizeTypesCodec.encodeUUID(frame, offset, toPseudoUuid(invocationUuid));
    offset += 17;
    frame.writeInt32LE(permits, offset);
    offset += INT_SIZE_IN_BYTES;
    frame.writeBigInt64LE(timeoutMs ?? -1n, offset);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildSemaphoreDrainRequest(correlationId: number, name: string, sessionId: bigint, threadId: bigint, invocationUuid: string): ClientMessage {
    const { msg, frame } = createRequest(SEM_DRAIN_REQUEST, correlationId, LONG_SIZE_IN_BYTES * 2 + 17);
    frame.writeBigInt64LE(sessionId, INITIAL_FRAME_SIZE);
    frame.writeBigInt64LE(threadId, INITIAL_FRAME_SIZE + LONG_SIZE_IN_BYTES);
    FixedSizeTypesCodec.encodeUUID(frame, INITIAL_FRAME_SIZE + (LONG_SIZE_IN_BYTES * 2), toPseudoUuid(invocationUuid));
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function decodeBooleanResponse(message: ClientMessage): boolean {
    return message.getStartFrame().content.readUInt8(RESPONSE_VALUE_OFFSET) !== 0;
}

function decodeIntResponse(message: ClientMessage): number {
    return message.getStartFrame().content.readInt32LE(RESPONSE_VALUE_OFFSET);
}

function decodeLongResponse(message: ClientMessage): bigint {
    return message.getStartFrame().content.readBigInt64LE(RESPONSE_VALUE_OFFSET);
}

function decodeNullableDataResponse<T>(message: ClientMessage, ss: SerializationServiceImpl): T | null {
    const iterator = message.forwardFrameIterator();
    iterator.next();
    const next = iterator.peekNext();
    if (next?.isNullFrame()) {
        iterator.next();
        return null;
    }
    return ss.toObject<T>(DataCodec.decode(iterator)) as T;
}

describe('cp protocol adapter', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(() => {
        while (instances.length > 0) {
            instances.pop()!.shutdown();
        }
    });

    test('dispatches atomic long operations through the CP services', async () => {
        const config = new HeliosConfig('cp-atomic-long');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('cp-atomic-long') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const name = 'atomic-long';
            const addFn = ss.toData({ type: 'add', delta: '5' })!;
            const identityFn = ss.toData('identity')!;
            const setFn = ss.toData({ type: 'set', value: '4' })!;

            await dispatcher.dispatch(buildAtomicLongLongRequest(AL_SET_REQUEST, 1, name, 7n), session);
            expect(decodeLongResponse((await dispatcher.dispatch(buildNameRequest(AL_GET_REQUEST, 2, name), session))!)).toBe(7n);
            expect(decodeLongResponse((await dispatcher.dispatch(buildAtomicLongLongRequest(AL_ADD_AND_GET_REQUEST, 3, name, 2n), session))!)).toBe(9n);
            expect(decodeLongResponse((await dispatcher.dispatch(buildAtomicLongLongRequest(AL_GET_AND_ADD_REQUEST, 4, name, 3n), session))!)).toBe(9n);
            expect(decodeLongResponse((await dispatcher.dispatch(buildAtomicLongLongRequest(AL_GET_AND_SET_REQUEST, 5, name, 20n), session))!)).toBe(12n);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildAtomicLongCompareAndSetRequest(6, name, 20n, 30n), session))!)).toBe(true);
            expect(decodeLongResponse((await dispatcher.dispatch(buildAtomicLongFunctionRequest(AL_ALTER_AND_GET_REQUEST, 7, name, addFn), session))!)).toBe(35n);
            expect(decodeLongResponse((await dispatcher.dispatch(buildAtomicLongFunctionRequest(AL_GET_AND_ALTER_REQUEST, 8, name, setFn), session))!)).toBe(35n);
            expect(decodeNullableDataResponse<bigint>((await dispatcher.dispatch(buildAtomicLongFunctionRequest(AL_APPLY_REQUEST, 9, name, identityFn), session))!, ss)).toBe(4n);
            await dispatcher.dispatch(buildAtomicLongFunctionRequest(AL_ALTER_REQUEST, 10, name, addFn), session);
            expect(decodeLongResponse((await dispatcher.dispatch(buildNameRequest(AL_GET_REQUEST, 11, name), session))!)).toBe(9n);
        } finally {
            ss.destroy();
        }
    });

    test('dispatches atomic reference operations through the CP services', async () => {
        const config = new HeliosConfig('cp-atomic-ref');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('cp-atomic-ref') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const name = 'atomic-ref';
            const first = ss.toData({ version: 1 })!;
            const second = ss.toData({ version: 2 })!;
            const setFn = ss.toData({ type: 'set', value: { version: 3 } })!;
            const clearFn = ss.toData({ type: 'clear' })!;
            const identityFn = ss.toData({ type: 'identity' })!;

            await dispatcher.dispatch(buildAtomicRefSetRequest(1, name, first), session);
            expect(decodeNullableDataResponse<{ version: number }>((await dispatcher.dispatch(buildCpNameRequest(AR_GET_REQUEST, 2, name), session))!, ss)).toEqual({ version: 1 });
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildAtomicRefContainsRequest(3, name, first), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildAtomicRefCompareAndSetRequest(4, name, first, second), session))!)).toBe(true);
            expect(decodeNullableDataResponse<{ version: number }>((await dispatcher.dispatch(buildAtomicRefFunctionRequest(AR_APPLY_REQUEST, 5, name, identityFn), session))!, ss)).toEqual({ version: 2 });
            await dispatcher.dispatch(buildAtomicRefFunctionRequest(AR_ALTER_REQUEST, 6, name, setFn), session);
            expect(decodeNullableDataResponse<{ version: number }>((await dispatcher.dispatch(buildAtomicRefFunctionRequest(AR_ALTER_AND_GET_REQUEST, 7, name, identityFn), session))!, ss)).toEqual({ version: 3 });
            expect(decodeNullableDataResponse<{ version: number }>((await dispatcher.dispatch(buildAtomicRefFunctionRequest(AR_GET_AND_ALTER_REQUEST, 8, name, clearFn), session))!, ss)).toEqual({ version: 3 });
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildCpNameRequest(AR_IS_NULL_REQUEST, 9, name), session))!)).toBe(true);
            await dispatcher.dispatch(buildAtomicRefSetRequest(10, name, second), session);
            await dispatcher.dispatch(buildCpNameRequest(AR_CLEAR_REQUEST, 11, name), session);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildCpNameRequest(AR_IS_NULL_REQUEST, 12, name), session))!)).toBe(true);
        } finally {
            ss.destroy();
        }
    });

    test('dispatches CP group create and destroy through the CP services', async () => {
        const config = new HeliosConfig('cp-group-protocol');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('cp-group-protocol') as any;

        const createResponse = (await dispatcher.dispatch(buildCpGroupCreateRequest(1, 'atomic-long@default'), session))!;
        const iterator = createResponse.forwardFrameIterator();
        iterator.next();
        iterator.next();
        iterator.next();
        expect(StringCodec.decode(iterator)).toBe('default');

        await dispatcher.dispatch(buildCpGroupDestroyRequest(2, 'default', 'hz:raft:atomicLongService', 'atomic-long'), session);
        expect(instance.getCPSubsystem().getGroup('default')).not.toBeNull();
    });

    test('dispatches count down latch operations through the CP services', async () => {
        const config = new HeliosConfig('cp-latch');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('cp-latch') as any;
        const name = 'countdown-latch';

        expect(decodeBooleanResponse((await dispatcher.dispatch(buildCountDownLatchTrySetCountRequest(1, name, 2), session))!)).toBe(true);
        expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(CDL_GET_ROUND_REQUEST, 2, name), session))!)).toBe(1);
        expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(CDL_GET_COUNT_REQUEST, 3, name), session))!)).toBe(2);

        const awaiting = dispatcher.dispatch(buildCountDownLatchAwaitRequest(4, name, 500n), session);
        await Bun.sleep(10);
        await dispatcher.dispatch(buildCountDownLatchCountDownRequest(5, name, 1, 'cdl-invocation-1'), session);
        await dispatcher.dispatch(buildCountDownLatchCountDownRequest(6, name, 1, 'cdl-invocation-1'), session);
        expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(CDL_GET_COUNT_REQUEST, 7, name), session))!)).toBe(1);
        await dispatcher.dispatch(buildCountDownLatchCountDownRequest(8, name, 1, 'cdl-invocation-2'), session);
        expect(decodeBooleanResponse((await awaiting)!)).toBe(true);
        expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(CDL_GET_COUNT_REQUEST, 9, name), session))!)).toBe(0);
        expect(decodeBooleanResponse((await dispatcher.dispatch(buildCountDownLatchTrySetCountRequest(10, name, 1), session))!)).toBe(true);
        expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(CDL_GET_ROUND_REQUEST, 11, name), session))!)).toBe(2);
    });

    test('dispatches semaphore operations through the CP services', async () => {
        const config = new HeliosConfig('cp-semaphore');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('cp-semaphore') as any;
        const name = 'semaphore';

        expect(decodeBooleanResponse((await dispatcher.dispatch(buildSemaphoreInitRequest(1, name, 1), session))!)).toBe(true);
        expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(SEM_AVAILABLE_PERMITS_REQUEST, 2, name), session))!)).toBe(1);

        await dispatcher.dispatch(buildSemaphoreRequest(SEM_ACQUIRE_REQUEST, 3, name, 11n, 1n, 1, 'sem-acquire-1'), session);
        expect(decodeBooleanResponse((await dispatcher.dispatch(buildSemaphoreRequest(SEM_ACQUIRE_REQUEST, 4, name, 12n, 1n, 1, 'sem-try-acquire-1', 0n), session))!)).toBe(false);

        const blockingAcquire = dispatcher.dispatch(buildSemaphoreRequest(SEM_ACQUIRE_REQUEST, 5, name, 12n, 1n, 1, 'sem-acquire-2'), session);
        await Bun.sleep(10);
        await dispatcher.dispatch(buildSemaphoreRequest(SEM_RELEASE_REQUEST, 6, name, 11n, 1n, 1, 'sem-release-1'), session);
        expect(await blockingAcquire).toBeDefined();
        expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(SEM_AVAILABLE_PERMITS_REQUEST, 7, name), session))!)).toBe(0);

        await dispatcher.dispatch(buildSemaphoreRequest(SEM_CHANGE_REQUEST, 8, name, -1n, 1n, 3, 'sem-change-1'), session);
        expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(SEM_AVAILABLE_PERMITS_REQUEST, 9, name), session))!)).toBe(3);
        expect(decodeIntResponse((await dispatcher.dispatch(buildSemaphoreDrainRequest(10, name, 13n, 1n, 'sem-drain-1'), session))!)).toBe(3);
        expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(SEM_AVAILABLE_PERMITS_REQUEST, 11, name), session))!)).toBe(0);

        await dispatcher.dispatch(buildSemaphoreRequest(SEM_RELEASE_REQUEST, 12, name, 13n, 1n, 2, 'sem-release-2'), session);
        await dispatcher.dispatch(buildSemaphoreRequest(SEM_CHANGE_REQUEST, 13, name, -1n, 1n, -1, 'sem-change-2'), session);
        expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(SEM_AVAILABLE_PERMITS_REQUEST, 14, name), session))!)).toBe(1);
    });
});
