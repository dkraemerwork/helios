import { ClientMessage, ClientMessageFrame } from '../../src/client/impl/protocol/ClientMessage';
import { DataCodec } from '../../src/client/impl/protocol/codec/builtin/DataCodec.js';
import {
    BOOLEAN_SIZE_IN_BYTES,
    BYTE_SIZE_IN_BYTES,
    INT_SIZE_IN_BYTES,
    LONG_SIZE_IN_BYTES,
} from '../../src/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '../../src/client/impl/protocol/codec/builtin/StringCodec.js';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { SerializationConfig } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import { afterEach, describe, expect, test } from 'bun:test';

const TX_CREATE_REQUEST_TYPE = 0x150100;
const TX_COMMIT_REQUEST_TYPE = 0x150200;
const TX_ROLLBACK_REQUEST_TYPE = 0x150300;

const TX_MAP_PUT_REQUEST_TYPE = 0x0e0600;
const TX_MAP_GET_REQUEST_TYPE = 0x0e0200;
const TX_MAP_PUT_IF_ABSENT_REQUEST_TYPE = 0x0e0800;
const TX_MAP_REMOVE_REQUEST_TYPE = 0x0e0b00;
const TX_MAP_DELETE_REQUEST_TYPE = 0x0e0c00;
const TX_MAP_KEY_SET_REQUEST_TYPE = 0x0e0e00;
const TX_MAP_VALUES_REQUEST_TYPE = 0x0e1000;

const TX_QUEUE_OFFER_REQUEST_TYPE = 0x120100;
const TX_QUEUE_POLL_REQUEST_TYPE = 0x120300;
const TX_QUEUE_PEEK_REQUEST_TYPE = 0x120400;
const TX_QUEUE_SIZE_REQUEST_TYPE = 0x120500;

const TX_LIST_ADD_REQUEST_TYPE = 0x110100;
const TX_LIST_REMOVE_REQUEST_TYPE = 0x110200;
const TX_LIST_SIZE_REQUEST_TYPE = 0x110300;

const TX_SET_ADD_REQUEST_TYPE = 0x100100;
const TX_SET_REMOVE_REQUEST_TYPE = 0x100200;
const TX_SET_SIZE_REQUEST_TYPE = 0x100300;

const TX_MULTIMAP_PUT_REQUEST_TYPE = 0x0f0100;
const TX_MULTIMAP_GET_REQUEST_TYPE = 0x0f0200;
const TX_MULTIMAP_REMOVE_REQUEST_TYPE = 0x0f0300;
const TX_MULTIMAP_VALUE_COUNT_REQUEST_TYPE = 0x0f0500;
const TX_MULTIMAP_SIZE_REQUEST_TYPE = 0x0f0600;

const INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
const RESPONSE_VALUE_OFFSET = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + BYTE_SIZE_IN_BYTES;
const THREAD_ID = 7n;

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

function encodeDataList(msg: ClientMessage, values: Data[]): void {
    msg.add(new ClientMessageFrame(Buffer.alloc(0), ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));
    for (const value of values) {
        DataCodec.encode(msg, value);
    }
    msg.add(new ClientMessageFrame(Buffer.alloc(0), ClientMessage.END_DATA_STRUCTURE_FLAG));
}

