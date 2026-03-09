import { ClientMessage, ClientMessageFrame } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { ClientMessageReader } from '@zenystx/helios-core/client/impl/protocol/ClientMessageReader';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import {
    BOOLEAN_SIZE_IN_BYTES,
    INT_SIZE_IN_BYTES,
} from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { ByteBuffer } from '@zenystx/helios-core/internal/networking/ByteBuffer';
import { SerializationConfig } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import { afterEach, describe, expect, test } from 'bun:test';

const CACHE_GET_REQUEST_TYPE = 0x130100;
const CACHE_GET_ALL_REQUEST_TYPE = 0x130200;
const CACHE_PUT_REQUEST_TYPE = 0x130300;
const CACHE_PUT_IF_ABSENT_REQUEST_TYPE = 0x130400;
const CACHE_REMOVE_REQUEST_TYPE = 0x130500;
const CACHE_REMOVE_ALL_REQUEST_TYPE = 0x130600;
const CACHE_CONTAINS_KEY_REQUEST_TYPE = 0x130700;
const CACHE_REPLACE_REQUEST_TYPE = 0x130800;
const CACHE_SIZE_REQUEST_TYPE = 0x130900;
const CACHE_CLEAR_REQUEST_TYPE = 0x130a00;
const CACHE_GET_AND_REMOVE_REQUEST_TYPE = 0x130b00;
const CACHE_GET_AND_PUT_REQUEST_TYPE = 0x130c00;
const CACHE_GET_AND_REPLACE_REQUEST_TYPE = 0x130d00;
const CACHE_PUT_ALL_REQUEST_TYPE = 0x130e00;
const CACHE_DESTROY_REQUEST_TYPE = 0x130f00;
const CACHE_ADD_LISTENER_REQUEST_TYPE = 0x131000;
const CACHE_REMOVE_LISTENER_REQUEST_TYPE = 0x131100;

const MAP_NEAR_CACHE_SINGLE_INVALIDATION_EVENT_TYPE = 0x013c02;
const MAP_NEAR_CACHE_CLEAR_INVALIDATION_EVENT_TYPE = 0x013c04;

const INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
const RESPONSE_VALUE_OFFSET = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1;
const COMPLETION_ID_OFFSET = INITIAL_FRAME_SIZE;
const BOOLEAN_FLAG_OFFSET = INITIAL_FRAME_SIZE + INT_SIZE_IN_BYTES;

class TestClientSession {
    readonly events: Array<ClientMessage | Buffer> = [];

    constructor(private readonly _sessionId: string) {}

    isAuthenticated(): boolean { return true; }
    getSessionId(): string { return this._sessionId; }
    pushEvent(message: ClientMessage | Buffer): boolean { this.events.push(message); return true; }
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

function encodeEntryList(msg: ClientMessage, entries: Array<[Data, Data]>): void {
    msg.add(new ClientMessageFrame(Buffer.alloc(0), ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));
    for (const [key, value] of entries) {
        DataCodec.encode(msg, key);
        DataCodec.encode(msg, value);
    }
    msg.add(new ClientMessageFrame(Buffer.alloc(0), ClientMessage.END_DATA_STRUCTURE_FLAG));
}

function buildNameRequest(messageType: number, correlationId: number, name: string): ClientMessage {
    const { msg } = createRequest(messageType, correlationId);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildCacheGetRequest(correlationId: number, name: string, key: Data): ClientMessage {
    const { msg } = createRequest(CACHE_GET_REQUEST_TYPE, correlationId);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, key);
    msg.add(ClientMessage.NULL_FRAME);
    msg.setFinal();
    return msg;
}

function buildCachePutRequest(correlationId: number, name: string, key: Data, value: Data, isGet = false): ClientMessage {
    const { msg, frame } = createRequest(CACHE_PUT_REQUEST_TYPE, correlationId, INT_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES);
    frame.writeInt32LE(0, COMPLETION_ID_OFFSET);
    frame.writeUInt8(isGet ? 1 : 0, BOOLEAN_FLAG_OFFSET);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, key);
    DataCodec.encode(msg, value);
    msg.add(ClientMessage.NULL_FRAME);
    msg.setFinal();
    return msg;
}

function buildCacheKeyValueRequest(messageType: number, correlationId: number, name: string, key: Data, value: Data): ClientMessage {
    const { msg, frame } = createRequest(messageType, correlationId, INT_SIZE_IN_BYTES);
    frame.writeInt32LE(0, COMPLETION_ID_OFFSET);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, key);
    DataCodec.encode(msg, value);
    if (messageType === CACHE_PUT_IF_ABSENT_REQUEST_TYPE || messageType === CACHE_GET_AND_PUT_REQUEST_TYPE || messageType === CACHE_GET_AND_REPLACE_REQUEST_TYPE) {
        msg.add(ClientMessage.NULL_FRAME);
    }
    msg.setFinal();
    return msg;
}

