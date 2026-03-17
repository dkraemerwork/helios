/**
 * Block C — Client Service Protocol Handlers
 *
 * Registers handlers for all client-management opcodes required by
 * hazelcast-client@5.6.x:
 *
 *   Client.Ping                           (0x000b00) — heartbeat
 *   Client.CreateProxy                    (0x000400) — create distributed object proxy
 *   Client.DestroyProxy                   (0x000500) — destroy distributed object proxy
 *   Client.GetDistributedObjects          (0x000800) — list all distributed objects
 *   Client.AddDistributedObjectListener   (0x000900) — subscribe to proxy create/destroy events
 *   Client.RemoveDistributedObjectListener(0x000a00) — unsubscribe from proxy events
 *   Client.AddClusterViewListener         (0x000300) — subscribe to topology events
 *   Client.AddPartitionLostListener       (0x001600) — subscribe to partition-lost events
 *   Client.Statistics                     (0x000c00) — client stats (periodic, no response)
 *   Client.CreateProxies                  (0x000e00) — batch proxy creation
 *   Client.SendSchema                     (0x001300) — register compact schema
 *   Client.FetchSchema                    (0x001400) — fetch compact schema by id
 *   Client.SendAllSchemas                 (0x001500) — batch schema registration
 *   Client.LocalBackupListener            (0x000f00) — register backup listener
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
import { EntryListCodec } from '../../../client/impl/protocol/codec/builtin/EntryListCodec.js';
import { ListMultiFrameCodec } from '../../../client/impl/protocol/codec/builtin/ListMultiFrameCodec.js';
import { ListUUIDCodec } from '../../../client/impl/protocol/codec/builtin/ListUUIDCodec.js';
import { StringCodec } from '../../../client/impl/protocol/codec/builtin/StringCodec.js';
import { ClientAddClusterViewListenerCodec } from '@zenystx/helios-core/server/clientprotocol/codec/ClientAddClusterViewListenerCodec.js';
import { ClientAddPartitionLostListenerCodec } from '@zenystx/helios-core/server/clientprotocol/codec/ClientAddPartitionLostListenerCodec.js';
import { compactFieldKindFromWire, compactFieldKindToWire, Schema, type SchemaField, type SchemaService } from '@zenystx/helios-core/internal/serialization/compact/SchemaService.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { TopologyPublisher } from '@zenystx/helios-core/server/clientprotocol/TopologyPublisher.js';
import type { ILogger } from '@zenystx/helios-core/logging/Logger.js';

// ── Message type constants not covered by existing codecs ─────────────────────

const CLIENT_PING_REQUEST_TYPE                            = 0x000b00;
const CLIENT_PING_RESPONSE_TYPE                           = 0x000b01;
const CLIENT_STATISTICS_REQUEST_TYPE                      = 0x000c00;
const CLIENT_STATISTICS_RESPONSE_TYPE                     = 0x000c01;
const CLIENT_SEND_SCHEMA_REQUEST_TYPE                     = 0x001300;
const CLIENT_SEND_SCHEMA_RESPONSE_TYPE                    = 0x001301;
const CLIENT_FETCH_SCHEMA_REQUEST_TYPE                    = 0x001400;
const CLIENT_FETCH_SCHEMA_RESPONSE_TYPE                   = 0x001401;
const CLIENT_SEND_ALL_SCHEMAS_REQUEST_TYPE                = 0x001500;
const CLIENT_SEND_ALL_SCHEMAS_RESPONSE_TYPE               = 0x001501;
const CLIENT_ADD_DISTRIBUTED_OBJECT_LISTENER_REQUEST_TYPE = 0x000900;
const CLIENT_ADD_DISTRIBUTED_OBJECT_LISTENER_EVENT_TYPE   = 0x000902;
const CLIENT_REMOVE_DISTRIBUTED_OBJECT_LISTENER_REQUEST_TYPE = 0x000a00;
const CLIENT_REMOVE_DISTRIBUTED_OBJECT_LISTENER_RESPONSE_TYPE = 0x000a01;
const CLIENT_CREATE_PROXIES_REQUEST_TYPE                  = 0x000e00;
const CLIENT_CREATE_PROXIES_RESPONSE_TYPE                 = 0x000e01;
const CLIENT_LOCAL_BACKUP_LISTENER_REQUEST_TYPE           = 0x000f00;
const CLIENT_LOCAL_BACKUP_LISTENER_RESPONSE_TYPE          = 0x000f01;

// ── Distributed object registry ───────────────────────────────────────────────

export interface DistributedObjectRecord {
    name: string;
    serviceName: string;
}

export type DistributedObjectEventType = 'CREATED' | 'DESTROYED';

export interface DistributedObjectListenerEntry {
    readonly registrationId: string;
    readonly correlationId: number;
    readonly session: import('@zenystx/helios-core/server/clientprotocol/ClientSession.js').ClientSession;
}

/**
 * Simple in-memory registry of created proxies.
 * Also manages distributed-object listeners so that interested clients
 * receive events whenever a proxy is created or destroyed.
 * Production code would persist objects to the distributed store.
 */
