/**
 * Block C — Client Service Protocol Handlers
 *
 * Registers handlers for all client-management opcodes required by
 * hazelcast-client@5.6.x:
 *
 *   Client.Ping                    (0x000d00) — heartbeat
 *   Client.CreateProxy             (0x000400) — create distributed object proxy
 *   Client.DestroyProxy            (0x000500) — destroy distributed object proxy
 *   Client.GetDistributedObjects   (0x000800) — list all distributed objects
 *   Client.AddClusterViewListener  (0x000900) — subscribe to topology events
 *   Client.AddPartitionLostListener(0x000b00) — subscribe to partition-lost events
 *   Client.Statistics              (0x000c00) — client stats (periodic, no response)
 *   Client.TriggerPartitionAssignment (0x001300) — request partition assignment
 *
 * Each handler: decode → dispatch (or inline logic) → encode response.
 * Handlers are thin — no business logic lives here.
 *
 * Port of Hazelcast {@code ClientEngineImpl} handlers (ClientPingTask,
 * CreateProxyTask, DestroyProxyTask, etc.).
 */

import type { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { ClientCreateProxyCodec } from '@zenystx/helios-core/client/impl/protocol/codec/ClientCreateProxyCodec.js';
import { ClientDestroyProxyCodec } from '@zenystx/helios-core/client/impl/protocol/codec/ClientDestroyProxyCodec.js';
import { ClientGetDistributedObjectsCodec } from '@zenystx/helios-core/client/impl/protocol/codec/ClientGetDistributedObjectsCodec.js';
import { ClientAddClusterViewListenerCodec } from '@zenystx/helios-core/server/clientprotocol/codec/ClientAddClusterViewListenerCodec.js';
import { ClientAddPartitionLostListenerCodec } from '@zenystx/helios-core/server/clientprotocol/codec/ClientAddPartitionLostListenerCodec.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { TopologyPublisher } from '@zenystx/helios-core/server/clientprotocol/TopologyPublisher.js';
import type { ILogger } from '@zenystx/helios-core/test-support/ILogger.js';

// ── Message type constants not covered by existing codecs ─────────────────────

const CLIENT_PING_REQUEST_TYPE           = 0x000d00;
const CLIENT_PING_RESPONSE_TYPE          = 0x000d01;
const CLIENT_STATISTICS_REQUEST_TYPE     = 0x000c00;
const CLIENT_STATISTICS_RESPONSE_TYPE    = 0x000c01;
const CLIENT_TRIGGER_PARTITION_ASSIGN_REQUEST_TYPE  = 0x001300;
const CLIENT_TRIGGER_PARTITION_ASSIGN_RESPONSE_TYPE = 0x001301;

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
    objectRegistry?: DistributedObjectRegistry;
    logger?: ILogger;
}

/**
 * Register all client-service handlers on the given dispatcher.
 * Call this once during server startup.
 */
export function registerClientServiceHandlers(opts: ClientServiceHandlersOptions): void {
    const { dispatcher, topologyPublisher } = opts;
    const objectRegistry = opts.objectRegistry ?? new DistributedObjectRegistry();

    // ── Ping (0x000d00) ───────────────────────────────────────────────────────
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

    // ── TriggerPartitionAssignment (0x001300) ─────────────────────────────────
    // Client requests the server to trigger partition assignment.  In a
    // single-member cluster the assignment is already stable; just respond.
    dispatcher.register(CLIENT_TRIGGER_PARTITION_ASSIGN_REQUEST_TYPE, async (_msg, _session) => {
        return _encodeTriggerPartitionAssignmentResponse();
    });
}

// ── Inline response encoders ──────────────────────────────────────────────────

import { ClientMessage as CM } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';

const RESPONSE_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES; // 12

function _encodePingResponse(): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(CLIENT_PING_RESPONSE_TYPE >>> 0, 0);
    msg.add(new CM.Frame(buf));
    msg.setFinal();
    return msg;
}

function _encodeStatisticsResponse(): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(CLIENT_STATISTICS_RESPONSE_TYPE >>> 0, 0);
    msg.add(new CM.Frame(buf));
    msg.setFinal();
    return msg;
}

function _encodeTriggerPartitionAssignmentResponse(): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(CLIENT_TRIGGER_PARTITION_ASSIGN_RESPONSE_TYPE >>> 0, 0);
    msg.add(new CM.Frame(buf));
    msg.setFinal();
    return msg;
}
