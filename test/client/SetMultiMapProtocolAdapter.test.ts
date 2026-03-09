import { ClientMessage, ClientMessageFrame } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { MultiMapAddEntryListenerCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MultiMapAddEntryListenerCodec.js';
import { SetAddListenerCodec } from '@zenystx/helios-core/client/impl/protocol/codec/SetAddListenerCodec.js';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import {
    FixedSizeTypesCodec,
    INT_SIZE_IN_BYTES,
    LONG_SIZE_IN_BYTES,
    UUID_SIZE_IN_BYTES,
} from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { SerializationConfig } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import { afterEach, describe, expect, test } from 'bun:test';

const SET_SIZE_REQUEST_TYPE = 0x060100;
const SET_CONTAINS_REQUEST_TYPE = 0x060200;
const SET_CONTAINS_ALL_REQUEST_TYPE = 0x060300;
const SET_ADD_REQUEST_TYPE = 0x060400;
const SET_REMOVE_REQUEST_TYPE = 0x060500;
const SET_ADD_ALL_REQUEST_TYPE = 0x060600;
const SET_REMOVE_ALL_REQUEST_TYPE = 0x060700;
const SET_RETAIN_ALL_REQUEST_TYPE = 0x060800;
const SET_CLEAR_REQUEST_TYPE = 0x060900;
const SET_GET_ALL_REQUEST_TYPE = 0x060a00;
const SET_REMOVE_LISTENER_REQUEST_TYPE = 0x060c00;
const SET_IS_EMPTY_REQUEST_TYPE = 0x060d00;

const MM_PUT_REQUEST_TYPE = 0x020100;
const MM_GET_REQUEST_TYPE = 0x020200;
const MM_REMOVE_REQUEST_TYPE = 0x020300;
const MM_KEY_SET_REQUEST_TYPE = 0x020400;
const MM_VALUES_REQUEST_TYPE = 0x020500;
const MM_ENTRY_SET_REQUEST_TYPE = 0x020600;
const MM_CONTAINS_KEY_REQUEST_TYPE = 0x020700;
const MM_CONTAINS_VALUE_REQUEST_TYPE = 0x020800;
const MM_CONTAINS_ENTRY_REQUEST_TYPE = 0x020900;
const MM_SIZE_REQUEST_TYPE = 0x020a00;
const MM_CLEAR_REQUEST_TYPE = 0x020b00;
const MM_VALUE_COUNT_REQUEST_TYPE = 0x020c00;
const MM_REMOVE_LISTENER_REQUEST_TYPE = 0x020f00;
const MM_REMOVE_ENTRY_REQUEST_TYPE = 0x021500;

const INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
const RESPONSE_VALUE_OFFSET = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1;
const THREAD_ID_FIELD_OFFSET = INITIAL_FRAME_SIZE;

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

function buildNameRequest(messageType: number, correlationId: number, name: string): ClientMessage {
    const { msg } = createRequest(messageType, correlationId);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildNameDataRequest(messageType: number, correlationId: number, name: string, value: Data): ClientMessage {
    const { msg } = createRequest(messageType, correlationId);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, value);
    msg.setFinal();
    return msg;
}

function buildNameDataListRequest(messageType: number, correlationId: number, name: string, values: Data[]): ClientMessage {
    const { msg } = createRequest(messageType, correlationId);
    StringCodec.encode(msg, name);
    encodeDataList(msg, values);
    msg.setFinal();
    return msg;
}

function buildRemoveListenerRequest(messageType: number, correlationId: number, name: string, registrationId: string): ClientMessage {
    const { msg, frame } = createRequest(messageType, correlationId, UUID_SIZE_IN_BYTES);
    FixedSizeTypesCodec.encodeUUID(frame, INITIAL_FRAME_SIZE, registrationId);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildMultiMapKeyRequest(messageType: number, correlationId: number, name: string, key: Data): ClientMessage {
    const { msg, frame } = createRequest(messageType, correlationId, LONG_SIZE_IN_BYTES);
    frame.writeBigInt64LE(0n, THREAD_ID_FIELD_OFFSET);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, key);
    msg.setFinal();
    return msg;
}

function buildMultiMapKeyValueRequest(messageType: number, correlationId: number, name: string, key: Data, value: Data): ClientMessage {
    const { msg, frame } = createRequest(messageType, correlationId, LONG_SIZE_IN_BYTES);
    frame.writeBigInt64LE(0n, THREAD_ID_FIELD_OFFSET);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, key);
    DataCodec.encode(msg, value);
    msg.setFinal();
    return msg;
}

