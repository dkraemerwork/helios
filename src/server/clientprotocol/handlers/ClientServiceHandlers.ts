/**
 * Block C — Client Service Protocol Handlers
 *
 * Registers handlers for all client-management opcodes required by
 * hazelcast-client@5.6.x:
 *
 *   Client.Ping                    (0x000b00) — heartbeat
 *   Client.CreateProxy             (0x000400) — create distributed object proxy
 *   Client.DestroyProxy            (0x000500) — destroy distributed object proxy
 *   Client.GetDistributedObjects   (0x000800) — list all distributed objects
 *   Client.AddClusterViewListener  (0x000900) — subscribe to topology events
 *   Client.AddPartitionLostListener(0x001600) — subscribe to partition-lost events
 *   Client.Statistics              (0x000c00) — client stats (periodic, no response)
 *   Client.TriggerPartitionAssignment (0x001300) — request partition assignment
 *
 * Each handler: decode → dispatch (or inline logic) → encode response.
 * Handlers are thin — no business logic lives here.
 *
 * Port of Hazelcast {@code ClientEngineImpl} handlers (ClientPingTask,
 * CreateProxyTask, DestroyProxyTask, etc.).
 */

import type { ClientMessage } from '../../../client/impl/protocol/ClientMessage.js';
import { ClientCreateProxyCodec } from '../../../client/impl/protocol/codec/ClientCreateProxyCodec.js';
import { ClientDestroyProxyCodec } from '../../../client/impl/protocol/codec/ClientDestroyProxyCodec.js';
import { ClientGetDistributedObjectsCodec } from '../../../client/impl/protocol/codec/ClientGetDistributedObjectsCodec.js';
import { ListMultiFrameCodec } from '../../../client/impl/protocol/codec/builtin/ListMultiFrameCodec.js';
import { ListUUIDCodec } from '../../../client/impl/protocol/codec/builtin/ListUUIDCodec.js';
import { StringCodec } from '../../../client/impl/protocol/codec/builtin/StringCodec.js';
import { ClientAddClusterViewListenerCodec } from '@zenystx/helios-core/server/clientprotocol/codec/ClientAddClusterViewListenerCodec.js';
import { ClientAddPartitionLostListenerCodec } from '@zenystx/helios-core/server/clientprotocol/codec/ClientAddPartitionLostListenerCodec.js';
import { compactFieldKindFromWire, compactFieldKindToWire, Schema, type SchemaField, type SchemaService } from '@zenystx/helios-core/internal/serialization/compact/SchemaService.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { TopologyPublisher } from '@zenystx/helios-core/server/clientprotocol/TopologyPublisher.js';
import type { ILogger } from '@zenystx/helios-core/test-support/ILogger.js';

// ── Message type constants not covered by existing codecs ─────────────────────

const CLIENT_PING_REQUEST_TYPE           = 0x000b00;
const CLIENT_PING_RESPONSE_TYPE          = 0x000b01;
const CLIENT_STATISTICS_REQUEST_TYPE     = 0x000c00;
const CLIENT_STATISTICS_RESPONSE_TYPE    = 0x000c01;
const CLIENT_SEND_SCHEMA_REQUEST_TYPE    = 0x001300;
const CLIENT_SEND_SCHEMA_RESPONSE_TYPE   = 0x001301;
const CLIENT_FETCH_SCHEMA_REQUEST_TYPE   = 0x001400;
const CLIENT_FETCH_SCHEMA_RESPONSE_TYPE  = 0x001401;
const CLIENT_LOCAL_BACKUP_LISTENER_REQUEST_TYPE  = 0x000f00;
const CLIENT_LOCAL_BACKUP_LISTENER_RESPONSE_TYPE = 0x000f01;

// ── Distributed object registry ───────────────────────────────────────────────

export interface DistributedObjectRecord {
    name: string;
    serviceName: string;
}

/**
 * Simple in-memory registry of created proxies.
 * Production code would persist this to the distributed store.
 */
export class DistributedObjectRegistry {
    private readonly _objects = new Map<string, DistributedObjectRecord>();

    register(name: string, serviceName: string): void {
        this._objects.set(`${serviceName}:${name}`, { name, serviceName });
    }

    unregister(name: string, serviceName: string): void {
        this._objects.delete(`${serviceName}:${name}`);
    }

    getAll(): DistributedObjectRecord[] {
        return Array.from(this._objects.values());
    }
}

// ── Handler registration ──────────────────────────────────────────────────────