function buildCacheRemoveRequest(correlationId: number, name: string, key: Data, currentValue: Data | null = null): ClientMessage {
    const { msg, frame } = createRequest(CACHE_REMOVE_REQUEST_TYPE, correlationId, INT_SIZE_IN_BYTES);
    frame.writeInt32LE(0, COMPLETION_ID_OFFSET);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, key);
    if (currentValue === null) {
        msg.add(ClientMessage.NULL_FRAME);
    } else {
        DataCodec.encode(msg, currentValue);
    }
    msg.setFinal();
    return msg;
}

function buildCacheReplaceRequest(correlationId: number, name: string, key: Data, newValue: Data, oldValue: Data | null = null): ClientMessage {
    const { msg, frame } = createRequest(CACHE_REPLACE_REQUEST_TYPE, correlationId, INT_SIZE_IN_BYTES);
    frame.writeInt32LE(0, COMPLETION_ID_OFFSET);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, key);
    if (oldValue === null) {
        msg.add(ClientMessage.NULL_FRAME);
    } else {
        DataCodec.encode(msg, oldValue);
    }
    DataCodec.encode(msg, newValue);
    msg.add(ClientMessage.NULL_FRAME);
    msg.setFinal();
    return msg;
}

function buildCacheGetAndRemoveRequest(correlationId: number, name: string, key: Data): ClientMessage {
    const { msg, frame } = createRequest(CACHE_GET_AND_REMOVE_REQUEST_TYPE, correlationId, INT_SIZE_IN_BYTES);
    frame.writeInt32LE(0, COMPLETION_ID_OFFSET);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, key);
    msg.setFinal();
    return msg;
}

function buildCachePutAllRequest(correlationId: number, name: string, entries: Array<[Data, Data]>): ClientMessage {
    const { msg, frame } = createRequest(CACHE_PUT_ALL_REQUEST_TYPE, correlationId, INT_SIZE_IN_BYTES);
    frame.writeInt32LE(0, COMPLETION_ID_OFFSET);
    StringCodec.encode(msg, name);
    encodeEntryList(msg, entries);
    msg.add(ClientMessage.NULL_FRAME);
    msg.setFinal();
    return msg;
}

function buildCacheGetAllRequest(correlationId: number, name: string, keys: Data[]): ClientMessage {
    const { msg } = createRequest(CACHE_GET_ALL_REQUEST_TYPE, correlationId);
    StringCodec.encode(msg, name);
    encodeDataList(msg, keys);
    msg.add(ClientMessage.NULL_FRAME);
    msg.setFinal();
    return msg;
}

function buildCacheRemoveAllRequest(correlationId: number, name: string, keys: Data[]): ClientMessage {
    const { msg, frame } = createRequest(CACHE_REMOVE_ALL_REQUEST_TYPE, correlationId, INT_SIZE_IN_BYTES);
    frame.writeInt32LE(0, COMPLETION_ID_OFFSET);
    StringCodec.encode(msg, name);
    encodeDataList(msg, keys);
    msg.setFinal();
    return msg;
}