export class DistributedObjectRegistry {
    private readonly _objects = new Map<string, DistributedObjectRecord>();
    private readonly _listeners = new Map<string, DistributedObjectListenerEntry>();

    register(name: string, serviceName: string): void {
        this._objects.set(`${serviceName}:${name}`, { name, serviceName });
    }

    unregister(name: string, serviceName: string): void {
        this._objects.delete(`${serviceName}:${name}`);
    }

    getAll(): DistributedObjectRecord[] {
        return Array.from(this._objects.values());
    }

    addListener(entry: DistributedObjectListenerEntry): void {
        this._listeners.set(entry.registrationId, entry);
    }

    removeListener(registrationId: string): boolean {
        return this._listeners.delete(registrationId);
    }

    getListeners(): DistributedObjectListenerEntry[] {
        return Array.from(this._listeners.values());
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
        _fireDistributedObjectEvent(objectRegistry, name, serviceName, 'CREATED', localMemberUuid ?? null);
        return ClientCreateProxyCodec.encodeResponse();
    });

    // ── DestroyProxy (0x000500) ───────────────────────────────────────────────
    dispatcher.register(ClientDestroyProxyCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const { name, serviceName } = ClientDestroyProxyCodec.decodeRequest(msg);
        objectRegistry.unregister(name, serviceName);
        _fireDistributedObjectEvent(objectRegistry, name, serviceName, 'DESTROYED', localMemberUuid ?? null);
        return ClientDestroyProxyCodec.encodeResponse();
    });

    // ── GetDistributedObjects (0x000800) ──────────────────────────────────────
    dispatcher.register(ClientGetDistributedObjectsCodec.REQUEST_MESSAGE_TYPE, async (_msg, _session) => {
        const objects = objectRegistry.getAll();
        return ClientGetDistributedObjectsCodec.encodeResponse(objects);
    });

    // ── AddDistributedObjectListener (0x000900) ───────────────────────────────
    // Client subscribes to proxy creation/destruction events.
    // We store the registration and return a UUID that can later be used to
    // unsubscribe via RemoveDistributedObjectListener.
    dispatcher.register(CLIENT_ADD_DISTRIBUTED_OBJECT_LISTENER_REQUEST_TYPE, async (msg, session) => {
        const registrationId = crypto.randomUUID();
        const correlationId = msg.getCorrelationId();
        objectRegistry.addListener({ registrationId, correlationId, session });
        return _encodeAddDistributedObjectListenerResponse(registrationId);
    });

    // ── RemoveDistributedObjectListener (0x000a00) ────────────────────────────
    // Client unsubscribes from proxy events by the UUID returned above.
    dispatcher.register(CLIENT_REMOVE_DISTRIBUTED_OBJECT_LISTENER_REQUEST_TYPE, async (msg, _session) => {
        const registrationId = _decodeRemoveDistributedObjectListenerRequest(msg);
        const removed = objectRegistry.removeListener(registrationId);
        return _encodeRemoveDistributedObjectListenerResponse(removed);
    });

    // ── AddClusterViewListener (0x000300) ─────────────────────────────────────
    // Note: The response (ack + initial topology push) is sent by TopologyPublisher
    // directly via session.sendMessage.  We return null here to signal that the
    // response has already been dispatched.
    dispatcher.register(ClientAddClusterViewListenerCodec.REQUEST_MESSAGE_TYPE, async (msg, session) => {
        const correlationId = msg.getCorrelationId();
        topologyPublisher.subscribeToClusterView(session, correlationId);
        return null; // TopologyPublisher already sent the response
    });

    // ── AddPartitionLostListener (0x001600) ───────────────────────────────────
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

    // ── CreateProxies (0x000e00) — batch proxy creation ───────────────────────
    // Decodes a list of (name, serviceName) pairs and registers each proxy.
    dispatcher.register(CLIENT_CREATE_PROXIES_REQUEST_TYPE, async (msg, _session) => {
        const proxies = _decodeCreateProxiesRequest(msg);
        for (const [name, serviceName] of proxies) {
            objectRegistry.register(name, serviceName);
            _fireDistributedObjectEvent(objectRegistry, name, serviceName, 'CREATED', localMemberUuid ?? null);
        }
        return _encodeCreateProxiesResponse();
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

        // ── SendAllSchemas (0x001500) — batch schema registration ─────────────
        // Client sends all its compact schemas at once (e.g. on reconnect).
        dispatcher.register(CLIENT_SEND_ALL_SCHEMAS_REQUEST_TYPE, async (msg, _session) => {
            const schemas = _decodeAllSchemasRequest(msg);
            for (const schema of schemas) {
                schemaService.registerSchema(schema);
            }
            return _encodeSendAllSchemasResponse();
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
import { FixedSizeTypesCodec, BOOLEAN_SIZE_IN_BYTES, INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, UUID_SIZE_IN_BYTES, BYTE_SIZE_IN_BYTES } from '../../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';

/** Request initial frame header: type(4) + correlationId(8) + partitionId(4) = 16 */
const RH = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES; // 16
/** Response initial frame header: type(4) + correlationId(8) + backupAcks(1) = 13 */
const RESP_H = CM.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + BYTE_SIZE_IN_BYTES; // 13

function _encodePingResponse(): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESP_H);
    buf.fill(0);
    buf.writeUInt32LE(CLIENT_PING_RESPONSE_TYPE >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}

function _encodeStatisticsResponse(): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESP_H);
    buf.fill(0);
    buf.writeUInt32LE(CLIENT_STATISTICS_RESPONSE_TYPE >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}

function _encodeSendSchemaResponse(localMemberUuid: string | null): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESP_H);
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
    const buf = Buffer.allocUnsafe(RESP_H);
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
    return FixedSizeTypesCodec.decodeLong(msg.getStartFrame().content, RH);
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

// ── AddDistributedObjectListener response encoder ─────────────────────────────
//
// Response initial frame layout (0x000901):
//   [0..3]    type = 0x000901
//   [4..11]   correlationId (set by caller)
//   [12]      backupAcks (byte, 0)
//   [13..29]  response UUID  (17 bytes: isNull(1) + msb(8) + lsb(8))
//
// Total: 30 bytes.  (RESP_H = 13, UUID starts at offset 13)

const ADD_DOL_RESPONSE_UUID_OFFSET = RESP_H; // 13 (type(4) + correlationId(8) + backupAcks(1))
const ADD_DOL_RESPONSE_SIZE        = ADD_DOL_RESPONSE_UUID_OFFSET + UUID_SIZE_IN_BYTES; // 30

function _encodeAddDistributedObjectListenerResponse(registrationId: string): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(ADD_DOL_RESPONSE_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(0x000901 >>> 0, 0);
    FixedSizeTypesCodec.encodeUUID(buf, ADD_DOL_RESPONSE_UUID_OFFSET, registrationId);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}

// ── AddDistributedObjectListener event encoder ────────────────────────────────
//
// Event frame layout (0x000902):
//   [0..3]   type = 0x000902
//   [4..11]  correlationId (filled from listener registration correlation id)
//   [12..15] partitionId (int32)
//   [16..32] source UUID  (17 bytes)
//
// Then variable frames:
//   name        (StringCodec)
//   serviceName (StringCodec)
//   eventType   (StringCodec)  — "CREATED" or "DESTROYED"

const DOL_EVENT_SOURCE_UUID_OFFSET = RH; // 16 (events use request-style header with partitionId)

function _encodeDistributedObjectEvent(
    name: string,
    serviceName: string,
    eventType: DistributedObjectEventType,
    sourceUuid: string | null,
    correlationId: number,
): ClientMessage {
    const initialFrameSize = DOL_EVENT_SOURCE_UUID_OFFSET + UUID_SIZE_IN_BYTES; // 33
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(initialFrameSize);
    buf.fill(0);
    buf.writeUInt32LE(CLIENT_ADD_DISTRIBUTED_OBJECT_LISTENER_EVENT_TYPE >>> 0, 0);
    FixedSizeTypesCodec.encodeUUID(buf, DOL_EVENT_SOURCE_UUID_OFFSET, sourceUuid);
    const EVENT_FLAGS = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG | CM.IS_EVENT_FLAG;
    msg.add(new CM.Frame(buf, EVENT_FLAGS));
    msg.setCorrelationId(correlationId);
    StringCodec.encode(msg, name);
    StringCodec.encode(msg, serviceName);
    StringCodec.encode(msg, eventType);
    msg.setFinal();
    return msg;
}

/**
 * Fire a distributed-object event to all registered listeners.
 * Called whenever a proxy is created or destroyed.
 */
function _fireDistributedObjectEvent(
    registry: DistributedObjectRegistry,
    name: string,
    serviceName: string,
    eventType: DistributedObjectEventType,
    sourceUuid: string | null,
): void {
    for (const listener of registry.getListeners()) {
        const event = _encodeDistributedObjectEvent(
            name,
            serviceName,
            eventType,
            sourceUuid,
            listener.correlationId,
        );
        listener.session.sendMessage(event);
    }
}

// ── RemoveDistributedObjectListener request decoder / response encoder ─────────
//
// Request initial frame layout:
//   [0..3]   type = 0x000a00
//   [4..11]  correlationId
//   [12..15] partitionId
//   [16..32] registrationId UUID (17 bytes)

const REMOVE_DOL_REQUEST_UUID_OFFSET = RH; // 16 (request header: type + correlationId + partitionId)

function _decodeRemoveDistributedObjectListenerRequest(msg: ClientMessage): string {
    const frame = msg.getStartFrame();
    return FixedSizeTypesCodec.decodeUUID(frame.content, REMOVE_DOL_REQUEST_UUID_OFFSET) ?? '';
}

// Response initial frame layout (0x000a01):
//   [0..3]    type = 0x000a01
//   [4..11]   correlationId
//   [12]      backupAcks (byte)
//   [13]      response bool (1 byte)
// Total: 14 bytes.  (RESP_H = 13, bool at offset 13)

const REMOVE_DOL_RESPONSE_BOOL_OFFSET = RESP_H; // 13 (type(4) + correlationId(8) + backupAcks(1))
const REMOVE_DOL_RESPONSE_SIZE        = REMOVE_DOL_RESPONSE_BOOL_OFFSET + BOOLEAN_SIZE_IN_BYTES; // 14

function _encodeRemoveDistributedObjectListenerResponse(removed: boolean): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(REMOVE_DOL_RESPONSE_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(CLIENT_REMOVE_DISTRIBUTED_OBJECT_LISTENER_RESPONSE_TYPE >>> 0, 0);
    FixedSizeTypesCodec.encodeBoolean(buf, REMOVE_DOL_RESPONSE_BOOL_OFFSET, removed);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}

// ── CreateProxies request decoder / response encoder ─────────────────────────
//
// Request: initial frame (standard header) + EntryList<String, String>
// The entry list encodes (name, serviceName) pairs.

function _decodeCreateProxiesRequest(msg: ClientMessage): Array<[string, string]> {
    const iter = msg.forwardFrameIterator();
    iter.next(); // consume initial frame
    return EntryListCodec.decode(
        iter,
        (i) => StringCodec.decode(i),
        (i) => StringCodec.decode(i),
    );
}

function _encodeCreateProxiesResponse(): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESP_H);
    buf.fill(0);
    buf.writeUInt32LE(CLIENT_CREATE_PROXIES_RESPONSE_TYPE >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}

// ── SendAllSchemas request decoder / response encoder ────────────────────────
//
// Request: initial frame (standard header) + ListMultiFrame<Schema>
// Each schema is encoded identically to the single-schema SendSchema handler.

function _decodeAllSchemasRequest(msg: ClientMessage): Schema[] {
    const iterator = msg.forwardFrameIterator();
    iterator.next(); // consume initial frame
    return ListMultiFrameCodec.decode(iterator, _decodeSchemaFromIterator);
}

function _decodeSchemaFromIterator(iterator: ClientMessage.ForwardFrameIterator): Schema {
    iterator.next(); // consume BEGIN_DATA_STRUCTURE frame
    const typeName = StringCodec.decode(iterator);
    const fields = ListMultiFrameCodec.decode(iterator, _decodeFieldDescriptor);
    iterator.next(); // consume END_DATA_STRUCTURE frame
    return new Schema(typeName, fields);
}

function _encodeSendAllSchemasResponse(): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESP_H);
    buf.fill(0);
    buf.writeUInt32LE(CLIENT_SEND_ALL_SCHEMAS_RESPONSE_TYPE >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}
