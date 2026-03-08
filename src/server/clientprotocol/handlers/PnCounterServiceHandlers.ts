/**
 * Block C — PNCounter Service Protocol Handlers
 *
 * Registers handlers for all PNCounter opcodes required by hazelcast-client@5.6.x:
 *
 *   PNCounter.Get                      (0x1d0100)
 *   PNCounter.Add                      (0x1d0200)
 *   PNCounter.GetConfiguredReplicaCount (0x1d0300)
 *
 * PNCounter.Get / PNCounter.Add request wire format:
 *   initial frame fixed fields after 12-byte header:
 *     delta            (long, offset 12)         — Add only
 *     getBeforeUpdate  (boolean, offset 12+8)    — Add only
 *     targetReplicaUUID (UUID, offset 12+8+1)    — both Get and Add
 *   variable frames:
 *     name                 (string)
 *     replicaTimestamps    (list of <memberUUID:string, timestamp:long> entries)
 *
 * PNCounter.Get request fixed fields after 12-byte header:
 *     targetReplicaUUID (UUID, 16 bytes, offset 12)
 *
 * PNCounter.Add / Get Response:
 *   value              (long)
 *   replicaTimestamps  (list of <memberUUID:string, timestamp:long> entries)
 *
 * PNCounter.GetConfiguredReplicaCount Response:
 *   count (int)
 *
 * Note: UUID is 16 bytes (two 64-bit values: mostSigBits + leastSigBits) in little-endian.
 */

import type { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { PnCounterOperations } from './ServiceOperations.js';
import {
    INT_SIZE_IN_BYTES,
    LONG_SIZE_IN_BYTES,
    BOOLEAN_SIZE_IN_BYTES,
    UUID_SIZE_IN_BYTES,
} from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { FixedSizeTypesCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';

// ── Message type constants ─────────────────────────────────────────────────────

const PN_GET_REQUEST                         = 0x1d0100;
const PN_GET_RESPONSE                        = 0x1d0101;
const PN_ADD_REQUEST                         = 0x1d0200;
const PN_ADD_RESPONSE                        = 0x1d0201;
const PN_GET_CONFIGURED_REPLICA_COUNT_REQUEST  = 0x1d0300;
const PN_GET_CONFIGURED_REPLICA_COUNT_RESPONSE = 0x1d0301;

// Response header size: messageType(4) + correlationId(8)
const RH = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES;

// ── Options ───────────────────────────────────────────────────────────────────

export interface PnCounterServiceHandlersOptions {
    dispatcher: ClientMessageDispatcher;
    pnCounter: PnCounterOperations;
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerPnCounterServiceHandlers(opts: PnCounterServiceHandlersOptions): void {
    const { dispatcher, pnCounter } = opts;

    /**
     * PNCounter.Get (0x1d0100)
     *
     * Request fixed fields @ offset 12:
     *   targetReplicaUUID (UUID, 16 bytes)
     * Variable frames:
     *   name                (string)
     *   replicaTimestamps   (list — encoded as alternating string/long frames)
     */
    dispatcher.register(PN_GET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const targetReplicaUUID = FixedSizeTypesCodec.decodeUUID(f.content, RH) ?? '';
        const name = StringCodec.decode(iter);
        const replicaTimestamps = _decodeReplicaTimestamps(iter);

        const result = await pnCounter.get(name, replicaTimestamps, targetReplicaUUID);
        return _pnValueResponse(PN_GET_RESPONSE, result.value, result.replicaTimestamps);
    });

    /**
     * PNCounter.Add (0x1d0200)
     *
     * Request fixed fields @ offset 12:
     *   delta            (long)
     *   getBeforeUpdate  (boolean)
     *   targetReplicaUUID (UUID, 16 bytes)
     * Variable frames:
     *   name                (string)
     *   replicaTimestamps   (list)
     */
    dispatcher.register(PN_ADD_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const delta = f.content.readBigInt64LE(RH);
        const getBeforeUpdate = f.content.readUInt8(RH + LONG_SIZE_IN_BYTES) !== 0;
        const targetReplicaUUID = FixedSizeTypesCodec.decodeUUID(f.content, RH + LONG_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES) ?? '';
        const name = StringCodec.decode(iter);
        const replicaTimestamps = _decodeReplicaTimestamps(iter);

        const result = await pnCounter.add(name, delta, getBeforeUpdate, replicaTimestamps, targetReplicaUUID);
        return _pnValueResponse(PN_ADD_RESPONSE, result.value, result.replicaTimestamps);
    });

    /**
     * PNCounter.GetConfiguredReplicaCount (0x1d0300)
     *
     * Request variable frames:
     *   name (string)
     *
     * Response fixed fields @ offset RH:
     *   count (int)
     */
    dispatcher.register(PN_GET_CONFIGURED_REPLICA_COUNT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next(); // skip initial frame
        const name = StringCodec.decode(iter);

        const count = await pnCounter.getConfiguredReplicaCount(name);
        return _intResponse(PN_GET_CONFIGURED_REPLICA_COUNT_RESPONSE, count);
    });
}