function buildCreateTxRequest(correlationId: number, timeoutMs: bigint, durability: number, transactionType: number): ClientMessage {
    const { msg, frame } = createRequest(
        TX_CREATE_REQUEST_TYPE,
        correlationId,
        LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES,
    );
    frame.writeBigInt64LE(timeoutMs, INITIAL_FRAME_SIZE);
    frame.writeInt32LE(durability, INITIAL_FRAME_SIZE + LONG_SIZE_IN_BYTES);
    frame.writeInt32LE(transactionType, INITIAL_FRAME_SIZE + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
    frame.writeBigInt64LE(THREAD_ID, INITIAL_FRAME_SIZE + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
    msg.setFinal();
    return msg;
}

function buildCommitTxRequest(correlationId: number, txId: string, onePhase: boolean): ClientMessage {
    const { msg, frame } = createRequest(TX_COMMIT_REQUEST_TYPE, correlationId, BOOLEAN_SIZE_IN_BYTES);
    frame.writeUInt8(onePhase ? 1 : 0, INITIAL_FRAME_SIZE);
    StringCodec.encode(msg, txId);
    msg.setFinal();
    return msg;
}

function buildRollbackTxRequest(correlationId: number, txId: string): ClientMessage {
    const { msg } = createRequest(TX_ROLLBACK_REQUEST_TYPE, correlationId);
    StringCodec.encode(msg, txId);
    msg.setFinal();
    return msg;
}

function buildTxNameRequest(messageType: number, correlationId: number, txId: string, name: string): ClientMessage {
    const { msg } = createRequest(messageType, correlationId);
    StringCodec.encode(msg, txId);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildTxThreadNameRequest(messageType: number, correlationId: number, txId: string, name: string): ClientMessage {
    const { msg, frame } = createRequest(messageType, correlationId, LONG_SIZE_IN_BYTES);
    frame.writeBigInt64LE(THREAD_ID, INITIAL_FRAME_SIZE);
    StringCodec.encode(msg, txId);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildTxMapGetRequest(correlationId: number, txId: string, name: string, key: Data): ClientMessage {
    const { msg, frame } = createRequest(TX_MAP_GET_REQUEST_TYPE, correlationId, LONG_SIZE_IN_BYTES);
    frame.writeBigInt64LE(THREAD_ID, INITIAL_FRAME_SIZE);
    StringCodec.encode(msg, txId);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, key);
    msg.setFinal();
    return msg;
}

function buildTxMapMutationRequest(messageType: number, correlationId: number, txId: string, name: string, key: Data, value: Data, ttl = -1n): ClientMessage {
    const extraBytes = messageType === TX_MAP_PUT_REQUEST_TYPE ? LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES : LONG_SIZE_IN_BYTES;
    const { msg, frame } = createRequest(messageType, correlationId, extraBytes);
    frame.writeBigInt64LE(THREAD_ID, INITIAL_FRAME_SIZE);
    if (messageType === TX_MAP_PUT_REQUEST_TYPE) {
        frame.writeBigInt64LE(ttl, INITIAL_FRAME_SIZE + LONG_SIZE_IN_BYTES);
    }
    StringCodec.encode(msg, txId);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, key);
    DataCodec.encode(msg, value);
    msg.setFinal();
    return msg;
}

function buildTxMapDeleteRequest(correlationId: number, txId: string, name: string, key: Data): ClientMessage {
    const { msg, frame } = createRequest(TX_MAP_DELETE_REQUEST_TYPE, correlationId, LONG_SIZE_IN_BYTES);
    frame.writeBigInt64LE(THREAD_ID, INITIAL_FRAME_SIZE);
    StringCodec.encode(msg, txId);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, key);
    msg.setFinal();
    return msg;
}

function buildTxQueueOfferRequest(correlationId: number, txId: string, name: string, value: Data): ClientMessage {
    const { msg, frame } = createRequest(TX_QUEUE_OFFER_REQUEST_TYPE, correlationId, LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
    frame.writeBigInt64LE(0n, INITIAL_FRAME_SIZE);
    frame.writeBigInt64LE(THREAD_ID, INITIAL_FRAME_SIZE + LONG_SIZE_IN_BYTES);
    StringCodec.encode(msg, txId);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, value);
    msg.setFinal();
    return msg;
}

function buildTxQueuePollPeekRequest(messageType: number, correlationId: number, txId: string, name: string): ClientMessage {
    const { msg, frame } = createRequest(messageType, correlationId, LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
    frame.writeBigInt64LE(0n, INITIAL_FRAME_SIZE);
    frame.writeBigInt64LE(THREAD_ID, INITIAL_FRAME_SIZE + LONG_SIZE_IN_BYTES);
    StringCodec.encode(msg, txId);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildTxThreadNameDataRequest(messageType: number, correlationId: number, txId: string, name: string, value: Data): ClientMessage {
    const { msg, frame } = createRequest(messageType, correlationId, LONG_SIZE_IN_BYTES);
    frame.writeBigInt64LE(THREAD_ID, INITIAL_FRAME_SIZE);
    StringCodec.encode(msg, txId);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, value);
    msg.setFinal();
    return msg;
}

function buildTxMultiMapRequest(messageType: number, correlationId: number, txId: string, name: string, key: Data, value?: Data): ClientMessage {
    const { msg, frame } = createRequest(messageType, correlationId, LONG_SIZE_IN_BYTES);
    frame.writeBigInt64LE(THREAD_ID, INITIAL_FRAME_SIZE);
    StringCodec.encode(msg, txId);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, key);
    if (value !== undefined) {
        DataCodec.encode(msg, value);
    }
    msg.setFinal();
    return msg;
}

function decodeBooleanResponse(message: ClientMessage): boolean {
    return message.getStartFrame().content.readUInt8(RESPONSE_VALUE_OFFSET) !== 0;
}

function decodeIntResponse(message: ClientMessage): number {
    return message.getStartFrame().content.readInt32LE(RESPONSE_VALUE_OFFSET);
}

function decodeStringResponse(message: ClientMessage): string {
    const iterator = message.forwardFrameIterator();
    iterator.next();
    return StringCodec.decode(iterator);
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

function decodeDataListResponse<T>(message: ClientMessage, ss: SerializationServiceImpl): T[] {
    const iterator = message.forwardFrameIterator();
    iterator.next();
    iterator.next();
    const items: T[] = [];
    while (iterator.hasNext()) {
        const next = iterator.peekNext();
        if (next?.isEndFrame()) {
            iterator.next();
            break;
        }
        items.push(ss.toObject<T>(DataCodec.decode(iterator)) as T);
    }
    return items;
}

describe('transaction protocol adapter', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(() => {
        while (instances.length > 0) {
            instances.pop()!.shutdown();
        }
    });

    test('dispatches transactional operations through the real transaction coordinator and commit path', async () => {
        const config = new HeliosConfig('transaction-protocol-commit');
        config.setClusterName('transaction-protocol-commit');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('transaction-commit') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const txId = decodeStringResponse((await dispatcher.dispatch(buildCreateTxRequest(1, 30_000n, 1, 2), session))!);

            const mapName = 'tx-map';
            const mapKey = ss.toData('key')!;
            const mapValue = ss.toData('value-1')!;
            const mapValue2 = ss.toData('value-2')!;
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildTxMapMutationRequest(TX_MAP_PUT_REQUEST_TYPE, 2, txId, mapName, mapKey, mapValue), session))!, ss)).toBeNull();
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildTxMapGetRequest(3, txId, mapName, mapKey), session))!, ss)).toBe('value-1');
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildTxMapMutationRequest(TX_MAP_PUT_IF_ABSENT_REQUEST_TYPE, 4, txId, mapName, mapKey, mapValue2), session))!, ss)).toBe('value-1');
            expect(decodeDataListResponse<string>((await dispatcher.dispatch(buildTxNameRequest(TX_MAP_KEY_SET_REQUEST_TYPE, 5, txId, mapName), session))!, ss)).toEqual(['key']);
            expect(decodeDataListResponse<string>((await dispatcher.dispatch(buildTxNameRequest(TX_MAP_VALUES_REQUEST_TYPE, 6, txId, mapName), session))!, ss)).toEqual(['value-1']);
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildTxMapMutationRequest(TX_MAP_REMOVE_REQUEST_TYPE, 7, txId, mapName, mapKey, mapValue), session))!, ss)).toBe('value-1');
            await dispatcher.dispatch(buildTxMapMutationRequest(TX_MAP_PUT_REQUEST_TYPE, 8, txId, mapName, mapKey, mapValue2), session);

            const queueName = 'tx-queue';
            const queueValue = ss.toData('queued')!;
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildTxQueueOfferRequest(9, txId, queueName, queueValue), session))!)).toBe(true);
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildTxQueuePollPeekRequest(TX_QUEUE_PEEK_REQUEST_TYPE, 10, txId, queueName), session))!, ss)).toBe('queued');
            expect(decodeIntResponse((await dispatcher.dispatch(buildTxThreadNameRequest(TX_QUEUE_SIZE_REQUEST_TYPE, 11, txId, queueName), session))!)).toBe(1);

            const listName = 'tx-list';
            const listValueA = ss.toData('a')!;
            const listValueB = ss.toData('b')!;
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildTxThreadNameDataRequest(TX_LIST_ADD_REQUEST_TYPE, 12, txId, listName, listValueA), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildTxThreadNameDataRequest(TX_LIST_ADD_REQUEST_TYPE, 13, txId, listName, listValueB), session))!)).toBe(true);
            expect(decodeIntResponse((await dispatcher.dispatch(buildTxThreadNameRequest(TX_LIST_SIZE_REQUEST_TYPE, 14, txId, listName), session))!)).toBe(2);

            const setName = 'tx-set';
            const setValue = ss.toData('member')!;
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildTxThreadNameDataRequest(TX_SET_ADD_REQUEST_TYPE, 15, txId, setName, setValue), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildTxThreadNameDataRequest(TX_SET_ADD_REQUEST_TYPE, 16, txId, setName, setValue), session))!)).toBe(false);
            expect(decodeIntResponse((await dispatcher.dispatch(buildTxThreadNameRequest(TX_SET_SIZE_REQUEST_TYPE, 17, txId, setName), session))!)).toBe(1);

            const multiMapName = 'tx-multimap';
            const multiMapKey = ss.toData('mm-key')!;
            const multiMapValue1 = ss.toData('mm-1')!;
            const multiMapValue2 = ss.toData('mm-2')!;
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildTxMultiMapRequest(TX_MULTIMAP_PUT_REQUEST_TYPE, 18, txId, multiMapName, multiMapKey, multiMapValue1), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildTxMultiMapRequest(TX_MULTIMAP_PUT_REQUEST_TYPE, 19, txId, multiMapName, multiMapKey, multiMapValue2), session))!)).toBe(true);
            expect(decodeDataListResponse<string>((await dispatcher.dispatch(buildTxMultiMapRequest(TX_MULTIMAP_GET_REQUEST_TYPE, 20, txId, multiMapName, multiMapKey), session))!, ss)).toEqual(['mm-1', 'mm-2']);
            expect(decodeIntResponse((await dispatcher.dispatch(buildTxMultiMapRequest(TX_MULTIMAP_VALUE_COUNT_REQUEST_TYPE, 21, txId, multiMapName, multiMapKey), session))!)).toBe(2);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildTxMultiMapRequest(TX_MULTIMAP_REMOVE_REQUEST_TYPE, 22, txId, multiMapName, multiMapKey, multiMapValue1), session))!)).toBe(true);
            expect(decodeIntResponse((await dispatcher.dispatch(buildTxNameRequest(TX_MULTIMAP_SIZE_REQUEST_TYPE, 23, txId, multiMapName), session))!)).toBe(1);

            await dispatcher.dispatch(buildCommitTxRequest(24, txId, false), session);

            expect(await instance.getMap<string, string>(mapName).get('key')).toBe('value-2');
            expect(await instance.getQueue<string>(queueName).peek()).toBe('queued');
            expect(await (instance.getList<string>(listName) as any).toArray()).toEqual(['a', 'b']);
            expect(await instance.getSet<string>(setName).contains('member')).toBe(true);
            expect(Array.from(await instance.getMultiMap<string, string>(multiMapName).get('mm-key'))).toEqual(['mm-2']);
        } finally {
            ss.destroy();
        }
    });

    test('rollback discards transactional mutations across all wired transaction adapters', async () => {
        const config = new HeliosConfig('transaction-protocol-rollback');
        config.setClusterName('transaction-protocol-rollback');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('transaction-rollback') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            (instance as any)._ensureQueueService();
            (instance as any)._ensureSetService();
            (instance as any)._ensureMultiMapService();

            await instance.getMap<string, string>('rollback-map').put('keep', 'seed');
            await instance.getQueue<string>('rollback-queue').offer('seed');
            await (instance.getList<string>('rollback-list') as any).add('seed');
            await instance.getSet<string>('rollback-set').add('seed');
            await instance.getMultiMap<string, string>('rollback-multimap').put('key', 'seed');

            const txId = decodeStringResponse((await dispatcher.dispatch(buildCreateTxRequest(30, 30_000n, 1, 2), session))!);

            await dispatcher.dispatch(buildTxMapDeleteRequest(31, txId, 'rollback-map', ss.toData('keep')!), session);
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildTxMapGetRequest(32, txId, 'rollback-map', ss.toData('keep')!), session))!, ss)).toBeNull();

            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildTxQueuePollPeekRequest(TX_QUEUE_POLL_REQUEST_TYPE, 33, txId, 'rollback-queue'), session))!, ss)).toBe('seed');
            expect(decodeIntResponse((await dispatcher.dispatch(buildTxThreadNameRequest(TX_QUEUE_SIZE_REQUEST_TYPE, 34, txId, 'rollback-queue'), session))!)).toBe(0);

            expect(decodeBooleanResponse((await dispatcher.dispatch(buildTxThreadNameDataRequest(TX_LIST_ADD_REQUEST_TYPE, 35, txId, 'rollback-list', ss.toData('temp')!), session))!)).toBe(true);
            expect(decodeIntResponse((await dispatcher.dispatch(buildTxThreadNameRequest(TX_LIST_SIZE_REQUEST_TYPE, 36, txId, 'rollback-list'), session))!)).toBe(2);

            expect(decodeBooleanResponse((await dispatcher.dispatch(buildTxThreadNameDataRequest(TX_SET_ADD_REQUEST_TYPE, 37, txId, 'rollback-set', ss.toData('temp')!), session))!)).toBe(true);
            expect(decodeIntResponse((await dispatcher.dispatch(buildTxThreadNameRequest(TX_SET_SIZE_REQUEST_TYPE, 38, txId, 'rollback-set'), session))!)).toBe(2);

            expect(decodeBooleanResponse((await dispatcher.dispatch(buildTxMultiMapRequest(TX_MULTIMAP_PUT_REQUEST_TYPE, 39, txId, 'rollback-multimap', ss.toData('key')!, ss.toData('temp')!), session))!)).toBe(true);
            expect(decodeIntResponse((await dispatcher.dispatch(buildTxNameRequest(TX_MULTIMAP_SIZE_REQUEST_TYPE, 40, txId, 'rollback-multimap'), session))!)).toBe(2);

            await dispatcher.dispatch(buildRollbackTxRequest(41, txId), session);

            expect(await instance.getMap<string, string>('rollback-map').get('keep')).toBe('seed');
            expect(await instance.getQueue<string>('rollback-queue').peek()).toBe('seed');
            expect(await (instance.getList<string>('rollback-list') as any).toArray()).toEqual(['seed']);
            expect(await instance.getSet<string>('rollback-set').contains('seed')).toBe(true);
            expect(Array.from(await instance.getMultiMap<string, string>('rollback-multimap').get('key'))).toEqual(['seed']);
        } finally {
            ss.destroy();
        }
    });

    test('queue poll and peek advance across committed contents in protocol transactions', async () => {
        const config = new HeliosConfig('transaction-protocol-queue-cursor');
        config.setClusterName('transaction-protocol-queue-cursor');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('transaction-queue-cursor') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            (instance as any)._ensureQueueService();

            await instance.getQueue<string>('cursor-queue').offer('first');
            await instance.getQueue<string>('cursor-queue').offer('second');
            await instance.getQueue<string>('cursor-queue').offer('third');

            const txId = decodeStringResponse((await dispatcher.dispatch(buildCreateTxRequest(50, 30_000n, 1, 2), session))!);

            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildTxQueuePollPeekRequest(TX_QUEUE_POLL_REQUEST_TYPE, 51, txId, 'cursor-queue'), session))!, ss)).toBe('first');
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildTxQueuePollPeekRequest(TX_QUEUE_POLL_REQUEST_TYPE, 52, txId, 'cursor-queue'), session))!, ss)).toBe('second');
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildTxQueuePollPeekRequest(TX_QUEUE_PEEK_REQUEST_TYPE, 53, txId, 'cursor-queue'), session))!, ss)).toBe('third');
            expect(decodeIntResponse((await dispatcher.dispatch(buildTxThreadNameRequest(TX_QUEUE_SIZE_REQUEST_TYPE, 54, txId, 'cursor-queue'), session))!)).toBe(1);

            await dispatcher.dispatch(buildCommitTxRequest(55, txId, false), session);

            expect(await instance.getQueue<string>('cursor-queue').poll()).toBe('third');
            expect(await instance.getQueue<string>('cursor-queue').poll()).toBeNull();
        } finally {
            ss.destroy();
        }
    });
});
