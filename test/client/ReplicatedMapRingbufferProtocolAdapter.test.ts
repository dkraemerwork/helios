import { ClientMessage, ClientMessageFrame } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { MapAddEntryListenerCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapAddEntryListenerCodec';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import {
    INT_SIZE_IN_BYTES,
    LONG_SIZE_IN_BYTES,
} from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { RingbufferConfig } from '@zenystx/helios-core/config/RingbufferConfig';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { SerializationConfig } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import { OverflowPolicy } from '@zenystx/helios-core/ringbuffer/OverflowPolicy';
import { afterEach, describe, expect, test } from 'bun:test';

const RM_PUT_REQUEST_TYPE = 0x0d0100;
const RM_GET_REQUEST_TYPE = 0x0d0600;
const RM_REMOVE_REQUEST_TYPE = 0x0d0700;
const RM_SIZE_REQUEST_TYPE = 0x0d0200;
const RM_CONTAINS_KEY_REQUEST_TYPE = 0x0d0400;
const RM_CONTAINS_VALUE_REQUEST_TYPE = 0x0d0500;
const RM_CLEAR_REQUEST_TYPE = 0x0d0900;
const RM_KEY_SET_REQUEST_TYPE = 0x0d0f00;
const RM_VALUES_REQUEST_TYPE = 0x0d1000;
const RM_ENTRY_SET_REQUEST_TYPE = 0x0d1100;
const RM_PUT_ALL_REQUEST_TYPE = 0x0d0800;
const RM_IS_EMPTY_REQUEST_TYPE = 0x0d0300;
const RM_ADD_LISTENER_REQUEST_TYPE = 0x0d0d00;
const RM_REMOVE_LISTENER_REQUEST_TYPE = 0x0d0e00;
const RM_ADD_LISTENER_KEY_REQUEST_TYPE = 0x0d0c00;
const RM_ADD_LISTENER_PRED_REQUEST_TYPE = 0x0d0b00;
const RM_ADD_LISTENER_KEY_PRED_REQUEST_TYPE = 0x0d0a00;

const RB_SIZE_REQUEST_TYPE = 0x170100;
const RB_TAIL_SEQ_REQUEST_TYPE = 0x170200;
const RB_HEAD_SEQ_REQUEST_TYPE = 0x170300;
const RB_CAPACITY_REQUEST_TYPE = 0x170400;
const RB_REMAINING_CAP_REQUEST_TYPE = 0x170500;
const RB_ADD_REQUEST_TYPE = 0x170600;
const RB_READ_ONE_REQUEST_TYPE = 0x170700;
const RB_ADD_ALL_REQUEST_TYPE = 0x170800;
const RB_READ_MANY_REQUEST_TYPE = 0x170900;

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

function buildReplicatedMapPutRequest(correlationId: number, name: string, key: Data, value: Data): ClientMessage {
    const { msg, frame } = createRequest(RM_PUT_REQUEST_TYPE, correlationId, LONG_SIZE_IN_BYTES);
    frame.writeBigInt64LE(0n, INITIAL_FRAME_SIZE);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, key);
    DataCodec.encode(msg, value);
    msg.setFinal();
    return msg;
}

function buildEntryListRequest(correlationId: number, name: string, entries: Array<[Data, Data]>): ClientMessage {
    const { msg } = createRequest(RM_PUT_ALL_REQUEST_TYPE, correlationId);
    StringCodec.encode(msg, name);
    msg.add(new ClientMessageFrame(Buffer.alloc(0), ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));
    for (const [key, value] of entries) {
        DataCodec.encode(msg, key);
        DataCodec.encode(msg, value);
    }
    msg.add(new ClientMessageFrame(Buffer.alloc(0), ClientMessage.END_DATA_STRUCTURE_FLAG));
    msg.setFinal();
    return msg;
}

function buildReplicatedMapListenerRequest(messageType: number, correlationId: number, name: string, key?: Data, predicate?: Data): ClientMessage {
    const { msg } = createRequest(messageType, correlationId);
    StringCodec.encode(msg, name);
    if (key !== undefined) {
        DataCodec.encode(msg, key);
    }
    if (predicate !== undefined) {
        DataCodec.encode(msg, predicate);
    }
    msg.setFinal();
    return msg;
}

function buildStringRequest(messageType: number, correlationId: number, value: string): ClientMessage {
    const { msg } = createRequest(messageType, correlationId);
    StringCodec.encode(msg, value);
    msg.setFinal();
    return msg;
}

