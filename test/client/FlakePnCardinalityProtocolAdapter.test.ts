import { ClientMessage, ClientMessageFrame } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import {
    BOOLEAN_SIZE_IN_BYTES,
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

const CE_ADD_REQUEST = 0x1b0100;
const CE_ESTIMATE_REQUEST = 0x1b0200;
const PN_GET_REQUEST = 0x1d0100;
const PN_ADD_REQUEST = 0x1d0200;
const PN_GET_CONFIGURED_REPLICA_COUNT_REQUEST = 0x1d0300;
const FLAKE_NEW_ID_BATCH_REQUEST = 0x1e0100;

const INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
const RESPONSE_VALUE_OFFSET = INITIAL_FRAME_SIZE;

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

function buildFlakeNewIdBatchRequest(correlationId: number, name: string, batchSize: number): ClientMessage {
    const { msg, frame } = createRequest(FLAKE_NEW_ID_BATCH_REQUEST, correlationId, INT_SIZE_IN_BYTES);
    frame.writeInt32LE(batchSize, INITIAL_FRAME_SIZE);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function encodeReplicaTimestamps(msg: ClientMessage, replicaTimestamps: Array<[string, bigint]>): void {
    msg.add(new ClientMessageFrame(Buffer.alloc(0), ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));
    for (const [replicaId, timestamp] of replicaTimestamps) {
        msg.add(new ClientMessageFrame(Buffer.from(replicaId, 'utf8')));
        const timestampFrame = Buffer.alloc(LONG_SIZE_IN_BYTES);
        timestampFrame.writeBigInt64LE(timestamp, 0);
        msg.add(new ClientMessageFrame(timestampFrame));
    }
    msg.add(new ClientMessageFrame(Buffer.alloc(0), ClientMessage.END_DATA_STRUCTURE_FLAG));
}

function buildPnGetRequest(correlationId: number, name: string, replicaTimestamps: Array<[string, bigint]> = []): ClientMessage {
    const { msg, frame } = createRequest(PN_GET_REQUEST, correlationId, UUID_SIZE_IN_BYTES);
    FixedSizeTypesCodec.encodeUUID(frame, INITIAL_FRAME_SIZE, null);
    StringCodec.encode(msg, name);
    encodeReplicaTimestamps(msg, replicaTimestamps);
    msg.setFinal();
    return msg;
}

function buildPnAddRequest(
    correlationId: number,
    name: string,
    delta: bigint,
    getBeforeUpdate: boolean,
    replicaTimestamps: Array<[string, bigint]> = [],
): ClientMessage {
    const { msg, frame } = createRequest(
        PN_ADD_REQUEST,
        correlationId,
        LONG_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES + UUID_SIZE_IN_BYTES,
    );
    let offset = INITIAL_FRAME_SIZE;
    frame.writeBigInt64LE(delta, offset);
    offset += LONG_SIZE_IN_BYTES;
    frame.writeUInt8(getBeforeUpdate ? 1 : 0, offset);
    offset += BOOLEAN_SIZE_IN_BYTES;
    FixedSizeTypesCodec.encodeUUID(frame, offset, null);
    StringCodec.encode(msg, name);
    encodeReplicaTimestamps(msg, replicaTimestamps);
    msg.setFinal();
    return msg;
}

function buildCardinalityAddRequest(correlationId: number, name: string, item: Data): ClientMessage {
    const { msg } = createRequest(CE_ADD_REQUEST, correlationId);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, item);
    msg.setFinal();
    return msg;
}

function buildNameRequest(messageType: number, correlationId: number, name: string): ClientMessage {
    const { msg } = createRequest(messageType, correlationId);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function decodeIntResponse(message: ClientMessage): number {
    return message.getStartFrame().content.readInt32LE(RESPONSE_VALUE_OFFSET);
}

function decodeLongResponse(message: ClientMessage): bigint {
    return message.getStartFrame().content.readBigInt64LE(RESPONSE_VALUE_OFFSET);
}

function decodePnValueResponse(message: ClientMessage): { value: bigint; replicaTimestamps: Array<[string, bigint]> } {
    const value = decodeLongResponse(message);
    const iterator = message.forwardFrameIterator();
    iterator.next();

    const replicaTimestamps: Array<[string, bigint]> = [];
    if (!iterator.hasNext()) {
        return { value, replicaTimestamps };
    }

    let frame = iterator.next();
    if ((frame.flags & ClientMessage.BEGIN_DATA_STRUCTURE_FLAG) === 0) {
        return { value, replicaTimestamps };
    }

    while (iterator.hasNext()) {
        frame = iterator.next();
        if ((frame.flags & ClientMessage.END_DATA_STRUCTURE_FLAG) !== 0) {
            break;
        }

        const replicaId = frame.content.toString('utf8');
        const timestampFrame = iterator.next();
        if ((timestampFrame.flags & ClientMessage.END_DATA_STRUCTURE_FLAG) !== 0) {
            break;
        }
        replicaTimestamps.push([replicaId, timestampFrame.content.readBigInt64LE(0)]);
    }

    return { value, replicaTimestamps };
}

function decodeFlakeBatchResponse(message: ClientMessage): { base: bigint; increment: bigint; batchSize: number } {
    const frame = message.getStartFrame().content;
    return {
        base: frame.readBigInt64LE(RESPONSE_VALUE_OFFSET),
        increment: frame.readBigInt64LE(RESPONSE_VALUE_OFFSET + LONG_SIZE_IN_BYTES),
        batchSize: frame.readInt32LE(RESPONSE_VALUE_OFFSET + (LONG_SIZE_IN_BYTES * 2)),
    };
}

describe('flake/pn/cardinality protocol adapter', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(() => {
        while (instances.length > 0) {
            instances.pop()!.shutdown();
        }
    });

    test('dispatches flake id batch requests through the flake id service', async () => {
        const config = new HeliosConfig('flake-protocol');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('flake-protocol') as any;

        const first = decodeFlakeBatchResponse((await dispatcher.dispatch(buildFlakeNewIdBatchRequest(1, 'flake', 3), session))!);
        const second = decodeFlakeBatchResponse((await dispatcher.dispatch(buildFlakeNewIdBatchRequest(2, 'flake', 2), session))!);

        expect(first.batchSize).toBe(3);
        expect(first.increment).toBe(1n);
        expect(second.batchSize).toBe(2);
        expect(second.base).toBe(first.base + 3n);
    });

    test('dispatches pn counter operations through the pn counter service', async () => {
        const config = new HeliosConfig('pn-protocol');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('pn-protocol') as any;

        const firstAdd = decodePnValueResponse((await dispatcher.dispatch(buildPnAddRequest(1, 'counter', 5n, false), session))!);
        const secondAdd = decodePnValueResponse((await dispatcher.dispatch(buildPnAddRequest(2, 'counter', 2n, true, firstAdd.replicaTimestamps), session))!);
        const get = decodePnValueResponse((await dispatcher.dispatch(buildPnGetRequest(3, 'counter', secondAdd.replicaTimestamps), session))!);

        expect(firstAdd.value).toBe(5n);
        expect(firstAdd.replicaTimestamps).toEqual([[instance.getLocalMemberId(), 1n]]);
        expect(secondAdd.value).toBe(5n);
        expect(secondAdd.replicaTimestamps).toEqual([[instance.getLocalMemberId(), 2n]]);
        expect(get.value).toBe(7n);
        expect(decodeIntResponse((await dispatcher.dispatch(buildNameRequest(PN_GET_CONFIGURED_REPLICA_COUNT_REQUEST, 4, 'counter'), session))!)).toBe(3);
    });

    test('dispatches cardinality estimator operations through the estimator service', async () => {
        const config = new HeliosConfig('cardinality-protocol');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('cardinality-protocol') as any;
        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            await dispatcher.dispatch(buildCardinalityAddRequest(1, 'cardinality', ss.toData('alpha')!), session);
            await dispatcher.dispatch(buildCardinalityAddRequest(2, 'cardinality', ss.toData('beta')!), session);
            await dispatcher.dispatch(buildCardinalityAddRequest(3, 'cardinality', ss.toData('alpha')!), session);

            expect(decodeLongResponse((await dispatcher.dispatch(buildNameRequest(CE_ESTIMATE_REQUEST, 4, 'cardinality'), session))!)).toBe(2n);
        } finally {
            ss.destroy();
        }
    });

    test('returns real public sql and cp service accessors', () => {
        const config = new HeliosConfig('public-accessors');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const sql = instance.getSql();
        const cpSubsystem = instance.getCPSubsystem();

        expect(sql).toBe(instance.getSql());
        expect(sql.getActiveQueryIds()).toEqual([]);
        expect(cpSubsystem).toBe(instance.getCPSubsystem());
        expect(cpSubsystem.listGroups()).toEqual([]);
        expect(cpSubsystem.getOrCreateGroup('default').leader).toBe(instance.getLocalMemberId());
    });
});
