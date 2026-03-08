/**
 * Block C — CardinalityEstimator Service Protocol Handlers
 *
 * Registers handlers for all CardinalityEstimator opcodes required by hazelcast-client@5.6.x:
 *
 *   CardinalityEstimator.Add      (0x1b0100)
 *   CardinalityEstimator.Estimate (0x1b0200)
 *
 * CardinalityEstimator.Add request:
 *   variable frames:
 *     name  (string)
 *     item  (Data — serialized object to add to the HyperLogLog sketch)
 *
 * CardinalityEstimator.Estimate request:
 *   variable frames:
 *     name (string)
 *
 * CardinalityEstimator.Estimate response:
 *   estimate (long, offset RH)
 */

import type { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { CardinalityEstimatorOperations } from './ServiceOperations.js';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';

// ── Message type constants ─────────────────────────────────────────────────────

const CE_ADD_REQUEST      = 0x1b0100;
const CE_ADD_RESPONSE     = 0x1b0101;
const CE_ESTIMATE_REQUEST  = 0x1b0200;
const CE_ESTIMATE_RESPONSE = 0x1b0201;

// Response header size: messageType(4) + correlationId(8)
const RH = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES;

// ── Options ───────────────────────────────────────────────────────────────────

export interface CardinalityServiceHandlersOptions {
    dispatcher: ClientMessageDispatcher;
    cardinalityEstimator: CardinalityEstimatorOperations;
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerCardinalityServiceHandlers(opts: CardinalityServiceHandlersOptions): void {
    const { dispatcher, cardinalityEstimator } = opts;

    /**
     * CardinalityEstimator.Add (0x1b0100)
     *
     * Request variable frames:
     *   name (string)
     *   item (Data)
     *
     * Response: empty (void)
     */
    dispatcher.register(CE_ADD_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next(); // skip initial frame (no fixed fields beyond header)
        const name = StringCodec.decode(iter);
        const item = DataCodec.decode(iter);
        await cardinalityEstimator.add(name, item);
        return _emptyResponse(CE_ADD_RESPONSE);
    });

    /**
     * CardinalityEstimator.Estimate (0x1b0200)
     *
     * Request variable frames:
     *   name (string)
     *
     * Response fixed fields @ offset RH:
     *   estimate (long)
     */
    dispatcher.register(CE_ESTIMATE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next(); // skip initial frame
        const name = StringCodec.decode(iter);
        const estimate = await cardinalityEstimator.estimate(name);
        return _longResponse(CE_ESTIMATE_RESPONSE, estimate);
    });
}

// ── Response helpers ──────────────────────────────────────────────────────────

function _emptyResponse(messageType: number): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RH);
    b.fill(0);
    b.writeUInt32LE(messageType >>> 0, 0);
    msg.add(new CM.Frame(b));
    msg.setFinal();
    return msg;
}

function _longResponse(messageType: number, value: bigint): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RH + LONG_SIZE_IN_BYTES);
    b.fill(0);
    b.writeUInt32LE(messageType >>> 0, 0);
    b.writeBigInt64LE(value, RH);
    msg.add(new CM.Frame(b));
    msg.setFinal();
    return msg;
}
