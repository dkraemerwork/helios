/**
 * Block D.3 — Near-Cache Invalidation Protocol Handler
 *
 * Wires the server-side NearCacheInvalidationManager into the client-protocol
 * dispatcher, handling:
 *
 *   Map.AddNearCacheInvalidationListener  (0x013f00)
 *       Client subscribes to invalidation events for a given map.
 *       Server responds with a registration UUID (ACK).
 *
 *   Map.FetchNearCacheInvalidationMetadata (0x013d00)
 *       Client requests current partition UUIDs + sequences for anti-entropy.
 *       Server responds with per-partition metadata for each requested map.
 *
 * Event wire format pushed to clients:
 *
 *   Single invalidation event (0x013f02):
 *     [initial frame: INT msgType + LONG correlationId + INT partitionId]
 *     [key bytes frame — serialized Data]
 *     [metadata frame: INT partitionId + LONG sequence + UUID partitionUuid]
 *     [sourceUuid string frame]
 *
 *   Clear invalidation event (0x013f04):
 *     [initial frame: INT msgType + LONG correlationId]
 *     [list of (partitionId, partitionUuid, sequence) triples]
 *     [sourceUuid string frame]
 *
 * Implements InvalidationEventSerializer so the NearCacheInvalidationManager
 * can serialise events without knowing about the protocol layer.
 *
 * Port of Hazelcast MapAddNearCacheInvalidationListenerTask and related codec.
 */

import type { ILogger } from '@zenystx/helios-core/logging/Logger.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { ClientSession } from '@zenystx/helios-core/server/clientprotocol/ClientSession.js';
import type { ClientSessionRegistry } from '@zenystx/helios-core/server/clientprotocol/ClientSessionRegistry.js';
import type {
    BatchNearCacheInvalidationEvent,
    ClearNearCacheInvalidationEvent,
    SingleNearCacheInvalidationEvent,
} from '@zenystx/helios-core/spi/impl/NearCacheInvalidationEvent.js';
import type {
    InvalidationEventSerializer,
    NearCacheInvalidationManager,
} from '@zenystx/helios-core/spi/impl/NearCacheInvalidationManager.js';
import { ClientMessage as CM } from '../../../client/impl/protocol/ClientMessage.js';
import {
    FixedSizeTypesCodec,
    INT_SIZE_IN_BYTES,
    LONG_SIZE_IN_BYTES,
    UUID_SIZE_IN_BYTES,
} from '../../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '../../../client/impl/protocol/codec/builtin/StringCodec.js';

// ── Opcodes ───────────────────────────────────────────────────────────────────

/** Client → Server: subscribe to near-cache invalidation events for a map. */
const MAP_ADD_NEAR_CACHE_INVALIDATION_LISTENER_REQUEST_TYPE  = 0x013f00;
/** Server → Client: ACK response carrying the registration UUID. */
const MAP_ADD_NEAR_CACHE_INVALIDATION_LISTENER_RESPONSE_TYPE = 0x013f01;
/** Server → Client: pushed single-key invalidation event. */
const MAP_NEAR_CACHE_SINGLE_INVALIDATION_EVENT_TYPE = 0x013f02;
/** Server → Client: pushed batch/clear invalidation event. */
const MAP_NEAR_CACHE_BATCH_INVALIDATION_EVENT_TYPE  = 0x013f03;
/** Server → Client: pushed clear-all invalidation event. */
const MAP_NEAR_CACHE_CLEAR_INVALIDATION_EVENT_TYPE  = 0x013f04;

/** Client → Server: fetch current partition metadata for anti-entropy. */
const MAP_FETCH_NEAR_CACHE_INVALIDATION_METADATA_REQUEST_TYPE  = 0x013d00;
/** Server → Client: metadata response. */
const MAP_FETCH_NEAR_CACHE_INVALIDATION_METADATA_RESPONSE_TYPE = 0x013d01;

// Standard response/event header size: INT messageType (4) + LONG correlationId (8)
const INITIAL_FRAME_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES;

// ── Options ───────────────────────────────────────────────────────────────────