export interface ClientServiceHandlersOptions {
    dispatcher: ClientMessageDispatcher;
    topologyPublisher: TopologyPublisher;
    schemaService?: SchemaService;
    localMemberUuid?: string;
    objectRegistry?: DistributedObjectRegistry;
    logger?: ILogger;
}

/**
 * Register all client-service handlers on the given dispatcher.
 * Call this once during server startup.
 */
export function registerClientServiceHandlers(opts: ClientServiceHandlersOptions): void {
    const { dispatcher, topologyPublisher, schemaService, localMemberUuid } = opts;
    const objectRegistry = opts.objectRegistry ?? new DistributedObjectRegistry();

    // ── Ping (0x000b00) ───────────────────────────────────────────────────────
    dispatcher.register(CLIENT_PING_REQUEST_TYPE, async (_msg, _session) => {
        return _encodePingResponse();
    });

    // ── CreateProxy (0x000400) ────────────────────────────────────────────────
    dispatcher.register(ClientCreateProxyCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const { name, serviceName } = ClientCreateProxyCodec.decodeRequest(msg);
        objectRegistry.register(name, serviceName);
        return ClientCreateProxyCodec.encodeResponse();
    });

    // ── DestroyProxy (0x000500) ───────────────────────────────────────────────
    dispatcher.register(ClientDestroyProxyCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const { name, serviceName } = ClientDestroyProxyCodec.decodeRequest(msg);
        objectRegistry.unregister(name, serviceName);
        return ClientDestroyProxyCodec.encodeResponse();
    });

    // ── GetDistributedObjects (0x000800) ──────────────────────────────────────
    dispatcher.register(ClientGetDistributedObjectsCodec.REQUEST_MESSAGE_TYPE, async (_msg, _session) => {
        const objects = objectRegistry.getAll();
        return ClientGetDistributedObjectsCodec.encodeResponse(objects);
    });

    // ── AddClusterViewListener (0x000900) ─────────────────────────────────────
    // Note: The response (ack + initial topology push) is sent by TopologyPublisher
    // directly via session.sendMessage.  We return null here to signal that the
    // response has already been dispatched.
    dispatcher.register(ClientAddClusterViewListenerCodec.REQUEST_MESSAGE_TYPE, async (msg, session) => {
        const correlationId = msg.getCorrelationId();
        topologyPublisher.subscribeToClusterView(session, correlationId);
        return null; // TopologyPublisher already sent the response
    });

    // ── AddPartitionLostListener (0x000b00) ───────────────────────────────────
    dispatcher.register(ClientAddPartitionLostListenerCodec.REQUEST_MESSAGE_TYPE, async (msg, session) => {
        const { localOnly } = ClientAddPartitionLostListenerCodec.decodeRequest(msg);
        const correlationId = msg.getCorrelationId();
        topologyPublisher.subscribeToPartitionLost(session, localOnly, correlationId);
        return null; // TopologyPublisher already sent the response + registration ID
    });

    // ── Statistics (0x000c00) ─────────────────────────────────────────────────
    // Client sends stats periodically; server acknowledges with an empty response.
    dispatcher.register(CLIENT_STATISTICS_REQUEST_TYPE, async (_msg, _session) => {
        return _encodeStatisticsResponse();
    });

    if (schemaService) {
        dispatcher.register(CLIENT_SEND_SCHEMA_REQUEST_TYPE, async (msg, _session) => {
            schemaService.registerSchema(_decodeSchemaRequest(msg));
            return _encodeSendSchemaResponse(localMemberUuid ?? null);
        });

        dispatcher.register(CLIENT_FETCH_SCHEMA_REQUEST_TYPE, async (msg, _session) => {
            const schemaId = _decodeFetchSchemaRequest(msg);
            return _encodeFetchSchemaResponse(schemaService.getSchema(schemaId) ?? null);
        });
    }

    // ── LocalBackupListener (0x000f00) ───────────────────────────────────────
    // The official client registers a backup listener during startup.
    // The server responds with a registration UUID.  We don't need to
    // implement actual backup events for a single-member cluster, but
    // we must accept the registration so the client starts cleanly.
    dispatcher.register(CLIENT_LOCAL_BACKUP_LISTENER_REQUEST_TYPE, async (_msg, _session) => {
        return _encodeLocalBackupListenerResponse();
    });
}

// ── Inline response encoders ──────────────────────────────────────────────────