// ── Wire helpers ──────────────────────────────────────────────────────────────

/**
 * Decode a list of [memberUUID, timestamp] pairs.
 *
 * Wire encoding: map encoded as a list structure — BEGIN_DS, then for each entry
 * a UUID string frame followed by a long frame, then END_DS.
 * For simplicity we read until the end-of-structure sentinel.
 */
function _decodeReplicaTimestamps(
    iter: CM.ForwardFrameIterator,
): Array<[string, bigint]> {
    const result: Array<[string, bigint]> = [];
    // The list is framed by BEGIN_DATA_STRUCTURE / END_DATA_STRUCTURE flags.
    // Skip the begin frame.
    if (!iter.hasNext()) return result;
    let frame = iter.next();
    if ((frame.flags & CM.BEGIN_DATA_STRUCTURE_FLAG) === 0) {
        // No list framing; frame contains inline data — treat as empty
        return result;
    }

    while (iter.hasNext()) {
        frame = iter.next();
        if ((frame.flags & CM.END_DATA_STRUCTURE_FLAG) !== 0) break;
        // Each entry: UUID string (16 bytes or as a string frame)
        const memberUUID = frame.content.toString('utf8');
        if (!iter.hasNext()) break;
        const tsFrame = iter.next();
        if ((tsFrame.flags & CM.END_DATA_STRUCTURE_FLAG) !== 0) break;
        const timestamp = tsFrame.content.readBigInt64LE(0);
        result.push([memberUUID, timestamp]);
    }
    return result;
}

/**
 * Encode a PNCounter value response: value (long) + replicaTimestamps (list).
 */
function _pnValueResponse(
    messageType: number,
    value: bigint,
    replicaTimestamps: Array<[string, bigint]>,
): ClientMessage {
    const msg = CM.createForEncode();

    // Initial frame: value (long)
    const b = Buffer.allocUnsafe(RH + LONG_SIZE_IN_BYTES);
    b.fill(0);
    b.writeUInt32LE(messageType >>> 0, 0);
    b.writeBigInt64LE(value, RH);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE));

    // replicaTimestamps list
    msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
    for (const [memberUUID, timestamp] of replicaTimestamps) {
        const uuidBuf = Buffer.from(memberUUID, 'utf8');
        msg.add(new CM.Frame(uuidBuf));
        const tsBuf = Buffer.allocUnsafe(LONG_SIZE_IN_BYTES);
        tsBuf.writeBigInt64LE(timestamp);
        msg.add(new CM.Frame(tsBuf));
    }
    msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));

    msg.setFinal();
    return msg;
}

function _intResponse(messageType: number, value: number): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RH + INT_SIZE_IN_BYTES);
    b.fill(0);
    b.writeUInt32LE(messageType >>> 0, 0);
    b.writeInt32LE(value | 0, RH);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}