function buildCacheAddListenerRequest(correlationId: number, name: string, localOnly = false): ClientMessage {
    const { msg, frame } = createRequest(CACHE_ADD_LISTENER_REQUEST_TYPE, correlationId, BOOLEAN_SIZE_IN_BYTES);
    frame.writeUInt8(localOnly ? 1 : 0, INITIAL_FRAME_SIZE);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildCacheRemoveListenerRequest(correlationId: number, registrationId: string): ClientMessage {
    const { msg } = createRequest(CACHE_REMOVE_LISTENER_REQUEST_TYPE, correlationId);
    StringCodec.encode(msg, registrationId);
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

function decodeEntryListResponse<K, V>(message: ClientMessage, ss: SerializationServiceImpl): Array<[K, V]> {
    const iterator = message.forwardFrameIterator();
    iterator.next();
    iterator.next();
    const entries: Array<[K, V]> = [];
    while (iterator.hasNext()) {
        const next = iterator.peekNext();
        if (next?.isEndFrame()) {
            iterator.next();
            break;
        }
        entries.push([
            ss.toObject<K>(DataCodec.decode(iterator)) as K,
            ss.toObject<V>(DataCodec.decode(iterator)) as V,
        ]);
    }
    return entries;
}

function decodeRawClientMessage(rawMessage: Buffer): ClientMessage {
    const reader = new ClientMessageReader();
    const done = reader.readFrom(ByteBuffer.wrap(rawMessage), true);
    expect(done).toBe(true);
    return reader.getClientMessage();
}

function decodeSingleInvalidationKey<T>(message: ClientMessage, ss: SerializationServiceImpl): T {
    const iterator = message.forwardFrameIterator();
    iterator.next();
    return ss.toObject<T>(DataCodec.decode(iterator)) as T;
}

describe('cache protocol adapter', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(() => {
        while (instances.length > 0) {
            instances.pop()!.shutdown();
        }
    });

    test('dispatches cache operations through the real distributed cache service', async () => {
        const config = new HeliosConfig('cache-protocol-ops');
        config.setClusterName('cache-protocol-ops');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('cache-ops') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const cacheName = 'protocol-cache';
            const keyA = ss.toData('key-a')!;
            const keyB = ss.toData('key-b')!;
            const valueA = ss.toData('value-a')!;
            const valueB = ss.toData('value-b')!;
            const valueC = ss.toData('value-c')!;
            const valueD = ss.toData('value-d')!;

            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildCachePutRequest(1, cacheName, keyA, valueA, false), session))!, ss)).toBeNull();
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildCacheGetRequest(2, cacheName, keyA), session))!, ss)).toBe('value-a');
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildCachePutRequest(3, cacheName, keyA, valueB, true), session))!, ss)).toBe('value-a');
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildCacheContainsKeyRequest(4, cacheName, keyA), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildCacheKeyValueRequest(CACHE_PUT_IF_ABSENT_REQUEST_TYPE, 5, cacheName, keyA, valueC), session))!)).toBe(false);
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildCacheKeyValueRequest(CACHE_GET_AND_REPLACE_REQUEST_TYPE, 6, cacheName, keyA, valueC), session))!, ss)).toBe('value-b');
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildCacheReplaceRequest(7, cacheName, keyA, valueD, valueB), session))!)).toBe(false);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildCacheReplaceRequest(8, cacheName, keyA, valueD, valueC), session))!)).toBe(true);
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildCacheKeyValueRequest(CACHE_GET_AND_PUT_REQUEST_TYPE, 9, cacheName, keyB, valueB), session))!, ss)).toBeNull();

            await dispatcher.dispatch(buildCachePutAllRequest(10, cacheName, [[ss.toData('key-c')!, ss.toData('value-c')!]]), session);
            expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(CACHE_SIZE_REQUEST_TYPE, 11, cacheName), session))!)).toBe(3);
            expect(decodeEntryListResponse<string, string>((await dispatcher.dispatch(buildCacheGetAllRequest(12, cacheName, [keyA, keyB]), session))!, ss)).toEqual([
                ['key-a', 'value-d'],
                ['key-b', 'value-b'],
            ]);

            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildCacheGetAndRemoveRequest(13, cacheName, keyB), session))!, ss)).toBe('value-b');
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildCacheRemoveRequest(14, cacheName, keyA, valueD), session))!)).toBe(true);
            await dispatcher.dispatch(buildCacheRemoveAllRequest(15, cacheName, [ss.toData('key-c')!]), session);
            expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(CACHE_SIZE_REQUEST_TYPE, 16, cacheName), session))!)).toBe(0);

            await dispatcher.dispatch(buildCachePutRequest(17, cacheName, keyA, valueA, false), session);
            await dispatcher.dispatch(buildNameRequest(CACHE_CLEAR_REQUEST_TYPE, 18, cacheName), session);
            expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(CACHE_SIZE_REQUEST_TYPE, 19, cacheName), session))!)).toBe(0);
        } finally {
            ss.destroy();
        }
    });

    test('cache invalidation listener registrations are backed by real cache mutation paths', async () => {
        const config = new HeliosConfig('cache-protocol-listener');
        config.setClusterName('cache-protocol-listener');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('cache-listener') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const cacheName = 'listener-cache';
            const key = ss.toData('watched')!;
            const value = ss.toData('value')!;
            const registrationId = decodeStringResponse((await dispatcher.dispatch(buildCacheAddListenerRequest(30, cacheName), session))!);

            expect(registrationId).toBeTruthy();

            await dispatcher.dispatch(buildCachePutRequest(31, cacheName, key, value), session);
            const cacheService = instance.getCache<string, string>(cacheName);
            await cacheService.clear(cacheName);

            expect(session.events).toHaveLength(2);

            const singleEvent = decodeRawClientMessage(session.events[0] as Buffer);
            expect(singleEvent.getMessageType()).toBe(MAP_NEAR_CACHE_SINGLE_INVALIDATION_EVENT_TYPE);
            expect(decodeSingleInvalidationKey<string>(singleEvent, ss)).toBe('watched');

            const clearEvent = decodeRawClientMessage(session.events[1] as Buffer);
            expect(clearEvent.getMessageType()).toBe(MAP_NEAR_CACHE_CLEAR_INVALIDATION_EVENT_TYPE);

            expect(decodeBooleanResponse((await dispatcher.dispatch(buildCacheRemoveListenerRequest(32, registrationId), session))!)).toBe(true);

            session.events.length = 0;
            await cacheService.put(cacheName, key, value);
            await dispatcher.dispatch(buildNameRequest(CACHE_DESTROY_REQUEST_TYPE, 33, cacheName), session);
            expect(session.events).toHaveLength(0);
        } finally {
            ss.destroy();
        }
    });
});

function buildCacheContainsKeyRequest(correlationId: number, name: string, key: Data): ClientMessage {
    const { msg } = createRequest(CACHE_CONTAINS_KEY_REQUEST_TYPE, correlationId);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, key);
    msg.setFinal();
    return msg;
}
