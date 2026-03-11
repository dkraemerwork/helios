import { ClientMessage, ClientMessageFrame } from '../../src/client/impl/protocol/ClientMessage';
import { ListAddListenerCodec } from '../../src/client/impl/protocol/codec/ListAddListenerCodec.js';
import { DataCodec } from '../../src/client/impl/protocol/codec/builtin/DataCodec.js';
import {
    FixedSizeTypesCodec,
    INT_SIZE_IN_BYTES,
    UUID_SIZE_IN_BYTES,
} from '../../src/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '../../src/client/impl/protocol/codec/builtin/StringCodec.js';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { SerializationConfig } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { afterEach, describe, expect, test } from 'bun:test';

const LIST_SIZE_REQUEST_TYPE = 0x050100;
const LIST_CONTAINS_REQUEST_TYPE = 0x050200;
const LIST_CONTAINS_ALL_REQUEST_TYPE = 0x050300;
const LIST_ADD_REQUEST_TYPE = 0x050400;
const LIST_REMOVE_REQUEST_TYPE = 0x050500;
const LIST_ADD_ALL_REQUEST_TYPE = 0x050600;
const LIST_REMOVE_ALL_REQUEST_TYPE = 0x050700;
const LIST_RETAIN_ALL_REQUEST_TYPE = 0x050800;
const LIST_CLEAR_REQUEST_TYPE = 0x050900;
const LIST_ITERATOR_REQUEST_TYPE = 0x050a00;
const LIST_REMOVE_LISTENER_REQUEST_TYPE = 0x050c00;
const LIST_IS_EMPTY_REQUEST_TYPE = 0x050d00;
const LIST_ADD_ALL_WITH_INDEX_REQUEST_TYPE = 0x050e00;
const LIST_GET_REQUEST_TYPE = 0x050f00;
const LIST_SET_REQUEST_TYPE = 0x051000;
const LIST_ADD_WITH_INDEX_REQUEST_TYPE = 0x051100;
const LIST_REMOVE_WITH_INDEX_REQUEST_TYPE = 0x051200;
const LIST_LAST_INDEX_OF_REQUEST_TYPE = 0x051300;
const LIST_INDEX_OF_REQUEST_TYPE = 0x051400;
const LIST_SUB_LIST_REQUEST_TYPE = 0x051500;
const LIST_LIST_ITERATOR_REQUEST_TYPE = 0x051600;

const INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
const RESPONSE_VALUE_OFFSET = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1;
const INDEX_FIELD_OFFSET = INITIAL_FRAME_SIZE;

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

function buildIndexedNameRequest(messageType: number, correlationId: number, index: number, name: string): ClientMessage {
    const { msg, frame } = createRequest(messageType, correlationId, INT_SIZE_IN_BYTES);
    frame.writeInt32LE(index, INDEX_FIELD_OFFSET);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildIndexedNameDataRequest(messageType: number, correlationId: number, index: number, name: string, value: Data): ClientMessage {
    const { msg, frame } = createRequest(messageType, correlationId, INT_SIZE_IN_BYTES);
    frame.writeInt32LE(index, INDEX_FIELD_OFFSET);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, value);
    msg.setFinal();
    return msg;
}

function buildIndexedNameDataListRequest(messageType: number, correlationId: number, index: number, name: string, values: Data[]): ClientMessage {
    const { msg, frame } = createRequest(messageType, correlationId, INT_SIZE_IN_BYTES);
    frame.writeInt32LE(index, INDEX_FIELD_OFFSET);
    StringCodec.encode(msg, name);
    encodeDataList(msg, values);
    msg.setFinal();
    return msg;
}