import { ClientMessage as CM } from '../../../client/impl/protocol/ClientMessage.js';
import { FixedSizeTypesCodec, INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, UUID_SIZE_IN_BYTES, BYTE_SIZE_IN_BYTES } from '../../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';

/** Standard response initial frame: type(4) + correlationId(8) + backupAcks/partitionId(4) = 16. */
const RESPONSE_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES; // 16

function _encodePingResponse(): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(CLIENT_PING_RESPONSE_TYPE >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}

function _encodeStatisticsResponse(): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(CLIENT_STATISTICS_RESPONSE_TYPE >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}

function _encodeSendSchemaResponse(localMemberUuid: string | null): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(CLIENT_SEND_SCHEMA_RESPONSE_TYPE >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    ListUUIDCodec.encode(msg, localMemberUuid === null ? [] : [localMemberUuid]);
    msg.setFinal();
    return msg;
}

function _encodeFetchSchemaResponse(schema: Schema | null): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(CLIENT_FETCH_SCHEMA_RESPONSE_TYPE >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    if (schema === null) {
        msg.add(CM.Frame.createStaticFrame(CM.IS_NULL_FLAG));
    } else {
        _encodeSchema(msg, schema);
    }
    msg.setFinal();
    return msg;
}

/**
 * Encode the response for ClientLocalBackupListener (0x000f01).
 *
 * Response initial frame layout:
 *   [0..3]   type = 0x000f01
 *   [4..11]  correlationId (set by caller)
 *   [12]     backupAcks (byte, 0)
 *   [13..29] registrationUUID (17 bytes: isNull(1) + msb(8) + lsb(8))
 *
 * Total: 30 bytes.
 */
const BACKUP_LISTENER_RESPONSE_UUID_OFFSET = 13; // RESPONSE_BACKUP_ACKS_OFFSET(12) + BYTE_SIZE(1)
const BACKUP_LISTENER_RESPONSE_SIZE = BACKUP_LISTENER_RESPONSE_UUID_OFFSET + UUID_SIZE_IN_BYTES; // 13 + 17 = 30

function _encodeLocalBackupListenerResponse(): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(BACKUP_LISTENER_RESPONSE_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(CLIENT_LOCAL_BACKUP_LISTENER_RESPONSE_TYPE >>> 0, 0);
    FixedSizeTypesCodec.encodeUUID(buf, BACKUP_LISTENER_RESPONSE_UUID_OFFSET, crypto.randomUUID());
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}

function _decodeFetchSchemaRequest(msg: ClientMessage): bigint {
    return FixedSizeTypesCodec.decodeLong(msg.getStartFrame().content, RESPONSE_HEADER_SIZE);
}

function _decodeSchemaRequest(msg: ClientMessage): Schema {
    const iterator = msg.forwardFrameIterator();
    iterator.next();
    iterator.next();
    const typeName = StringCodec.decode(iterator);
    const fields = ListMultiFrameCodec.decode(iterator, _decodeFieldDescriptor);
    iterator.next();
    return new Schema(typeName, fields);
}

function _encodeSchema(msg: ClientMessage, schema: Schema): void {
    msg.add(CM.Frame.createStaticFrame(CM.BEGIN_DATA_STRUCTURE_FLAG));
    StringCodec.encode(msg, schema.typeName);
    ListMultiFrameCodec.encode(msg, [...schema.fields], _encodeFieldDescriptor);
    msg.add(CM.Frame.createStaticFrame(CM.END_DATA_STRUCTURE_FLAG));
}

function _encodeFieldDescriptor(msg: ClientMessage, field: SchemaField): void {
    msg.add(CM.Frame.createStaticFrame(CM.BEGIN_DATA_STRUCTURE_FLAG));
    const buf = Buffer.allocUnsafe(INT_SIZE_IN_BYTES);
    FixedSizeTypesCodec.encodeInt(buf, 0, compactFieldKindToWire(field.kind));
    msg.add(new CM.Frame(buf));
    StringCodec.encode(msg, field.fieldName);
    msg.add(CM.Frame.createStaticFrame(CM.END_DATA_STRUCTURE_FLAG));
}

function _decodeFieldDescriptor(iterator: ClientMessage.ForwardFrameIterator): SchemaField {
    iterator.next();
    const initialFrame = iterator.next();
    const kind = compactFieldKindFromWire(FixedSizeTypesCodec.decodeInt(initialFrame.content, 0));
    const fieldName = StringCodec.decode(iterator);
    iterator.next();
    return { fieldName, kind };
}
