/**
 * ICache Event Journal — real put→journal→subscribe/read path.
 * Official opcodes (hazelcast-client@5.6.0 / helios-1 codecs):
 *   Subscribe REQUEST/RESPONSE = 0x131F00 / 0x131F01
 *   Read      REQUEST/RESPONSE = 0x132000 / 0x132001
 *
 * The live e2e test drives Cache.Put (0x130300) through the instance's
 * registered ClientMessageDispatcher → CacheServiceHandlers → cacheOps.put
 * (HeliosInstanceImpl), which is the only path that must write the journal.
 * Subscribe/Read then go through the same real dispatcher. No stub ops,
 * no manual writeAddEvent on the live path.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { EventJournalConfig } from '@zenystx/helios-core/config/EventJournalConfig';
import { CacheEventJournal } from '@zenystx/helios-core/internal/journal/CacheEventJournal';
import { EventJournalEventType } from '@zenystx/helios-core/internal/journal/EventJournalEvent';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { SerializationConfig } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import { ClientMessage, ClientMessageFrame } from '../../src/client/impl/protocol/ClientMessage';
import { DataCodec } from '../../src/client/impl/protocol/codec/builtin/DataCodec.js';
import {
    BOOLEAN_SIZE_IN_BYTES,
    INT_SIZE_IN_BYTES,
    LONG_SIZE_IN_BYTES,
} from '../../src/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '../../src/client/impl/protocol/codec/builtin/StringCodec.js';
import { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher';
import { registerCacheServiceHandlers } from '@zenystx/helios-core/server/clientprotocol/handlers/CacheServiceHandlers';
import type { CacheServiceOperations } from '@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations';

/** Official hazelcast-client CacheEventJournal message types */
const SUBSCRIBE_REQ = 0x131F00;
const SUBSCRIBE_RES = 0x131F01;
const READ_REQ = 0x132000;
const READ_RES = 0x132001;
const CACHE_PUT_REQUEST = 0x130300;
const CACHE_PUT_RESPONSE = 0x130301;
const CACHE_REMOVE_REQUEST = 0x130500;
const CACHE_REMOVE_RESPONSE = 0x130501;

const INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
const COMPLETION_ID_OFFSET = INITIAL_FRAME_SIZE;
const BOOLEAN_FLAG_OFFSET = INITIAL_FRAME_SIZE + INT_SIZE_IN_BYTES;
const RESPONSE_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES;

class TestClientSession {
    isAuthenticated(): boolean {
        return true;
    }
    getSessionId(): string {
        return 'cache-ej-session';
    }
}

function createRequest(
    messageType: number,
    correlationId: number,
    extraBytes = 0,
    partitionId = -1,
): { msg: ClientMessage; frame: Buffer } {
    const msg = ClientMessage.createForEncode();
    const frame = Buffer.alloc(INITIAL_FRAME_SIZE + extraBytes);
    frame.writeUInt32LE(messageType >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
    frame.writeInt32LE(partitionId, ClientMessage.PARTITION_ID_FIELD_OFFSET);
    msg.add(new ClientMessageFrame(frame));
    msg.setCorrelationId(correlationId);
    msg.setPartitionId(partitionId);
    return { msg, frame };
}

function buildCachePutRequest(
    correlationId: number,
    name: string,
    key: Data,
    value: Data,
    partitionId: number,
    isGet = false,
): ClientMessage {
    const { msg, frame } = createRequest(
        CACHE_PUT_REQUEST,
        correlationId,
        INT_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES,
        partitionId,
    );
    frame.writeInt32LE(0, COMPLETION_ID_OFFSET);
    frame.writeUInt8(isGet ? 1 : 0, BOOLEAN_FLAG_OFFSET);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, key);
    DataCodec.encode(msg, value);
    msg.add(ClientMessage.NULL_FRAME);
    msg.setFinal();
    return msg;
}

function buildCacheRemoveRequest(
    correlationId: number,
    name: string,
    key: Data,
    partitionId: number,
): ClientMessage {
    const { msg, frame } = createRequest(CACHE_REMOVE_REQUEST, correlationId, INT_SIZE_IN_BYTES, partitionId);
    frame.writeInt32LE(0, COMPLETION_ID_OFFSET);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, key);
    msg.add(ClientMessage.NULL_FRAME);
    msg.setFinal();
    return msg;
}