function buildSubListRequest(correlationId: number, from: number, to: number, name: string): ClientMessage {
    const { msg, frame } = createRequest(LIST_SUB_LIST_REQUEST_TYPE, correlationId, INT_SIZE_IN_BYTES * 2);
    frame.writeInt32LE(from, INDEX_FIELD_OFFSET);
    frame.writeInt32LE(to, INDEX_FIELD_OFFSET + INT_SIZE_IN_BYTES);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildRemoveListenerRequest(correlationId: number, name: string, registrationId: string): ClientMessage {
    const { msg, frame } = createRequest(LIST_REMOVE_LISTENER_REQUEST_TYPE, correlationId, UUID_SIZE_IN_BYTES);
    FixedSizeTypesCodec.encodeUUID(frame, INDEX_FIELD_OFFSET, registrationId);
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

describe('list protocol adapter', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(() => {
        while (instances.length > 0) {
            instances.pop()!.shutdown();
        }
    });

    test('dispatches list operations through the real list service', async () => {
        const config = new HeliosConfig('list-protocol-ops');
        config.setClusterName('list-protocol-ops');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('list-ops') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const listName = 'protocol-list';
            const a = ss.toData('a')!;
            const b = ss.toData('b')!;
            const c = ss.toData('c')!;
            const d = ss.toData('d')!;
            const x = ss.toData('x')!;
            const y = ss.toData('y')!;
            const z = ss.toData('z')!;
            const bb = ss.toData('bb')!;

            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataRequest(LIST_ADD_REQUEST_TYPE, 1, listName, a), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataRequest(LIST_ADD_REQUEST_TYPE, 2, listName, b), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataRequest(LIST_ADD_REQUEST_TYPE, 3, listName, a), session))!)).toBe(true);
            await dispatcher.dispatch(buildIndexedNameDataRequest(LIST_ADD_WITH_INDEX_REQUEST_TYPE, 4, 1, listName, x), session);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataListRequest(LIST_ADD_ALL_REQUEST_TYPE, 5, listName, [c, d]), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildIndexedNameDataListRequest(LIST_ADD_ALL_WITH_INDEX_REQUEST_TYPE, 6, 2, listName, [y, z]), session))!)).toBe(true);

            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataRequest(LIST_CONTAINS_REQUEST_TYPE, 7, listName, z), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataListRequest(LIST_CONTAINS_ALL_REQUEST_TYPE, 8, listName, [a, d]), session))!)).toBe(true);
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildIndexedNameRequest(LIST_GET_REQUEST_TYPE, 9, 2, listName), session))!, ss)).toBe('y');
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildIndexedNameDataRequest(LIST_SET_REQUEST_TYPE, 10, 4, listName, bb), session))!, ss)).toBe('b');
            expect(decodeIntResponse((await dispatcher.dispatch(buildNameDataRequest(LIST_INDEX_OF_REQUEST_TYPE, 11, listName, a), session))!)).toBe(0);
            expect(decodeIntResponse((await dispatcher.dispatch(buildNameDataRequest(LIST_LAST_INDEX_OF_REQUEST_TYPE, 12, listName, a), session))!)).toBe(5);
            expect(decodeDataListResponse<string>((await dispatcher.dispatch(buildSubListRequest(13, 1, 5, listName), session))!, ss)).toEqual(['x', 'y', 'z', 'bb']);
            expect(decodeDataListResponse<string>((await dispatcher.dispatch(buildIndexedNameRequest(LIST_LIST_ITERATOR_REQUEST_TYPE, 14, 3, listName), session))!, ss)).toEqual(['z', 'bb', 'a', 'c', 'd']);

            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataRequest(LIST_REMOVE_REQUEST_TYPE, 15, listName, x), session))!)).toBe(true);
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildIndexedNameRequest(LIST_REMOVE_WITH_INDEX_REQUEST_TYPE, 16, 1, listName), session))!, ss)).toBe('y');
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataListRequest(LIST_REMOVE_ALL_REQUEST_TYPE, 17, listName, [a, c]), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataListRequest(LIST_RETAIN_ALL_REQUEST_TYPE, 18, listName, [z, d]), session))!)).toBe(true);
            expect(decodeDataListResponse<string>((await dispatcher.dispatch(buildNameRequest(LIST_ITERATOR_REQUEST_TYPE, 19, listName), session))!, ss)).toEqual(['z', 'd']);
            expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(LIST_SIZE_REQUEST_TYPE, 20, listName), session))!)).toBe(2);

            await dispatcher.dispatch(buildNameRequest(LIST_CLEAR_REQUEST_TYPE, 21, listName), session);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameRequest(LIST_IS_EMPTY_REQUEST_TYPE, 22, listName), session))!)).toBe(true);
        } finally {
            ss.destroy();
        }
    });

    test('list item listener add and remove works through the dispatcher', async () => {
        const config = new HeliosConfig('list-protocol-listener');
        config.setClusterName('list-protocol-listener');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('list-listener') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const memberUuid = instance.getCluster().getLocalMember().getUuid();
            const listName = 'listener-list';

            const addRequest = ListAddListenerCodec.encodeRequest(listName, true, false);
            addRequest.setCorrelationId(30);
            addRequest.setPartitionId(-1);
            const addResponse = await dispatcher.dispatch(addRequest, session);
            const registrationId = ListAddListenerCodec.decodeResponse(addResponse!);

            expect(registrationId).toBeTruthy();
            expect((instance as any)._distributedListService).not.toBeNull();

            const list = instance.getList<string>(listName) as any;
            expect(await list.add('first')).toBe(true);

            expect(session.events).toHaveLength(1);
            expect(session.events[0].getMessageType()).toBe(ListAddListenerCodec.EVENT_ITEM_MESSAGE_TYPE);
            expect(session.events[0].getCorrelationId()).toBe(30);
            const addedEvent = ListAddListenerCodec.decodeItemEvent(session.events[0]);
            expect(ss.toObject(addedEvent.item!) as string).toBe('first');
            expect(addedEvent.eventType).toBe(1);
            expect(addedEvent.uuid).toBe(memberUuid);

            session.events.length = 0;
            expect(await list.removeAt(0)).toBe('first');

            expect(session.events).toHaveLength(1);
            const removedEvent = ListAddListenerCodec.decodeItemEvent(session.events[0]);
            expect(ss.toObject(removedEvent.item!) as string).toBe('first');
            expect(removedEvent.eventType).toBe(2);
            expect(removedEvent.uuid).toBe(memberUuid);

            const removeResponse = await dispatcher.dispatch(buildRemoveListenerRequest(33, listName, registrationId!), session);
            expect(decodeBooleanResponse(removeResponse!)).toBe(true);

            session.events.length = 0;
            expect(await list.add('second')).toBe(true);
            expect(session.events).toHaveLength(0);
        } finally {
            ss.destroy();
        }
    });

    test('list listeners observe real proxy mutations after listener registration', async () => {
        const config = new HeliosConfig('list-protocol-proxy-listener');
        config.setClusterName('list-protocol-proxy-listener');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('list-proxy-listener') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const listName = 'proxy-listener-list';
            const addRequest = ListAddListenerCodec.encodeRequest(listName, true, false);
            addRequest.setCorrelationId(40);
            addRequest.setPartitionId(-1);

            const addResponse = await dispatcher.dispatch(addRequest, session);
            expect(ListAddListenerCodec.decodeResponse(addResponse!)).toBeTruthy();

            const list = instance.getList<string>(listName) as any;
            await list.add('proxy-add');
            await list.set(0, 'proxy-set');
            await list.clear();

            const events = session.events.map((message: ClientMessage) => ListAddListenerCodec.decodeItemEvent(message));
            expect(events).toHaveLength(4);
            expect(events.map((event: { item: Data | null; uuid: string | null; eventType: number }) => ({
                item: ss.toObject(event.item!) as string,
                eventType: event.eventType,
            }))).toEqual([
                { item: 'proxy-add', eventType: 1 },
                { item: 'proxy-add', eventType: 2 },
                { item: 'proxy-set', eventType: 1 },
                { item: 'proxy-set', eventType: 2 },
            ]);
        } finally {
            ss.destroy();
        }
    });
});
