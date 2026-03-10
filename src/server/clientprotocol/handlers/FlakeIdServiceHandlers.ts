/**
 * Block C — FlakeIdGenerator Service Protocol Handlers
 *
 * Registers handlers for all FlakeIdGenerator opcodes required by hazelcast-client@5.6.x:
 *
 *   FlakeIdGenerator.NewIdBatch (0x1e0100)
 *
 * Request wire format (initial frame fixed fields after 12-byte header):
 *   name            (string frame)
 *   batchSize       (int, offset 12)
 *
 * Response wire format:
 *   base            (long, offset 12)
 *   increment       (long, offset 20)
 *   batchSize       (int, offset 28)
 */

import type { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { FlakeIdGeneratorOperations } from './ServiceOperations.js';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';

// ── Message type constants ─────────────────────────────────────────────────────

const FLAKE_NEW_ID_BATCH_REQUEST  = 0x1e0100;
const FLAKE_NEW_ID_BATCH_RESPONSE = 0x1e0101;

// Response fixed fields start after type(4) + correlationId(8) + backupAcks(1).
const REQUEST_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES;
const RESPONSE_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + 1;

// ── Options ───────────────────────────────────────────────────────────────────

export interface FlakeIdServiceHandlersOptions {
    dispatcher: ClientMessageDispatcher;
    flakeIdGenerator: FlakeIdGeneratorOperations;
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerFlakeIdServiceHandlers(opts: FlakeIdServiceHandlersOptions): void {
    const { dispatcher, flakeIdGenerator } = opts;

    /**
     * FlakeIdGenerator.NewIdBatch (0x1e0100)
     *
     * Request:
     *   initial frame fixed fields @ offset 12:
     *     batchSize (int)
     *   variable frames:
     *     name (string)
     *
     * Response fixed fields @ offset RH:
     *   base      (long)
     *   increment (long)
     *   batchSize (int)
     */
    dispatcher.register(FLAKE_NEW_ID_BATCH_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const batchSize = f.content.readInt32LE(REQUEST_HEADER_SIZE);
        const name = StringCodec.decode(iter);

        const { base, increment, batchSize: returnedBatchSize } =
            await flakeIdGenerator.newIdBatch(name, batchSize);

        return _newIdBatchResponse(base, increment, returnedBatchSize);
    });
}

// ── Response helpers ──────────────────────────────────────────────────────────

function _newIdBatchResponse(base: bigint, increment: bigint, batchSize: number): ClientMessage {
    const msg = CM.createForEncode();
    // base(8) + increment(8) + batchSize(4)
    const b = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
    b.fill(0);
    b.writeUInt32LE(FLAKE_NEW_ID_BATCH_RESPONSE >>> 0, 0);
    b.writeBigInt64LE(base, RESPONSE_HEADER_SIZE);
    b.writeBigInt64LE(increment, RESPONSE_HEADER_SIZE + LONG_SIZE_IN_BYTES);
    b.writeInt32LE(batchSize | 0, RESPONSE_HEADER_SIZE + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}