function buildSubscribeRequest(correlationId: number, name: string, partitionId: number): ClientMessage {
    const { msg } = createRequest(SUBSCRIBE_REQ, correlationId, 0, partitionId);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildReadRequest(
    correlationId: number,
    name: string,
    partitionId: number,
    startSequence: bigint,
    minCount: number,
    maxCount: number,
): ClientMessage {
    const { msg, frame } = createRequest(
        READ_REQ,
        correlationId,
        LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES * 2,
        partitionId,
    );
    frame.writeBigInt64LE(startSequence, ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES);
    frame.writeInt32LE(minCount, ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
    frame.writeInt32LE(
        maxCount,
        ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES,
    );
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function decodeSubscribeSequences(response: ClientMessage): { oldest: bigint; newest: bigint } {
    const frame = response.forwardFrameIterator().next();
    const oldest = frame.content.readBigInt64LE(RESPONSE_HEADER_SIZE);
    const newest = frame.content.readBigInt64LE(RESPONSE_HEADER_SIZE + LONG_SIZE_IN_BYTES);
    return { oldest, newest };
}

function decodeReadCount(response: ClientMessage): number {
    const frame = response.forwardFrameIterator().next();
    return frame.content.readInt32LE(RESPONSE_HEADER_SIZE);
}

describe('CacheEventJournal', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(() => {
        while (instances.length > 0) {
            instances.pop()!.shutdown();
        }
    });

    test('writes put/remove events and reads them back', () => {
        const journal = new CacheEventJournal();
        const cfg = new EventJournalConfig();
        cfg.setEnabled(true);
        cfg.setCapacity(100);
        journal.registerConfig('c1', cfg);

        const ss = new SerializationServiceImpl(new SerializationConfig());
        const key = ss.toData('k1')!;
        const val = ss.toData('v1')!;
        const val2 = ss.toData('v2')!;

        const seq1 = journal.writeAddEvent('c1', 0, key, null, val);
        expect(seq1).not.toBeNull();
        const seq2 = journal.writeAddEvent('c1', 0, key, val, val2);
        expect(seq2).not.toBeNull();
        const seq3 = journal.writeRemoveEvent('c1', 0, key, val2);
        expect(seq3).not.toBeNull();

        const oldest = journal.getHeadSequence('c1', 0);
        const newest = journal.getTailSequence('c1', 0);
        expect(newest >= oldest).toBe(true);

        const events = journal.readMany('c1', 0, oldest, 1, 10);
        expect(events.length).toBe(3);
        expect(events[0]!.eventType).toBe(EventJournalEventType.ADDED);
        expect(events[1]!.eventType).toBe(EventJournalEventType.UPDATED);
        expect(events[2]!.eventType).toBe(EventJournalEventType.REMOVED);
    });

    test('registers official Subscribe 0x131F00 and Read 0x132000 opcodes', async () => {
        const journal = new CacheEventJournal();
        const cfg = new EventJournalConfig();
        cfg.setEnabled(true);
        journal.registerConfig('wired', cfg);

        const ss = new SerializationServiceImpl(new SerializationConfig());
        const key = ss.toData('pk')!;
        const val = ss.toData('pv')!;
        journal.writeAddEvent('wired', 3, key, null, val);

        const ops: Partial<CacheServiceOperations> = {
            eventJournalSubscribe: async (name, partitionId) => ({
                oldest: journal.getHeadSequence(name, partitionId),
                newest: journal.getTailSequence(name, partitionId),
            }),
            eventJournalRead: async (name, partitionId, start, min, max) =>
                journal.readMany(name, partitionId, start, min, max),
            get: async () => null,
            put: async () => null,
            remove: async () => false,
            size: async () => 0,
            clear: async () => {},
            containsKey: async () => false,
            getAndPut: async () => null,
            getAndRemove: async () => null,
            getAndReplace: async () => null,
            putIfAbsent: async () => false,
            replace: async () => false,
            getAll: async () => [],
            putAll: async () => {},
            removeAll: async () => {},
            destroy: async () => {},
            addInvalidationListener: async () => 'x',
            removeInvalidationListener: async () => true,
            addEntryListener: async () => 'x',
            removeEntryListener: async () => true,
            invokeEntryProcessor: async () => null,
            invokeEntryProcessorAll: async () => [],
        };

        const dispatcher = new ClientMessageDispatcher();
        registerCacheServiceHandlers(dispatcher, ops as CacheServiceOperations);

        expect(dispatcher.hasHandler(SUBSCRIBE_REQ)).toBe(true);
        expect(dispatcher.hasHandler(READ_REQ)).toBe(true);
        // Official opcodes only — Read is 0x132000; Subscribe must be 0x131F00
        expect(SUBSCRIBE_REQ).toBe(0x131F00);
        expect(READ_REQ).toBe(0x132000);

        const session = new TestClientSession() as never;

        const subResp = await dispatcher.dispatch(buildSubscribeRequest(1, 'wired', 3), session);
        expect(subResp).not.toBeNull();
        expect(subResp!.getMessageType()).toBe(SUBSCRIBE_RES);

        const readResp = await dispatcher.dispatch(buildReadRequest(2, 'wired', 3, 0n, 1, 10), session);
        expect(readResp).not.toBeNull();
        expect(readResp!.getMessageType()).toBe(READ_RES);
    });

    test('live Helios member: cache put writes journal; subscribe/read via real ops', async () => {
        const config = new HeliosConfig('cache-ej-e2e');
        config.setClusterName('cache-ej-e2e');
        config.getNetworkConfig().setPort(0).setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        // Real shipped dispatcher wired in HeliosInstanceImpl._startClientProtocolServer
        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher() as ClientMessageDispatcher;
        expect(dispatcher.hasHandler(CACHE_PUT_REQUEST)).toBe(true);
        expect(dispatcher.hasHandler(SUBSCRIBE_REQ)).toBe(true);
        expect(dispatcher.hasHandler(READ_REQ)).toBe(true);

        const session = new TestClientSession() as never;
        const ss = new SerializationServiceImpl(new SerializationConfig());
        try {
            const cacheName = 'ej-live';
            const key = ss.toData('live-key')!;
            const val = ss.toData('live-val')!;
            const val2 = ss.toData('live-val-2')!;
            const partitionId = instance.getNodeEngine().getPartitionService().getPartitionId(key);

            // Journal must be empty before any put through the real protocol path
            const journal: CacheEventJournal = (instance as any)._cacheEventJournal;
            expect(journal.size(cacheName, partitionId)).toBe(0);

            // Drive put via real Cache.Put handler → cacheOps.put → writeAddEvent
            const put1 = await dispatcher.dispatch(
                buildCachePutRequest(1, cacheName, key, val, partitionId, false),
                session,
            );
            expect(put1).not.toBeNull();
            expect(put1!.getMessageType()).toBe(CACHE_PUT_RESPONSE);

            // Side-effect of shipped put path only (no manual journal write)
            expect(journal.isEnabled(cacheName)).toBe(true);
            expect(journal.size(cacheName, partitionId)).toBe(1);

            const put2 = await dispatcher.dispatch(
                buildCachePutRequest(2, cacheName, key, val2, partitionId, false),
                session,
            );
            expect(put2).not.toBeNull();
            expect(put2!.getMessageType()).toBe(CACHE_PUT_RESPONSE);
            expect(journal.size(cacheName, partitionId)).toBe(2);

            const removeResp = await dispatcher.dispatch(
                buildCacheRemoveRequest(3, cacheName, key, partitionId),
                session,
            );
            expect(removeResp).not.toBeNull();
            expect(removeResp!.getMessageType()).toBe(CACHE_REMOVE_RESPONSE);
            expect(journal.size(cacheName, partitionId)).toBe(3);

            // Observe events produced solely by the real put/remove path
            const events = journal.readMany(cacheName, partitionId, journal.getHeadSequence(cacheName, partitionId), 1, 10);
            expect(events.length).toBe(3);
            expect(events[0]!.eventType).toBe(EventJournalEventType.ADDED);
            expect(events[1]!.eventType).toBe(EventJournalEventType.UPDATED);
            expect(events[2]!.eventType).toBe(EventJournalEventType.REMOVED);

            // Subscribe 0x131F00 / Read 0x132000 via the same real dispatcher + cacheOps
            const subResp = await dispatcher.dispatch(
                buildSubscribeRequest(4, cacheName, partitionId),
                session,
            );
            expect(subResp).not.toBeNull();
            expect(subResp!.getMessageType()).toBe(SUBSCRIBE_RES);
            const { oldest, newest } = decodeSubscribeSequences(subResp!);
            expect(newest >= oldest).toBe(true);
            // Three events → newest should be at least oldest + 2
            expect(newest - oldest).toBeGreaterThanOrEqual(2n);

            const readResp = await dispatcher.dispatch(
                buildReadRequest(5, cacheName, partitionId, oldest, 1, 10),
                session,
            );
            expect(readResp).not.toBeNull();
            expect(readResp!.getMessageType()).toBe(READ_RES);
            expect(decodeReadCount(readResp!)).toBe(3);
        } finally {
            ss.destroy();
        }
    });
});