export interface NearCacheInvalidationHandlerOptions {
    dispatcher: ClientMessageDispatcher;
    invalidationManager: NearCacheInvalidationManager;
    sessionRegistry: ClientSessionRegistry;
    logger?: ILogger;
}

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Register near-cache invalidation handlers on the given dispatcher and
 * wire the event serialiser into the NearCacheInvalidationManager.
 *
 * Call once during server startup, after all other handlers are registered.
 */
export function registerNearCacheInvalidationHandlers(
    opts: NearCacheInvalidationHandlerOptions,
): void {
    const { dispatcher, invalidationManager, logger } = opts;

    // Wire the serialiser
    const serializer = new NearCacheInvalidationSerializer();
    invalidationManager.setSerializer(serializer);

    // ── Map.AddNearCacheInvalidationListener ─────────────────────────────────

    dispatcher.register(
        MAP_ADD_NEAR_CACHE_INVALIDATION_LISTENER_REQUEST_TYPE,
        async (msg: CM, session: ClientSession): Promise<CM> => {
            const mapName = _decodeMapName(msg);
            const registrationUuid = crypto.randomUUID();

            // Wire callback: push serialised events back to this session
            invalidationManager.subscribe(session, mapName);

            if (logger?.isFineEnabled()) {
                logger.fine(
                    `[NearCacheInvalidationHandler] Session ${session.getSessionId()} ` +
                    `subscribed to near-cache invalidation for map "${mapName}" ` +
                    `registrationUuid=${registrationUuid}`,
                );
            }

            return _encodeStringResponse(
                MAP_ADD_NEAR_CACHE_INVALIDATION_LISTENER_RESPONSE_TYPE,
                registrationUuid,
                msg.getCorrelationId(),
            );
        },
    );

    // ── Map.FetchNearCacheInvalidationMetadata ────────────────────────────────

    dispatcher.register(
        MAP_FETCH_NEAR_CACHE_INVALIDATION_METADATA_REQUEST_TYPE,
        async (msg: CM, _session: ClientSession): Promise<CM> => {
            const mapNames = _decodeStringList(msg);
            const metadata = invalidationManager.fetchMetadata(mapNames);
            return _encodeMetadataResponse(
                MAP_FETCH_NEAR_CACHE_INVALIDATION_METADATA_RESPONSE_TYPE,
                metadata,
                msg.getCorrelationId(),
            );
        },
    );
}

// ── Invalidation event serialiser ─────────────────────────────────────────────

/**
 * Converts NearCacheInvalidationEvent objects into ClientMessage instances
 * suitable for pushing over the wire.
 */
class NearCacheInvalidationSerializer implements InvalidationEventSerializer {

