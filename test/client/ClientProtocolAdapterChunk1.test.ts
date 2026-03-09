import { ClientMessage, ClientMessageFrame } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { MapAddEntryListenerCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapAddEntryListenerCodec';
import { MapClearCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapClearCodec';
import { MapGetEntryViewCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapGetEntryViewCodec.js';
import { MapPutCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapPutCodec';
import { QueueAddListenerCodec } from '@zenystx/helios-core/client/impl/protocol/codec/QueueAddListenerCodec.js';
import { QueueOfferCodec } from '@zenystx/helios-core/client/impl/protocol/codec/QueueOfferCodec';
import { QueuePollCodec } from '@zenystx/helios-core/client/impl/protocol/codec/QueuePollCodec';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { SerializationConfig } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { afterEach, describe, expect, test } from 'bun:test';

class TestClientSession {
    readonly events: ClientMessage[] = [];

    constructor(private readonly _sessionId: string) {}

    isAuthenticated(): boolean { return true; }
    getSessionId(): string { return this._sessionId; }
    pushEvent(message: ClientMessage): boolean { this.events.push(message); return true; }
    sendMessage(message: ClientMessage): boolean { this.events.push(message); return true; }
}

function buildStringRequest(messageType: number, correlationId: number, value: string): ClientMessage {
    const msg = ClientMessage.createForEncode();
    const frame = Buffer.allocUnsafe(16);
    frame.fill(0);
    frame.writeUInt32LE(messageType >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
    msg.add(new ClientMessageFrame(frame));
    msg.setCorrelationId(correlationId);
    msg.setPartitionId(-1);
    StringCodec.encode(msg, value);
    msg.setFinal();
    return msg;
}

function decodeStringResponse(message: ClientMessage): string {
    const iterator = message.forwardFrameIterator();
    iterator.next();
    return StringCodec.decode(iterator);
}

function decodeBooleanResponse(message: ClientMessage): boolean {
    return message.getStartFrame().content.readUInt8(16) !== 0;
}

describe('client protocol adapter chunk 1', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(() => {
        while (instances.length > 0) {
            instances.pop()!.shutdown();
        }
    });

    test('Map.GetEntryView returns encoded entry metadata', async () => {
        const config = new HeliosConfig('chunk1-entry-view');
        config.setClusterName('chunk1-entry-view');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('map-entry-view') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const keyData = ss.toData('k1')!;
            const valueData = ss.toData('v1')!;

            const putRequest = MapPutCodec.encodeRequest('entry-view-map', keyData, valueData, 0n, -1n);
            putRequest.setCorrelationId(1);
            putRequest.setPartitionId(0);
            await dispatcher.dispatch(putRequest, session);

            const entryViewRequest = MapGetEntryViewCodec.encodeRequest('entry-view-map', keyData, 0n);
            entryViewRequest.setCorrelationId(2);
            entryViewRequest.setPartitionId(0);
            const response = await dispatcher.dispatch(entryViewRequest, session);

            expect(response).not.toBeNull();
            const decoded = MapGetEntryViewCodec.decodeResponse(response!);
            expect(decoded.response).not.toBeNull();
            expect(ss.toObject(decoded.response!.getKey()) as string).toBe('k1');
            expect(ss.toObject(decoded.response!.getValue()) as string).toBe('v1');
            expect(decoded.response!.getHits()).toBeGreaterThanOrEqual(1);
            expect(decoded.maxIdle).toBe(BigInt(-1));
        } finally {
            ss.destroy();
        }
    });

    test('map entry listener add and remove works through the dispatcher', async () => {
        const config = new HeliosConfig('chunk1-map-listener');
        config.setClusterName('chunk1-map-listener');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('map-listener') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const memberUuid = instance.getCluster().getLocalMember().getUuid();
            const addRequest = MapAddEntryListenerCodec.encodeRequest('listener-map', 0, false);
            addRequest.setCorrelationId(10);
            addRequest.setPartitionId(-1);
            const addResponse = await dispatcher.dispatch(addRequest, session);
            const registrationId = decodeStringResponse(addResponse!);

            const keyData = ss.toData('k1')!;
            const valueData = ss.toData('v1')!;
            const putRequest = MapPutCodec.encodeRequest('listener-map', keyData, valueData, 0n, -1n);
            putRequest.setCorrelationId(11);
            putRequest.setPartitionId(0);
            await dispatcher.dispatch(putRequest, session);

            expect(session.events).toHaveLength(1);
            expect(session.events[0].getMessageType()).toBe(MapAddEntryListenerCodec.EVENT_ENTRY_MESSAGE_TYPE);
            expect(session.events[0].getCorrelationId()).toBe(10);
            const event = MapAddEntryListenerCodec.decodeEntryEvent(session.events[0]);
            expect(ss.toObject(event.key!) as string).toBe('k1');
            expect(ss.toObject(event.value!) as string).toBe('v1');
            expect(event.eventType).toBe(1);
            expect(event.uuid).toBe(memberUuid);

            session.events.length = 0;
            const clearRequest = MapClearCodec.encodeRequest('listener-map');
            clearRequest.setCorrelationId(14);
            clearRequest.setPartitionId(-1);
            await dispatcher.dispatch(clearRequest, session);

            expect(session.events).toHaveLength(1);
            expect(session.events[0].getMessageType()).toBe(MapAddEntryListenerCodec.EVENT_ENTRY_MESSAGE_TYPE);
            expect(session.events[0].getCorrelationId()).toBe(10);
            const clearEvent = MapAddEntryListenerCodec.decodeEntryEvent(session.events[0]);
            expect(clearEvent.eventType).toBe(64);
            expect(clearEvent.uuid).toBe(memberUuid);
            expect(clearEvent.numberOfAffectedEntries).toBe(1);

            const removeRequest = buildStringRequest(0x011a00, 12, registrationId);
            const removeResponse = await dispatcher.dispatch(removeRequest, session);
            expect(decodeBooleanResponse(removeResponse!)).toBe(true);

            session.events.length = 0;
            const secondPutRequest = MapPutCodec.encodeRequest('listener-map', keyData, ss.toData('v2')!, 0n, -1n);
            secondPutRequest.setCorrelationId(15);
            secondPutRequest.setPartitionId(0);
            await dispatcher.dispatch(secondPutRequest, session);
            expect(session.events).toHaveLength(0);
        } finally {
            ss.destroy();
        }
    });

    test('queue item listener add and remove works through the dispatcher', async () => {
        const config = new HeliosConfig('chunk1-queue-listener');
        config.setClusterName('chunk1-queue-listener');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('queue-listener') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const memberUuid = instance.getCluster().getLocalMember().getUuid();
            const addRequest = QueueAddListenerCodec.encodeRequest('listener-queue', true, false);
            addRequest.setCorrelationId(20);
            addRequest.setPartitionId(-1);
            const addResponse = await dispatcher.dispatch(addRequest, session);
            const registrationId = decodeStringResponse(addResponse!);

            const offerRequest = QueueOfferCodec.encodeRequest('listener-queue', ss.toData('q1')!, 0n);
            offerRequest.setCorrelationId(21);
            offerRequest.setPartitionId(0);
            await dispatcher.dispatch(offerRequest, session);

            expect(session.events).toHaveLength(1);
            expect(session.events[0].getMessageType()).toBe(QueueAddListenerCodec.EVENT_ITEM_MESSAGE_TYPE);
            expect(session.events[0].getCorrelationId()).toBe(20);
            const event = QueueAddListenerCodec.decodeItemEvent(session.events[0]);
            expect(ss.toObject(event.item!) as string).toBe('q1');
            expect(event.eventType).toBe(1);
            expect(event.uuid).toBe(memberUuid);

            session.events.length = 0;
            const pollRequest = QueuePollCodec.encodeRequest('listener-queue', 0n);
            pollRequest.setCorrelationId(24);
            pollRequest.setPartitionId(0);
            await dispatcher.dispatch(pollRequest, session);

            expect(session.events).toHaveLength(1);
            expect(session.events[0].getMessageType()).toBe(QueueAddListenerCodec.EVENT_ITEM_MESSAGE_TYPE);
            expect(session.events[0].getCorrelationId()).toBe(20);
            const removedEvent = QueueAddListenerCodec.decodeItemEvent(session.events[0]);
            expect(ss.toObject(removedEvent.item!) as string).toBe('q1');
            expect(removedEvent.eventType).toBe(2);
            expect(removedEvent.uuid).toBe(memberUuid);

            const removeRequest = buildStringRequest(0x031400, 22, registrationId);
            const removeResponse = await dispatcher.dispatch(removeRequest, session);
            expect(decodeBooleanResponse(removeResponse!)).toBe(true);

            session.events.length = 0;
            const secondOfferRequest = QueueOfferCodec.encodeRequest('listener-queue', ss.toData('q2')!, 0n);
            secondOfferRequest.setCorrelationId(23);
            secondOfferRequest.setPartitionId(0);
            await dispatcher.dispatch(secondOfferRequest, session);
            expect(session.events).toHaveLength(0);
        } finally {
            ss.destroy();
        }
    });
});
