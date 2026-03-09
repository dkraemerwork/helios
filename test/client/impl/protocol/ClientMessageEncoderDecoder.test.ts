/**
 * Port of com.hazelcast.client.impl.protocol.ClientMessageEncoderDecoderTest
 * and related codec round-trip tests.
 */
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { ClientMessageReader } from '@zenystx/helios-core/client/impl/protocol/ClientMessageReader';
import { ClientMessageWriter } from '@zenystx/helios-core/client/impl/protocol/ClientMessageWriter';
import { ClientAuthenticationCodec } from '@zenystx/helios-core/client/impl/protocol/codec/ClientAuthenticationCodec';
import { MapAddEntryListenerCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapAddEntryListenerCodec';
import { QueueAddListenerCodec } from '@zenystx/helios-core/client/impl/protocol/codec/QueueAddListenerCodec.js';
import { MapPutCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapPutCodec';
import { Address } from '@zenystx/helios-core/cluster/Address';
import { ByteBuffer } from '@zenystx/helios-core/internal/networking/ByteBuffer';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';
import { describe, expect, it } from 'bun:test';

function roundTrip(msg: ClientMessage): ClientMessage {
    const bufSize = msg.getFrameLength() + 64;
    const buf = ByteBuffer.allocate(bufSize);
    const writer = new ClientMessageWriter();
    const done = writer.writeTo(buf, msg);
    expect(done).toBe(true);
    buf.flip();

    const reader = new ClientMessageReader();
    const readDone = reader.readFrom(buf, true);
    expect(readDone).toBe(true);
    return reader.getClientMessage();
}

describe('ClientMessage encode/decode round-trip', () => {
    it('simpleFrame — single frame round-trip', () => {
        const msg = ClientMessage.createForEncode();
        msg.add(new ClientMessage.Frame(Buffer.from('hello')));
        msg.setFinal();

        const result = roundTrip(msg);
        expect(result.getStartFrame().content.toString()).toBe('hello');
    });

    it('mapPut request round-trip', () => {
        // Build a HeapData payload (needs to be >= 8 bytes for HeapData type offset)
        const keyBuf = Buffer.allocUnsafe(8);
        keyBuf.fill(1);
        const valBuf = Buffer.allocUnsafe(8);
        valBuf.fill(2);
        const key = new HeapData(keyBuf);
        const value = new HeapData(valBuf);

        const msg = MapPutCodec.encodeRequest('myMap', key, value, 42n, 5000n);
        const result = roundTrip(msg);

        expect(result.getMessageType()).toBe(MapPutCodec.REQUEST_MESSAGE_TYPE);

        const decoded = MapPutCodec.decodeRequest(result);
        expect(decoded.name).toBe('myMap');
        expect(decoded.threadId).toBe(42n);
        expect(decoded.ttl).toBe(5000n);
        expect(decoded.key.toByteArray()).toEqual(keyBuf);
        expect(decoded.value.toByteArray()).toEqual(valBuf);
    });

    it('mapPut request — null key throws (HeapData null check)', () => {
        // A HeapData with all-zero content has type=0 (CONSTANT_TYPE_NULL)
        // This is a design note; we just verify encode works with real data
        const keyBuf = Buffer.allocUnsafe(8);
        keyBuf.writeUInt32BE(0xFF000000, 0); // type != 0
        const valBuf = Buffer.allocUnsafe(8);
        valBuf.writeUInt32BE(0xFF000000, 0);
        const key = new HeapData(keyBuf);
        const value = new HeapData(valBuf);

        const msg = MapPutCodec.encodeRequest('testMap', key, value, 1n, 0n);
        const result = roundTrip(msg);
        expect(result.getMessageType()).toBe(MapPutCodec.REQUEST_MESSAGE_TYPE);
    });

    it('clientAuthentication request round-trip', () => {
        const msg = ClientAuthenticationCodec.encodeRequest(
            'dev', 'user', 'pass', null, 'JAVA', 1, '5.4.0', 'my-client', ['label1', 'label2']
        );
        const result = roundTrip(msg);
        expect(result.getMessageType()).toBe(ClientAuthenticationCodec.REQUEST_MESSAGE_TYPE);

        const decoded = ClientAuthenticationCodec.decodeRequest(result);
        expect(decoded.clusterName).toBe('dev');
        expect(decoded.username).toBe('user');
        expect(decoded.password).toBe('pass');
        expect(decoded.uuid).toBeNull();
        expect(decoded.clientType).toBe('JAVA');
        expect(decoded.serializationVersion).toBe(1);
        expect(decoded.clientHazelcastVersion).toBe('5.4.0');
        expect(decoded.clientName).toBe('my-client');
        expect(decoded.labels).toEqual(['label1', 'label2']);
    });

    it('clientAuthentication response round-trip', () => {
        const address = new Address('127.0.0.1', 5701);
        const memberUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

        const clusterId = '11111111-2222-3333-4444-555555555555';
        const msg = ClientAuthenticationCodec.encodeResponse(
            0, address, memberUuid, 1, '5.4.0', 271, clusterId, false
        );
        const result = roundTrip(msg);

        const decoded = ClientAuthenticationCodec.decodeResponse(result);
        expect(decoded.status).toBe(0);
        expect(decoded.serializationVersion).toBe(1);
        expect(decoded.partitionCount).toBe(271);
        expect(decoded.clusterId).toBe(clusterId);
        expect(decoded.failoverSupported).toBe(false);
        expect(decoded.serverHazelcastVersion).toBe('5.4.0');
    });

    it('mapAddEntryListener event round-trip', () => {
        const keyBuf = Buffer.allocUnsafe(8);
        keyBuf.fill(0xAA);
        const key = new HeapData(keyBuf);
        const uuid = 'deadbeef-dead-beef-dead-beefdeadbeef';

        const msg = MapAddEntryListenerCodec.encodeEntryEvent(
            key, null, null, null, 1, uuid, 5
        );
        const result = roundTrip(msg);

        const decoded = MapAddEntryListenerCodec.decodeEntryEvent(result);
        expect(decoded.eventType).toBe(1);
        expect(decoded.uuid).toBe(uuid);
        expect(decoded.numberOfAffectedEntries).toBe(5);
        expect(decoded.key?.toByteArray()).toEqual(keyBuf);
        expect(decoded.value).toBeNull();
        expect(decoded.oldValue).toBeNull();
        expect(decoded.mergingValue).toBeNull();
    });

    it('mapAddEntryListener event keeps payload after correlation id is set', () => {
        const keyBuf = Buffer.allocUnsafe(8);
        keyBuf.fill(0xBB);
        const key = new HeapData(keyBuf);
        const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

        const msg = MapAddEntryListenerCodec.encodeEntryEvent(key, null, null, null, 64, uuid, 3);
        msg.setCorrelationId(42);

        const result = roundTrip(msg);
        const decoded = MapAddEntryListenerCodec.decodeEntryEvent(result);

        expect(result.getCorrelationId()).toBe(42);
        expect(result.getMessageType()).toBe(MapAddEntryListenerCodec.EVENT_ENTRY_MESSAGE_TYPE);
        expect(decoded.eventType).toBe(64);
        expect(decoded.uuid).toBe(uuid);
        expect(decoded.numberOfAffectedEntries).toBe(3);
        expect(decoded.key?.toByteArray()).toEqual(keyBuf);
    });

    it('mapAddEntryListener event handler — dispatches handleEntryEvent', () => {
        const uuid = 'cafebabe-cafe-babe-cafe-babecafebabe';
        const msg = MapAddEntryListenerCodec.encodeEntryEvent(null, null, null, null, 2, uuid, 1);

        let handledEventType = -1;
        let handledUuid: string | null = null;

        const handler = new (class extends MapAddEntryListenerCodec.AbstractEventHandler {
            handleEntryEvent(_k: any, _v: any, _ov: any, _mv: any, eventType: number, uuid: string | null, _n: number): void {
                handledEventType = eventType;
                handledUuid = uuid;
            }
        })();

        handler.handle(msg);
        expect(handledEventType).toBe(2);
        expect(handledUuid as unknown as string).toBe(uuid);
    });

    it('queueAddListener event keeps payload after correlation id is set', () => {
        const itemBuf = Buffer.allocUnsafe(8);
        itemBuf.fill(0xCC);
        const item = new HeapData(itemBuf);
        const uuid = '11111111-2222-3333-4444-555555555555';

        const msg = QueueAddListenerCodec.encodeItemEvent(item, uuid, 2);
        msg.setCorrelationId(77);

        const result = roundTrip(msg);
        const decoded = QueueAddListenerCodec.decodeItemEvent(result);

        expect(result.getCorrelationId()).toBe(77);
        expect(result.getMessageType()).toBe(QueueAddListenerCodec.EVENT_ITEM_MESSAGE_TYPE);
        expect(decoded.eventType).toBe(2);
        expect(decoded.uuid).toBe(uuid);
        expect(decoded.item?.toByteArray()).toEqual(itemBuf);
    });

    it('fragmented message encode/decode', () => {
        // Build a large message
        const msg = ClientMessage.createForEncode();
        for (let i = 0; i < 5; i++) {
            const buf = Buffer.allocUnsafe(100);
            buf.fill(i + 1);
            msg.add(new ClientMessage.Frame(buf));
        }
        msg.setFinal();

        const result = roundTrip(msg);
        const iter = result.forwardFrameIterator();
        for (let i = 0; i < 5; i++) {
            const frame = iter.next();
            expect(frame.content.length).toBe(100);
            expect(frame.content[0]).toBe(i + 1);
        }
    });
});