    /**
     * Single-key invalidation event wire layout:
     *
     * Initial frame (INITIAL_FRAME_SIZE + partitionId):
     *   [0..3]   messageType  INT
     *   [4..11]  correlationId LONG (0 for events)
     *   [12..15] partitionId  INT
     *   [16..23] sequence     LONG
     *
     * Frame 2 (key bytes):
     *   Raw key bytes as data frame.
     *
     * Frame 3 (partition UUID, 17 bytes):
     *   UUID (null_bool + msb + lsb)
     *
     * Frame 4 (sourceUuid string):
     *   StringCodec-encoded source member UUID.
     */
    serializeSingle(event: SingleNearCacheInvalidationEvent): Buffer {
        const msg = CM.createForEncode();

        // Initial frame: msgType + correlationId(0) + partitionId + sequence
        const initBuf = Buffer.allocUnsafe(INITIAL_FRAME_SIZE + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        initBuf.fill(0);
        initBuf.writeUInt32LE(MAP_NEAR_CACHE_SINGLE_INVALIDATION_EVENT_TYPE >>> 0, 0);
        // correlationId = 0 (event, not response)
        initBuf.writeInt32LE(event.partitionId, INITIAL_FRAME_SIZE);
        initBuf.writeBigInt64LE(BigInt(event.sequence), INITIAL_FRAME_SIZE + INT_SIZE_IN_BYTES);

        const EVENT_FLAGS = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG | CM.IS_EVENT_FLAG;
        const initFrame = new CM.Frame(initBuf, EVENT_FLAGS);
        msg.add(initFrame);

        // Key bytes frame
        const keyFrame = new CM.Frame(Buffer.from(event.keyBytes));
        msg.add(keyFrame);

        // Partition UUID frame (17 bytes: null_bool + msb + lsb)
        const uuidBuf = Buffer.allocUnsafe(UUID_SIZE_IN_BYTES);
        FixedSizeTypesCodec.encodeUUID(uuidBuf, 0, event.partitionUuid);
        msg.add(new CM.Frame(uuidBuf));

        // Source UUID (string)
        StringCodec.encode(msg, event.sourceUuid);

        msg.setFinal();
        return _messageToBuffer(msg);
    }

    /**
     * Batch invalidation event wire layout:
     *
     * Initial frame:
     *   [0..3]   messageType INT
     *   [4..11]  correlationId LONG (0)
     *   [12..15] count INT  (number of keys)
     *
     * For each key:
     *   Frame A: key bytes
     *   Frame B: INT partitionId + LONG sequence + UUID partitionUuid
     *   Frame C: sourceUuid string
     */
    serializeBatch(event: BatchNearCacheInvalidationEvent): Buffer {
        const msg = CM.createForEncode();

        const count = event.keys.length;
        const initBuf = Buffer.allocUnsafe(INITIAL_FRAME_SIZE + INT_SIZE_IN_BYTES);
        initBuf.fill(0);
        initBuf.writeUInt32LE(MAP_NEAR_CACHE_BATCH_INVALIDATION_EVENT_TYPE >>> 0, 0);
        initBuf.writeInt32LE(count, INITIAL_FRAME_SIZE);
        const EVENT_FLAGS = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG | CM.IS_EVENT_FLAG;
        msg.add(new CM.Frame(initBuf, EVENT_FLAGS));

        // Encode each key entry
        for (const entry of event.keys) {
            // Key bytes
            msg.add(new CM.Frame(Buffer.from(entry.keyBytes)));

            // Metadata: partitionId + sequence + partitionUuid
            const metaBuf = Buffer.allocUnsafe(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + UUID_SIZE_IN_BYTES);
            metaBuf.writeInt32LE(entry.partitionId, 0);
            metaBuf.writeBigInt64LE(BigInt(entry.sequence), INT_SIZE_IN_BYTES);
            FixedSizeTypesCodec.encodeUUID(metaBuf, INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES, entry.partitionUuid);
            msg.add(new CM.Frame(metaBuf));

            // Source UUID
            StringCodec.encode(msg, entry.sourceUuid);
        }

        msg.setFinal();
        return _messageToBuffer(msg);
    }

    /**
     * Clear invalidation event wire layout:
     *
     * Initial frame:
     *   [0..3]   messageType INT
     *   [4..11]  correlationId LONG (0)
     *   [12..15] partitionCount INT
     *
     * For each partition (partitionCount entries):
     *   Frame: INT partitionId + UUID partitionUuid + LONG sequence
     *
     * Final frame: sourceUuid string
     */
    serializeClear(event: ClearNearCacheInvalidationEvent): Buffer {
        const msg = CM.createForEncode();

        const partitionCount = event.partitionUuids.size;
        const initBuf = Buffer.allocUnsafe(INITIAL_FRAME_SIZE + INT_SIZE_IN_BYTES);
        initBuf.fill(0);
        initBuf.writeUInt32LE(MAP_NEAR_CACHE_CLEAR_INVALIDATION_EVENT_TYPE >>> 0, 0);
        initBuf.writeInt32LE(partitionCount, INITIAL_FRAME_SIZE);
        const EVENT_FLAGS = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG | CM.IS_EVENT_FLAG;
        msg.add(new CM.Frame(initBuf, EVENT_FLAGS));

        // Partition metadata entries
        for (const [partitionId, partitionUuid] of event.partitionUuids) {
            const sequence = event.sequences.get(partitionId) ?? 0;
            const entryBuf = Buffer.allocUnsafe(INT_SIZE_IN_BYTES + UUID_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
            entryBuf.writeInt32LE(partitionId, 0);
            FixedSizeTypesCodec.encodeUUID(entryBuf, INT_SIZE_IN_BYTES, partitionUuid);
            entryBuf.writeBigInt64LE(BigInt(sequence), INT_SIZE_IN_BYTES + UUID_SIZE_IN_BYTES);
            msg.add(new CM.Frame(entryBuf));
        }

        // Source UUID
        StringCodec.encode(msg, event.sourceUuid);

        msg.setFinal();
        return _messageToBuffer(msg);
    }
}

// ── Codec helpers ─────────────────────────────────────────────────────────────

/** Decode the map name from a near-cache listener add/remove request. */
function _decodeMapName(msg: CM): string {
    const iter = msg.forwardFrameIterator();
    iter.next(); // skip initial frame
    return StringCodec.decode(iter);
}

/** Decode a list of map names from a fetch-metadata request. */
function _decodeStringList(msg: CM): string[] {
    const iter = msg.forwardFrameIterator();
    iter.next(); // skip initial frame
    const names: string[] = [];
    if (!iter.hasNext()) return names;
    const begin = iter.peekNext();
    if (!begin || !begin.isBeginFrame()) return names;
    iter.next(); // consume BEGIN
    while (iter.hasNext()) {
        const peek = iter.peekNext();
        if (peek && peek.isEndFrame()) { iter.next(); break; }
        names.push(StringCodec.decode(iter));
    }
    return names;
}

/**
 * Encode a string registration UUID response.
 * Layout: initial frame + string frame.
 */
function _encodeStringResponse(responseType: number, value: string, correlationId: number): CM {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(INITIAL_FRAME_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(responseType >>> 0, 0);
    buf.writeInt32LE(correlationId, INT_SIZE_IN_BYTES);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    StringCodec.encode(msg, value);
    msg.setFinal();
    return msg;
}

/**
 * Encode a metadata response.
 *
 * Wire layout:
 *   Initial frame: INT messageType + LONG correlationId + INT mapCount
 *   For each map:
 *     String frame: mapName
 *     BEGIN_DATA_STRUCTURE frame
 *     For each partition:
 *       Entry frame: INT partitionId + UUID partitionUuid + LONG sequence
 *     END_DATA_STRUCTURE frame
 */
function _encodeMetadataResponse(
    responseType: number,
    metadata: import('@zenystx/helios-core/spi/impl/NearCacheInvalidationManager.js').MapInvalidationMetadata[],
    correlationId: number,
): CM {
    const msg = CM.createForEncode();

    const initBuf = Buffer.allocUnsafe(INITIAL_FRAME_SIZE + INT_SIZE_IN_BYTES);
    initBuf.fill(0);
    initBuf.writeUInt32LE(responseType >>> 0, 0);
    initBuf.writeInt32LE(correlationId, INT_SIZE_IN_BYTES);
    initBuf.writeInt32LE(metadata.length, INITIAL_FRAME_SIZE);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(initBuf, UNFRAGMENTED_MESSAGE));

    for (const mapMeta of metadata) {
        // Map name
        StringCodec.encode(msg, mapMeta.mapName);

        // Partition entries
        msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
        for (const p of mapMeta.partitions) {
            const entryBuf = Buffer.allocUnsafe(INT_SIZE_IN_BYTES + UUID_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
            entryBuf.writeInt32LE(p.partitionId, 0);
            FixedSizeTypesCodec.encodeUUID(entryBuf, INT_SIZE_IN_BYTES, p.partitionUuid);
            entryBuf.writeBigInt64LE(BigInt(p.sequence), INT_SIZE_IN_BYTES + UUID_SIZE_IN_BYTES);
            msg.add(new CM.Frame(entryBuf));
        }
        msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
    }

    msg.setFinal();
    return msg;
}

/**
 * Serialise a ClientMessage to a raw Buffer for transport.
 * (Re-implementation of the inline serialise pattern from ClientSession.)
 */
function _messageToBuffer(msg: CM): Buffer {
    const SIZE_OF_FRAME_HEADER = CM.SIZE_OF_FRAME_LENGTH_AND_FLAGS; // 6 bytes
    const totalSize = msg.getFrameLength();
    const buf = Buffer.allocUnsafe(totalSize);
    let offset = 0;
    let frame: CM.Frame | null = msg.getStartFrame();
    while (frame !== null) {
        const frameLen = SIZE_OF_FRAME_HEADER + frame.content.length;
        buf.writeUInt32LE(frameLen, offset);
        buf.writeUInt16LE(frame.flags, offset + 4);
        if (frame.content.length > 0) {
            frame.content.copy(buf, offset + SIZE_OF_FRAME_HEADER);
        }
        offset += frameLen;
        frame = frame.next;
    }
    return buf;
}