function decodeBooleanResponse(message: ClientMessage): boolean {
    return message.getStartFrame().content.readUInt8(RESPONSE_VALUE_OFFSET) !== 0;
}

function decodeIntResponse(message: ClientMessage): number {
    return message.getStartFrame().content.readInt32LE(RESPONSE_VALUE_OFFSET);
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

function decodeEntrySetResponse<K, V>(message: ClientMessage, ss: SerializationServiceImpl): Array<[K, V]> {
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
        const key = ss.toObject<K>(DataCodec.decode(iterator)) as K;
        const value = ss.toObject<V>(DataCodec.decode(iterator)) as V;
        entries.push([key, value]);
    }
    return entries;
}

describe('set and multimap protocol adapter', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(() => {
        while (instances.length > 0) {
            instances.pop()!.shutdown();
        }
    });

    test('dispatches set operations through the real distributed set service', async () => {
        const config = new HeliosConfig('set-protocol-ops');
        config.setClusterName('set-protocol-ops');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('set-ops') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const setName = 'protocol-set';
            const a = ss.toData('a')!;
            const b = ss.toData('b')!;
            const c = ss.toData('c')!;
            const d = ss.toData('d')!;

            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataRequest(SET_ADD_REQUEST_TYPE, 1, setName, a), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataRequest(SET_ADD_REQUEST_TYPE, 2, setName, a), session))!)).toBe(false);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataListRequest(SET_ADD_ALL_REQUEST_TYPE, 3, setName, [a, b, c]), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataRequest(SET_CONTAINS_REQUEST_TYPE, 4, setName, b), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataListRequest(SET_CONTAINS_ALL_REQUEST_TYPE, 5, setName, [a, c]), session))!)).toBe(true);
            expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(SET_SIZE_REQUEST_TYPE, 6, setName), session))!)).toBe(3);
            expect(new Set(decodeDataListResponse<string>((await dispatcher.dispatch(buildNameRequest(SET_GET_ALL_REQUEST_TYPE, 7, setName), session))!, ss))).toEqual(new Set(['a', 'b', 'c']));

            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataListRequest(SET_REMOVE_ALL_REQUEST_TYPE, 8, setName, [a, d]), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataListRequest(SET_RETAIN_ALL_REQUEST_TYPE, 9, setName, [c, d]), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataRequest(SET_REMOVE_REQUEST_TYPE, 10, setName, c), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameRequest(SET_IS_EMPTY_REQUEST_TYPE, 11, setName), session))!)).toBe(true);

            await dispatcher.dispatch(buildNameDataListRequest(SET_ADD_ALL_REQUEST_TYPE, 12, setName, [a, b]), session);
            await dispatcher.dispatch(buildNameRequest(SET_CLEAR_REQUEST_TYPE, 13, setName), session);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameRequest(SET_IS_EMPTY_REQUEST_TYPE, 14, setName), session))!)).toBe(true);
        } finally {
            ss.destroy();
        }
    });

    test('set listener registration uses real item events and UUID removal', async () => {
        const config = new HeliosConfig('set-protocol-listener');
        config.setClusterName('set-protocol-listener');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('set-listener') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const setName = 'listener-set';
            const memberUuid = instance.getCluster().getLocalMember().getUuid();
            const addRequest = SetAddListenerCodec.encodeRequest(setName, true, false);
            addRequest.setCorrelationId(30);
            addRequest.setPartitionId(-1);

            const addResponse = await dispatcher.dispatch(addRequest, session);
            const registrationId = FixedSizeTypesCodec.decodeUUID(
                addResponse!.getStartFrame().content,
                ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1,
            );

            expect(registrationId).toBeTruthy();

            expect(
                decodeBooleanResponse((await dispatcher.dispatch(
                    buildNameDataRequest(SET_ADD_REQUEST_TYPE, 31, setName, ss.toData('first')!),
                    session,
                ))!),
            ).toBe(true);

            expect(session.events).toHaveLength(1);
            expect(session.events[0].getMessageType()).toBe(SetAddListenerCodec.EVENT_ITEM_MESSAGE_TYPE);
            expect(session.events[0].getCorrelationId()).toBe(30);
            const addedEvent = SetAddListenerCodec.decodeItemEvent(session.events[0]);
            expect(ss.toObject(addedEvent.item!) as string).toBe('first');
            expect(addedEvent.eventType).toBe(1);
            expect(addedEvent.uuid).toBe(memberUuid);

            session.events.length = 0;
            expect(
                decodeBooleanResponse((await dispatcher.dispatch(
                    buildNameDataRequest(SET_REMOVE_REQUEST_TYPE, 32, setName, ss.toData('first')!),
                    session,
                ))!),
            ).toBe(true);

            expect(session.events).toHaveLength(1);
            const removedEvent = SetAddListenerCodec.decodeItemEvent(session.events[0]);
            expect(ss.toObject(removedEvent.item!) as string).toBe('first');
            expect(removedEvent.eventType).toBe(2);
            expect(removedEvent.uuid).toBe(memberUuid);

            const removeResponse = await dispatcher.dispatch(
                buildRemoveListenerRequest(SET_REMOVE_LISTENER_REQUEST_TYPE, 33, setName, registrationId!),
                session,
            );
            expect(decodeBooleanResponse(removeResponse!)).toBe(true);

            session.events.length = 0;
            expect(
                decodeBooleanResponse((await dispatcher.dispatch(
                    buildNameDataRequest(SET_ADD_REQUEST_TYPE, 34, setName, ss.toData('second')!),
                    session,
                ))!),
            ).toBe(true);
            expect(session.events).toHaveLength(0);
        } finally {
            ss.destroy();
        }
    });

    test('dispatches multimap operations through the real distributed multimap service', async () => {
        const config = new HeliosConfig('multimap-protocol-ops');
        config.setClusterName('multimap-protocol-ops');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('multimap-ops') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const mapName = 'protocol-multimap';
            const keyA = ss.toData('key-a')!;
            const keyB = ss.toData('key-b')!;
            const v1 = ss.toData('v1')!;
            const v2 = ss.toData('v2')!;
            const v3 = ss.toData('v3')!;

            expect(decodeBooleanResponse((await dispatcher.dispatch(buildMultiMapKeyValueRequest(MM_PUT_REQUEST_TYPE, 1, mapName, keyA, v1), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildMultiMapKeyValueRequest(MM_PUT_REQUEST_TYPE, 2, mapName, keyA, v2), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildMultiMapKeyValueRequest(MM_PUT_REQUEST_TYPE, 3, mapName, keyB, v3), session))!)).toBe(true);

            expect(decodeDataListResponse<string>((await dispatcher.dispatch(buildMultiMapKeyRequest(MM_GET_REQUEST_TYPE, 4, mapName, keyA), session))!, ss)).toEqual(['v1', 'v2']);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildMultiMapKeyRequest(MM_CONTAINS_KEY_REQUEST_TYPE, 5, mapName, keyA), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataRequest(MM_CONTAINS_VALUE_REQUEST_TYPE, 6, mapName, v3), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildMultiMapKeyValueRequest(MM_CONTAINS_ENTRY_REQUEST_TYPE, 7, mapName, keyA, v2), session))!)).toBe(true);
            expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(MM_SIZE_REQUEST_TYPE, 8, mapName), session))!)).toBe(3);
            expect(decodeIntResponse((await dispatcher.dispatch(buildMultiMapKeyRequest(MM_VALUE_COUNT_REQUEST_TYPE, 9, mapName, keyA), session))!)).toBe(2);
            expect(new Set(decodeDataListResponse<string>((await dispatcher.dispatch(buildNameRequest(MM_KEY_SET_REQUEST_TYPE, 10, mapName), session))!, ss))).toEqual(new Set(['key-a', 'key-b']));
            expect(decodeDataListResponse<string>((await dispatcher.dispatch(buildNameRequest(MM_VALUES_REQUEST_TYPE, 11, mapName), session))!, ss)).toEqual(['v1', 'v2', 'v3']);
            expect(decodeEntrySetResponse<string, string>((await dispatcher.dispatch(buildNameRequest(MM_ENTRY_SET_REQUEST_TYPE, 12, mapName), session))!, ss)).toEqual([
                ['key-a', 'v1'],
                ['key-a', 'v2'],
                ['key-b', 'v3'],
            ]);

            expect(decodeBooleanResponse((await dispatcher.dispatch(buildMultiMapKeyValueRequest(MM_REMOVE_ENTRY_REQUEST_TYPE, 13, mapName, keyA, v1), session))!)).toBe(true);
            expect(decodeDataListResponse<string>((await dispatcher.dispatch(buildMultiMapKeyRequest(MM_REMOVE_REQUEST_TYPE, 14, mapName, keyA), session))!, ss)).toEqual(['v2']);
            await dispatcher.dispatch(buildNameRequest(MM_CLEAR_REQUEST_TYPE, 15, mapName), session);
            expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(MM_SIZE_REQUEST_TYPE, 16, mapName), session))!)).toBe(0);
        } finally {
            ss.destroy();
        }
    });

    test('multimap listener registration uses real entry events and UUID removal', async () => {
        const config = new HeliosConfig('multimap-protocol-listener');
        config.setClusterName('multimap-protocol-listener');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('multimap-listener') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const mapName = 'listener-multimap';
            const memberUuid = instance.getCluster().getLocalMember().getUuid();
            const addRequest = MultiMapAddEntryListenerCodec.encodeRequest(mapName, true, false);
            addRequest.setCorrelationId(40);
            addRequest.setPartitionId(-1);

            const addResponse = await dispatcher.dispatch(addRequest, session);
            const registrationId = FixedSizeTypesCodec.decodeUUID(
                addResponse!.getStartFrame().content,
                ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1,
            );

            expect(registrationId).toBeTruthy();

            expect(
                decodeBooleanResponse((await dispatcher.dispatch(
                    buildMultiMapKeyValueRequest(MM_PUT_REQUEST_TYPE, 41, mapName, ss.toData('key')!, ss.toData('value')!),
                    session,
                ))!),
            ).toBe(true);

            expect(session.events).toHaveLength(1);
            expect(session.events[0].getMessageType()).toBe(MultiMapAddEntryListenerCodec.EVENT_ENTRY_MESSAGE_TYPE);
            expect(session.events[0].getCorrelationId()).toBe(40);
            const addedEvent = MultiMapAddEntryListenerCodec.decodeEntryEvent(session.events[0]);
            expect(ss.toObject(addedEvent.key!) as string).toBe('key');
            expect(ss.toObject(addedEvent.value!) as string).toBe('value');
            expect(addedEvent.eventType).toBe(1);
            expect(addedEvent.uuid).toBe(memberUuid);
            expect(addedEvent.numberOfAffectedEntries).toBe(1);

            session.events.length = 0;
            await dispatcher.dispatch(buildNameRequest(MM_CLEAR_REQUEST_TYPE, 42, mapName), session);

            expect(session.events).toHaveLength(1);
            const clearEvent = MultiMapAddEntryListenerCodec.decodeEntryEvent(session.events[0]);
            expect(clearEvent.eventType).toBe(64);
            expect(clearEvent.uuid).toBe(memberUuid);
            expect(clearEvent.numberOfAffectedEntries).toBe(1);

            const removeResponse = await dispatcher.dispatch(
                buildRemoveListenerRequest(MM_REMOVE_LISTENER_REQUEST_TYPE, 43, mapName, registrationId!),
                session,
            );
            expect(decodeBooleanResponse(removeResponse!)).toBe(true);

            session.events.length = 0;
            expect(
                decodeBooleanResponse((await dispatcher.dispatch(
                    buildMultiMapKeyValueRequest(MM_PUT_REQUEST_TYPE, 44, mapName, ss.toData('key')!, ss.toData('second')!),
                    session,
                ))!),
            ).toBe(true);
            expect(session.events).toHaveLength(0);
        } finally {
            ss.destroy();
        }
    });
});
