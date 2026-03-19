/**
 * Block C — Ringbuffer Service Protocol Handlers
 *
 * Registers handlers for all Ringbuffer opcodes required by hazelcast-client@5.6.x:
 *
 *   Ringbuffer.Size              (0x170100)
 *   Ringbuffer.TailSequence      (0x170200)
 *   Ringbuffer.HeadSequence      (0x170300)
 *   Ringbuffer.Capacity          (0x170400)
 *   Ringbuffer.RemainingCapacity (0x170500)
 *   Ringbuffer.Add               (0x170600)
 *   Ringbuffer.ReadOne           (0x170700)
 *   Ringbuffer.AddAll            (0x170800)
 *   Ringbuffer.ReadMany          (0x170900)
 */

import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { ClientMessage } from '../../../client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '../../../client/impl/protocol/ClientMessage.js';
import { CodecUtil } from '../../../client/impl/protocol/codec/builtin/CodecUtil.js';
import { DataCodec } from '../../../client/impl/protocol/codec/builtin/DataCodec.js';
import { BOOLEAN_SIZE_IN_BYTES, INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from '../../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { ListLongCodec } from '../../../client/impl/protocol/codec/builtin/ListLongCodec.js';
import { StringCodec } from '../../../client/impl/protocol/codec/builtin/StringCodec.js';
import type { RingbufferServiceOperations } from './ServiceOperations.js';

// ── Message type constants ─────────────────────────────────────────────────────

const RB_SIZE_REQUEST         = 0x170100; const RB_SIZE_RESPONSE         = 0x170101;
const RB_TAIL_SEQ_REQUEST     = 0x170200; const RB_TAIL_SEQ_RESPONSE     = 0x170201;
const RB_HEAD_SEQ_REQUEST     = 0x170300; const RB_HEAD_SEQ_RESPONSE     = 0x170301;
const RB_CAPACITY_REQUEST     = 0x170400; const RB_CAPACITY_RESPONSE     = 0x170401;
const RB_REMAINING_CAP_REQUEST = 0x170500; const RB_REMAINING_CAP_RESPONSE = 0x170501;
const RB_ADD_REQUEST          = 0x170600; const RB_ADD_RESPONSE          = 0x170601;
const RB_READ_ONE_REQUEST     = 0x170700; const RB_READ_ONE_RESPONSE     = 0x170701;
const RB_ADD_ALL_REQUEST      = 0x170800; const RB_ADD_ALL_RESPONSE      = 0x170801;
const RB_READ_MANY_REQUEST    = 0x170900; const RB_READ_MANY_RESPONSE    = 0x170901;

const RH = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES;

// ── Registration ──────────────────────────────────────────────────────────────

export function registerRingbufferServiceHandlers(
    dispatcher: ClientMessageDispatcher,
    operations: RingbufferServiceOperations,
): void {
    // Size
    dispatcher.register(RB_SIZE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _long(RB_SIZE_RESPONSE, await operations.size(StringCodec.decode(iter)));
    });

    // TailSequence
    dispatcher.register(RB_TAIL_SEQ_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _long(RB_TAIL_SEQ_RESPONSE, await operations.tailSequence(StringCodec.decode(iter)));
    });

    // HeadSequence
    dispatcher.register(RB_HEAD_SEQ_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _long(RB_HEAD_SEQ_RESPONSE, await operations.headSequence(StringCodec.decode(iter)));
    });

    // Capacity
    dispatcher.register(RB_CAPACITY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _long(RB_CAPACITY_RESPONSE, await operations.capacity(StringCodec.decode(iter)));
    });

    // RemainingCapacity
    dispatcher.register(RB_REMAINING_CAP_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _long(RB_REMAINING_CAP_RESPONSE, await operations.remainingCapacity(StringCodec.decode(iter)));
    });

    // Add
    dispatcher.register(RB_ADD_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const overflowPolicy = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _long(RB_ADD_RESPONSE, await operations.add(name, overflowPolicy, value));
    });

    // ReadOne
    dispatcher.register(RB_READ_ONE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const sequence = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const value = await operations.readOne(name, sequence);
        return _nullable(RB_READ_ONE_RESPONSE, value);
    });

    // AddAll
    dispatcher.register(RB_ADD_ALL_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const overflowPolicy = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const values = _decodeDataList(iter);
        return _long(RB_ADD_ALL_RESPONSE, await operations.addAll(name, values, overflowPolicy));
    });

    // ReadMany
    dispatcher.register(RB_READ_MANY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const startSequence = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const minCount = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const maxCount = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const filter = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        const result = await operations.readMany(name, startSequence, minCount, maxCount, filter);
        return _encodeReadManyResponse(result);
    });
}

// ── Response helpers ──────────────────────────────────────────────────────────

function _long(t: number, v: bigint): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RH + LONG_SIZE_IN_BYTES);
    b.fill(0); b.writeUInt32LE(t >>> 0, 0); b.writeBigInt64LE(v, RH);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg;
}

function _nullable(t: number, data: Data | null): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE));
    if (data === null) { msg.add(CM.NULL_FRAME); } else { DataCodec.encode(msg, data); }
    msg.setFinal(); return msg;
}

function _encodeReadManyResponse(result: {
    readCount: number;
    items: Data[];
    itemSeqs: bigint[] | null;
    nextSeq: bigint;
}): ClientMessage {
    const msg = CM.createForEncode();
    // Initial frame: readCount(int) + nextSeq(long)
    const b = Buffer.allocUnsafe(RH + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
    b.fill(0);
    b.writeUInt32LE(RB_READ_MANY_RESPONSE >>> 0, 0);
    b.writeInt32LE(result.readCount | 0, RH);
    b.writeBigInt64LE(result.nextSeq, RH + INT_SIZE_IN_BYTES);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE));
    // Items list
    msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
    for (const item of result.items) {
        DataCodec.encode(msg, item);
    }
    msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
    // Item sequences (nullable list)
    if (result.itemSeqs === null) {
        msg.add(CM.NULL_FRAME);
    } else {
        ListLongCodec.encode(msg, result.itemSeqs);
    }
    msg.setFinal();
    return msg;
}

function _decodeDataList(iter: CM.ForwardFrameIterator): Data[] {
    const items: Data[] = [];
    if (!iter.hasNext()) return items;
    const bf = iter.peekNext();
    if (!bf || !bf.isBeginFrame()) return items;
    iter.next();
    while (iter.hasNext()) {
        const n = iter.peekNext();
        if (n && n.isEndFrame()) { iter.next(); break; }
        if (n && n.isNullFrame()) { iter.next(); continue; }
        items.push(DataCodec.decode(iter));
    }
    return items;
}