function buildRingbufferAddRequest(correlationId: number, name: string, value: Data, overflowPolicy: number): ClientMessage {
    const { msg, frame } = createRequest(RB_ADD_REQUEST_TYPE, correlationId, INT_SIZE_IN_BYTES);
    frame.writeInt32LE(overflowPolicy, INITIAL_FRAME_SIZE);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, value);
    msg.setFinal();
    return msg;
}

function buildRingbufferAddAllRequest(correlationId: number, name: string, values: Data[], overflowPolicy: number): ClientMessage {
    const { msg, frame } = createRequest(RB_ADD_ALL_REQUEST_TYPE, correlationId, INT_SIZE_IN_BYTES);
    frame.writeInt32LE(overflowPolicy, INITIAL_FRAME_SIZE);
    StringCodec.encode(msg, name);
    encodeDataList(msg, values);
    msg.setFinal();
    return msg;
}

function buildRingbufferReadOneRequest(correlationId: number, name: string, sequence: bigint): ClientMessage {
    const { msg, frame } = createRequest(RB_READ_ONE_REQUEST_TYPE, correlationId, LONG_SIZE_IN_BYTES);
    frame.writeBigInt64LE(sequence, INITIAL_FRAME_SIZE);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildRingbufferReadManyRequest(correlationId: number, name: string, startSequence: bigint, minCount: number, maxCount: number): ClientMessage {
    const { msg, frame } = createRequest(RB_READ_MANY_REQUEST_TYPE, correlationId, LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES * 2);
    frame.writeBigInt64LE(startSequence, INITIAL_FRAME_SIZE);
    frame.writeInt32LE(minCount, INITIAL_FRAME_SIZE + LONG_SIZE_IN_BYTES);
    frame.writeInt32LE(maxCount, INITIAL_FRAME_SIZE + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
    StringCodec.encode(msg, name);
    msg.add(ClientMessage.NULL_FRAME);
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

function decodeRingbufferReadManyResponse<T>(message: ClientMessage, ss: SerializationServiceImpl): {
    readCount: number;
    nextSeq: bigint;
    items: T[];
    itemSeqs: bigint[] | null;
} {
    const startFrame = message.getStartFrame().content;
    const readCount = startFrame.readInt32LE(RESPONSE_VALUE_OFFSET);
    const nextSeq = startFrame.readBigInt64LE(RESPONSE_VALUE_OFFSET + INT_SIZE_IN_BYTES);
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
    const itemSeqsFrame = iterator.peekNext();
    if (itemSeqsFrame?.isNullFrame()) {
        iterator.next();
        return { readCount, nextSeq, items, itemSeqs: null };
    }
    iterator.next();
    const itemSeqs: bigint[] = [];
    while (iterator.hasNext()) {
        const next = iterator.peekNext();
        if (next?.isEndFrame()) {
            iterator.next();
            break;
        }
        itemSeqs.push(iterator.next().content.readBigInt64LE(0));
    }
    return { readCount, nextSeq, items, itemSeqs };
}

describe('replicated map and ringbuffer protocol adapter', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(() => {
        while (instances.length > 0) {
            instances.pop()!.shutdown();
        }
    });

    test('dispatches replicated map operations through the real distributed replicated map service', async () => {
        const config = new HeliosConfig('replicated-map-protocol-ops');
        config.setClusterName('replicated-map-protocol-ops');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('replicated-map-ops') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const mapName = 'protocol-replicated-map';
            const keyA = ss.toData('key-a')!;
            const keyB = ss.toData('key-b')!;
            const valueA = ss.toData('value-a')!;
            const valueB = ss.toData('value-b')!;
            const valueC = ss.toData('value-c')!;

            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildReplicatedMapPutRequest(1, mapName, keyA, valueA), session))!, ss)).toBeNull();
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildReplicatedMapPutRequest(2, mapName, keyA, valueB), session))!, ss)).toBe('value-a');
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildReplicatedMapPutRequest(3, mapName, keyB, valueC), session))!, ss)).toBeNull();

            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildNameDataRequest(RM_GET_REQUEST_TYPE, 4, mapName, keyA), session))!, ss)).toBe('value-b');
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataRequest(RM_CONTAINS_KEY_REQUEST_TYPE, 5, mapName, keyB), session))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameDataRequest(RM_CONTAINS_VALUE_REQUEST_TYPE, 6, mapName, valueC), session))!)).toBe(true);
            expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(RM_SIZE_REQUEST_TYPE, 7, mapName), session))!)).toBe(2);
            expect(new Set(decodeDataListResponse<string>((await dispatcher.dispatch(buildNameRequest(RM_KEY_SET_REQUEST_TYPE, 8, mapName), session))!, ss))).toEqual(new Set(['key-a', 'key-b']));
            expect(decodeDataListResponse<string>((await dispatcher.dispatch(buildNameRequest(RM_VALUES_REQUEST_TYPE, 9, mapName), session))!, ss)).toEqual(['value-b', 'value-c']);
            expect(decodeEntrySetResponse<string, string>((await dispatcher.dispatch(buildNameRequest(RM_ENTRY_SET_REQUEST_TYPE, 10, mapName), session))!, ss)).toEqual([
                ['key-a', 'value-b'],
                ['key-b', 'value-c'],
            ]);

            await dispatcher.dispatch(buildEntryListRequest(11, mapName, [[ss.toData('key-c')!, ss.toData('value-d')!]]), session);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameRequest(RM_IS_EMPTY_REQUEST_TYPE, 12, mapName), session))!)).toBe(false);
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildNameDataRequest(RM_REMOVE_REQUEST_TYPE, 13, mapName, keyB), session))!, ss)).toBe('value-c');
            await dispatcher.dispatch(buildNameRequest(RM_CLEAR_REQUEST_TYPE, 14, mapName), session);
            expect(decodeBooleanResponse((await dispatcher.dispatch(buildNameRequest(RM_IS_EMPTY_REQUEST_TYPE, 15, mapName), session))!)).toBe(true);
        } finally {
            ss.destroy();
        }
    });

    test('replicated map listener registrations use real service events for general and key-filtered listeners', async () => {
        const config = new HeliosConfig('replicated-map-protocol-listener');
        config.setClusterName('replicated-map-protocol-listener');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('replicated-map-listener') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const mapName = 'listener-replicated-map';
            const memberUuid = instance.getCluster().getLocalMember().getUuid();
            const watchedKey = ss.toData('watched')!;

            const allRegistrationId = decodeStringResponse((await dispatcher.dispatch(
                buildReplicatedMapListenerRequest(RM_ADD_LISTENER_REQUEST_TYPE, 30, mapName),
                session,
            ))!);
            const filteredRegistrationId = decodeStringResponse((await dispatcher.dispatch(
                buildReplicatedMapListenerRequest(RM_ADD_LISTENER_KEY_REQUEST_TYPE, 31, mapName, watchedKey),
                session,
            ))!);

            expect(allRegistrationId).toBeTruthy();
            expect(filteredRegistrationId).toBeTruthy();

            const replicatedMap = instance.getReplicatedMap<string, { status: string }>(mapName);
            replicatedMap.put('watched', { status: 'match' });
            replicatedMap.put('watched', { status: 'updated' });
            replicatedMap.remove('watched');
            replicatedMap.put('other', { status: 'match' });
            replicatedMap.clear();

            const allEvents = session.events
                .filter((message: ClientMessage) => message.getCorrelationId() === 30)
                .map((message: ClientMessage) => MapAddEntryListenerCodec.decodeEntryEvent(message));
            expect(allEvents).toHaveLength(5);
            expect(allEvents.map((event: ReturnType<typeof MapAddEntryListenerCodec.decodeEntryEvent>) => event.eventType)).toEqual([1, 4, 2, 1, 64]);
            expect(ss.toObject(allEvents[0]!.key!) as string).toBe('watched');
            expect(ss.toObject(allEvents[0]!.value!) as { status: string }).toEqual({ status: 'match' });
            expect(allEvents[0]!.uuid).toBe(memberUuid);
            expect(ss.toObject(allEvents[1]!.oldValue!) as { status: string }).toEqual({ status: 'match' });
            expect(allEvents[4]!.numberOfAffectedEntries).toBe(1);

            const filteredEvents = session.events
                .filter((message: ClientMessage) => message.getCorrelationId() === 31)
                .map((message: ClientMessage) => MapAddEntryListenerCodec.decodeEntryEvent(message));
            expect(filteredEvents).toHaveLength(4);
            expect(filteredEvents.map((event: ReturnType<typeof MapAddEntryListenerCodec.decodeEntryEvent>) => event.eventType)).toEqual([1, 4, 2, 64]);
            expect(ss.toObject(filteredEvents[0]!.key!) as string).toBe('watched');

            expect(decodeBooleanResponse((await dispatcher.dispatch(
                buildStringRequest(RM_REMOVE_LISTENER_REQUEST_TYPE, 32, allRegistrationId),
                session,
            ))!)).toBe(true);
            expect(decodeBooleanResponse((await dispatcher.dispatch(
                buildStringRequest(RM_REMOVE_LISTENER_REQUEST_TYPE, 33, filteredRegistrationId),
                session,
            ))!)).toBe(true);

            session.events.length = 0;
            replicatedMap.put('watched', { status: 'match' });
            expect(session.events).toHaveLength(0);
        } finally {
            ss.destroy();
        }
    });

    test('dispatches ringbuffer operations through the real distributed ringbuffer service', async () => {
        const config = new HeliosConfig('ringbuffer-protocol-ops');
        config.setClusterName('ringbuffer-protocol-ops');
        config.getNetworkConfig().setClientProtocolPort(0);
        config.addRingbufferConfig(new RingbufferConfig('protocol-ringbuffer').setCapacity(5));
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('ringbuffer-ops') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const rbName = 'protocol-ringbuffer';
            const a = ss.toData('a')!;
            const b = ss.toData('b')!;
            const c = ss.toData('c')!;

            expect(decodeLongResponse((await dispatcher.dispatch(buildRingbufferAddRequest(1, rbName, a, OverflowPolicy.OVERWRITE.getId()), session))!)).toBe(0n);
            expect(decodeLongResponse((await dispatcher.dispatch(buildRingbufferAddAllRequest(2, rbName, [b, c], OverflowPolicy.OVERWRITE.getId()), session))!)).toBe(2n);
            expect(decodeLongResponse((await dispatcher.dispatch(buildNameRequest(RB_SIZE_REQUEST_TYPE, 3, rbName), session))!)).toBe(3n);
            expect(decodeLongResponse((await dispatcher.dispatch(buildNameRequest(RB_CAPACITY_REQUEST_TYPE, 4, rbName), session))!)).toBe(5n);
            expect(decodeLongResponse((await dispatcher.dispatch(buildNameRequest(RB_HEAD_SEQ_REQUEST_TYPE, 5, rbName), session))!)).toBe(0n);
            expect(decodeLongResponse((await dispatcher.dispatch(buildNameRequest(RB_TAIL_SEQ_REQUEST_TYPE, 6, rbName), session))!)).toBe(2n);
            expect(decodeLongResponse((await dispatcher.dispatch(buildNameRequest(RB_REMAINING_CAP_REQUEST_TYPE, 7, rbName), session))!)).toBe(
                BigInt(await (instance as any)._distributedRingbufferService.remainingCapacity(rbName)),
            );
            expect(decodeNullableDataResponse<string>((await dispatcher.dispatch(buildRingbufferReadOneRequest(8, rbName, 1n), session))!, ss)).toBe('b');

            const readMany = decodeRingbufferReadManyResponse<string>((await dispatcher.dispatch(
                buildRingbufferReadManyRequest(9, rbName, 0n, 1, 10),
                session,
            ))!, ss);
            expect(readMany.readCount).toBe(3);
            expect(readMany.items).toEqual(['a', 'b', 'c']);
            expect(readMany.itemSeqs).toEqual([0n, 1n, 2n]);
            expect(readMany.nextSeq).toBe(3n);
        } finally {
            ss.destroy();
        }
    });

    test('ringbuffer readMany reports clamped item sequences after head sequence advances', async () => {
        const config = new HeliosConfig('ringbuffer-protocol-clamped-readmany');
        config.setClusterName('ringbuffer-protocol-clamped-readmany');
        config.getNetworkConfig().setClientProtocolPort(0);
        config.addRingbufferConfig(new RingbufferConfig('clamped-ringbuffer').setCapacity(2));
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('ringbuffer-clamped-readmany') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const rbName = 'clamped-ringbuffer';
            await dispatcher.dispatch(buildRingbufferAddRequest(1, rbName, ss.toData('a')!, OverflowPolicy.OVERWRITE.getId()), session);
            await dispatcher.dispatch(buildRingbufferAddRequest(2, rbName, ss.toData('b')!, OverflowPolicy.OVERWRITE.getId()), session);
            await dispatcher.dispatch(buildRingbufferAddRequest(3, rbName, ss.toData('c')!, OverflowPolicy.OVERWRITE.getId()), session);

            const readMany = decodeRingbufferReadManyResponse<string>((await dispatcher.dispatch(
                buildRingbufferReadManyRequest(4, rbName, 0n, 1, 10),
                session,
            ))!, ss);

            expect(readMany.items).toEqual(['b', 'c']);
            expect(readMany.itemSeqs).toEqual([1n, 2n]);
            expect(readMany.nextSeq).toBe(3n);
        } finally {
            ss.destroy();
        }
    });
});
