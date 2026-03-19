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

import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { ClientMessage } from '../../../client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '../../../client/impl/protocol/ClientMessage.js';
import {
    BOOLEAN_SIZE_IN_BYTES,
    FixedSizeTypesCodec,
    INT_SIZE_IN_BYTES,
    LONG_SIZE_IN_BYTES,
    UUID_SIZE_IN_BYTES,
} from '../../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import type { PnCounterOperations } from './ServiceOperations.js';

// ── Message type constants ─────────────────────────────────────────────────────

const PN_GET_REQUEST                         = 0x1d0100;
const PN_GET_RESPONSE                        = 0x1d0101;
const PN_ADD_REQUEST                         = 0x1d0200;
const PN_ADD_RESPONSE                        = 0x1d0201;
const PN_GET_CONFIGURED_REPLICA_COUNT_REQUEST  = 0x1d0300;
const PN_GET_CONFIGURED_REPLICA_COUNT_RESPONSE = 0x1d0301;

// Response header size: messageType(4) + correlationId(8)
const REQUEST_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES;
const RESPONSE_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES;

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
        const targetReplicaUUID = FixedSizeTypesCodec.decodeUUID(f.content, REQUEST_HEADER_SIZE) ?? '';
        const name = _decodeStringFrame(iter);
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
        const delta = f.content.readBigInt64LE(REQUEST_HEADER_SIZE);
        const getBeforeUpdate = f.content.readUInt8(REQUEST_HEADER_SIZE + LONG_SIZE_IN_BYTES) !== 0;
        const targetReplicaUUID = FixedSizeTypesCodec.decodeUUID(f.content, REQUEST_HEADER_SIZE + LONG_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES) ?? '';
        const name = _decodeStringFrame(iter);
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
        const name = _decodeStringFrame(iter);

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
    if (!iter.hasNext()) return result;
    const frame = iter.next();
    if (frame.content.length === 0) {
        return result;
    }

    const entrySize = UUID_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES;
    const entryCount = Math.floor(frame.content.length / entrySize);
    for (let index = 0; index < entryCount; index++) {
        const offset = index * entrySize;
        const memberUUID = FixedSizeTypesCodec.decodeUUID(frame.content, offset);
        const timestamp = FixedSizeTypesCodec.decodeLong(frame.content, offset + UUID_SIZE_IN_BYTES);
        if (memberUUID !== null) {
            result.push([memberUUID, BigInt(timestamp.toString())]);
        }
    }
    return result;
}

function _decodeStringFrame(iter: CM.ForwardFrameIterator): string {
    const frame = iter.next();
    return frame.content.toString('utf8');
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
    const b = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
    b.fill(0);
    b.writeUInt32LE(messageType >>> 0, 0);
    b.writeBigInt64LE(value, RESPONSE_HEADER_SIZE);
    b.writeInt32LE(replicaTimestamps.length, RESPONSE_HEADER_SIZE + LONG_SIZE_IN_BYTES);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE));

    const entrySize = UUID_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES;
    const entries = Buffer.allocUnsafe(replicaTimestamps.length * entrySize);
    entries.fill(0);
    for (let index = 0; index < replicaTimestamps.length; index++) {
        const [memberUUID, timestamp] = replicaTimestamps[index];
        const offset = index * entrySize;
        FixedSizeTypesCodec.encodeUUID(entries, offset, memberUUID);
        FixedSizeTypesCodec.encodeLong(entries, offset + UUID_SIZE_IN_BYTES, timestamp);
    }
    msg.add(new CM.Frame(entries));

    msg.setFinal();
    return msg;
}

function _intResponse(messageType: number, value: number): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE + INT_SIZE_IN_BYTES);
    b.fill(0);
    b.writeUInt32LE(messageType >>> 0, 0);
    b.writeInt32LE(value | 0, RESPONSE_HEADER_SIZE);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}
