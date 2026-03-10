/**
 * Block C — Queue Service Protocol Handlers
 *
 * Registers handlers for all Queue opcodes required by hazelcast-client@5.6.x:
 *
 *   Queue.Offer              (0x030100)
 *   Queue.Poll               (0x030200)
 *   Queue.Size               (0x030300)
 *   Queue.Clear              (0x030400)
 *   Queue.Contains           (0x030500)
 *   Queue.ContainsAll        (0x030600)
 *   Queue.Peek               (0x030700)
 *   Queue.AddAll             (0x030800)
 *   Queue.CompareAndRemoveAll (0x030900)
 *   Queue.CompareAndRetainAll (0x030a00)
 *   Queue.ToArray            (0x030b00)
 *   Queue.DrainTo            (0x030c00)
 *   Queue.DrainToWithMaxSize (0x030d00)
 *   Queue.Iterator           (0x030e00)
 *   Queue.IsEmpty            (0x030f00)
 *   Queue.Take               (0x030600)
 *   Queue.Put                (0x030200)
 *   Queue.RemainingCapacity  (0x031300)
 *   Queue.AddListener        (0x031100)
 *   Queue.RemoveListener     (0x031200)
 *   Queue.IsEmpty            (0x031400)
 */

import type { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { QueueOfferCodec } from '@zenystx/helios-core/client/impl/protocol/codec/QueueOfferCodec.js';
import { QueuePollCodec } from '@zenystx/helios-core/client/impl/protocol/codec/QueuePollCodec.js';
import { QueueSizeCodec } from '@zenystx/helios-core/client/impl/protocol/codec/QueueSizeCodec.js';
import { QueueClearCodec } from '@zenystx/helios-core/client/impl/protocol/codec/QueueClearCodec.js';
import { QueuePeekCodec } from '@zenystx/helios-core/client/impl/protocol/codec/QueuePeekCodec.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { QueueServiceOperations } from './ServiceOperations.js';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';

// ── Message type constants ─────────────────────────────────────────────────────

const QUEUE_CONTAINS_REQUEST_TYPE          = 0x030b00;
const QUEUE_CONTAINS_RESPONSE_TYPE         = 0x030b01;
const QUEUE_CONTAINS_ALL_REQUEST_TYPE      = 0x030c00;
const QUEUE_CONTAINS_ALL_RESPONSE_TYPE     = 0x030c01;
const QUEUE_COMPARE_REMOVE_ALL_REQUEST_TYPE  = 0x030d00;
const QUEUE_COMPARE_REMOVE_ALL_RESPONSE_TYPE = 0x030d01;
const QUEUE_COMPARE_RETAIN_ALL_REQUEST_TYPE  = 0x030e00;
const QUEUE_COMPARE_RETAIN_ALL_RESPONSE_TYPE = 0x030e01;
const QUEUE_ADD_ALL_REQUEST_TYPE           = 0x031000;
const QUEUE_ADD_ALL_RESPONSE_TYPE          = 0x031001;
const QUEUE_TO_ARRAY_REQUEST_TYPE          = 0x030e00;
const QUEUE_TO_ARRAY_RESPONSE_TYPE         = 0x030e01;
const QUEUE_DRAIN_TO_REQUEST_TYPE          = 0x030900;
const QUEUE_DRAIN_TO_RESPONSE_TYPE         = 0x030901;
const QUEUE_DRAIN_TO_MAX_REQUEST_TYPE      = 0x030a00;
const QUEUE_DRAIN_TO_MAX_RESPONSE_TYPE     = 0x030a01;
const QUEUE_IS_EMPTY_REQUEST_TYPE          = 0x031400;
const QUEUE_IS_EMPTY_RESPONSE_TYPE         = 0x031401;
const QUEUE_ITERATOR_REQUEST_TYPE          = 0x030800;
const QUEUE_ITERATOR_RESPONSE_TYPE         = 0x030801;
const QUEUE_REMOVE_LISTENER_REQUEST_TYPE   = 0x031200;
const QUEUE_REMOVE_LISTENER_RESPONSE_TYPE  = 0x031201;
const QUEUE_TAKE_REQUEST_TYPE              = 0x030600;
const QUEUE_TAKE_RESPONSE_TYPE             = 0x030601;
const QUEUE_PUT_REQUEST_TYPE               = 0x030200;
const QUEUE_PUT_RESPONSE_TYPE              = 0x030201;
const QUEUE_REMAINING_CAPACITY_REQUEST_TYPE  = 0x031300;
const QUEUE_REMAINING_CAPACITY_RESPONSE_TYPE = 0x031301;
const QUEUE_ADD_LISTENER_REQUEST_TYPE      = 0x031100;
const QUEUE_ADD_LISTENER_RESPONSE_TYPE     = 0x031101;

const RESPONSE_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES; // 13

// ── Registration ──────────────────────────────────────────────────────────────

export function registerQueueServiceHandlers(
    dispatcher: ClientMessageDispatcher,
    operations: QueueServiceOperations,
): void {
    // Queue.Offer
    dispatcher.register(QueueOfferCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const req = QueueOfferCodec.decodeRequest(msg);
        const result = await operations.offer(req.name, req.value, req.timeoutMs);
        return QueueOfferCodec.encodeResponse(result);
    });

    // Queue.Poll
    dispatcher.register(QueuePollCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const req = QueuePollCodec.decodeRequest(msg);
        const value = await operations.poll(req.name, req.timeoutMs);
        return QueuePollCodec.encodeResponse(value);
    });

    // Queue.Size
    dispatcher.register(QueueSizeCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const req = QueueSizeCodec.decodeRequest(msg);
        const size = await operations.size(req.name);
        return QueueSizeCodec.encodeResponse(size);
    });

    // Queue.Clear
    dispatcher.register(QueueClearCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const req = QueueClearCodec.decodeRequest(msg);
        await operations.clear(req.name);
        return QueueClearCodec.encodeResponse();
    });

    // Queue.Peek
    dispatcher.register(QueuePeekCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const req = QueuePeekCodec.decodeRequest(msg);
        const value = await operations.peek(req.name);
        return QueuePeekCodec.encodeResponse(value);
    });

    // Queue.Contains
    dispatcher.register(QUEUE_CONTAINS_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        const result = await operations.contains(name, value);
        return _encodeBooleanResponse(QUEUE_CONTAINS_RESPONSE_TYPE, result);
    });

    // Queue.ContainsAll
    dispatcher.register(QUEUE_CONTAINS_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const values = _decodeDataList(iter);
        const result = await operations.containsAll(name, values);
        return _encodeBooleanResponse(QUEUE_CONTAINS_ALL_RESPONSE_TYPE, result);
    });

    // Queue.AddAll
    dispatcher.register(QUEUE_ADD_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const values = _decodeDataList(iter);
        const result = await operations.addAll(name, values);
        return _encodeBooleanResponse(QUEUE_ADD_ALL_RESPONSE_TYPE, result);
    });

    // Queue.CompareAndRemoveAll
    dispatcher.register(QUEUE_COMPARE_REMOVE_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const values = _decodeDataList(iter);
        const result = await operations.removeAll(name, values);
        return _encodeBooleanResponse(QUEUE_COMPARE_REMOVE_ALL_RESPONSE_TYPE, result);
    });

    // Queue.CompareAndRetainAll
    dispatcher.register(QUEUE_COMPARE_RETAIN_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const values = _decodeDataList(iter);
        const result = await operations.retainAll(name, values);
        return _encodeBooleanResponse(QUEUE_COMPARE_RETAIN_ALL_RESPONSE_TYPE, result);
    });

    // Queue.ToArray (same as iterator)
    dispatcher.register(QUEUE_TO_ARRAY_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const items = await operations.iterator(name);
        return _encodeDataListResponse(QUEUE_TO_ARRAY_RESPONSE_TYPE, items);
    });

    // Queue.DrainTo
    dispatcher.register(QUEUE_DRAIN_TO_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const items = await operations.drain(name, Number.MAX_SAFE_INTEGER);
        return _encodeDataListResponse(QUEUE_DRAIN_TO_RESPONSE_TYPE, items);
    });

    // Queue.DrainToWithMaxSize
    dispatcher.register(QUEUE_DRAIN_TO_MAX_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const maxSize = initialFrame.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const items = await operations.drain(name, maxSize);
        return _encodeDataListResponse(QUEUE_DRAIN_TO_MAX_RESPONSE_TYPE, items);
    });

    // Queue.Iterator
    dispatcher.register(QUEUE_ITERATOR_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const items = await operations.iterator(name);
        return _encodeDataListResponse(QUEUE_ITERATOR_RESPONSE_TYPE, items);
    });

    // Queue.IsEmpty
    dispatcher.register(QUEUE_IS_EMPTY_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const result = await operations.isEmpty(name);
        return _encodeBooleanResponse(QUEUE_IS_EMPTY_RESPONSE_TYPE, result);
    });

    // Queue.Take (blocking poll with no timeout)
    dispatcher.register(QUEUE_TAKE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const value = await operations.take(name);
        return _encodeNullableDataResponse(QUEUE_TAKE_RESPONSE_TYPE, value);
    });

    // Queue.Put (blocking offer with no timeout)
    dispatcher.register(QUEUE_PUT_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        await operations.put(name, value);
        return _encodeEmptyResponse(QUEUE_PUT_RESPONSE_TYPE);
    });

    // Queue.RemainingCapacity
    dispatcher.register(QUEUE_REMAINING_CAPACITY_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const remaining = await operations.remainingCapacity(name);
        return _encodeIntResponse(QUEUE_REMAINING_CAPACITY_RESPONSE_TYPE, remaining);
    });

    // Queue.AddListener
    dispatcher.register(QUEUE_ADD_LISTENER_REQUEST_TYPE, async (msg, session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const includeValue = initialFrame.content.readUInt8(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES) !== 0;
        const name = StringCodec.decode(iter);
        const registrationId = await operations.addItemListener(name, includeValue, msg.getCorrelationId(), session);
        return _encodeStringResponse(QUEUE_ADD_LISTENER_RESPONSE_TYPE, registrationId);
    });

    // Queue.RemoveListener
    dispatcher.register(QUEUE_REMOVE_LISTENER_REQUEST_TYPE, async (msg, session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const registrationId = StringCodec.decode(iter);
        const result = await operations.removeItemListener(registrationId, session);
        return _encodeBooleanResponse(QUEUE_REMOVE_LISTENER_RESPONSE_TYPE, result);
    });
}

// ── Response helpers ──────────────────────────────────────────────────────────

function _encodeEmptyResponse(responseType: number): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(responseType >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}

function _encodeBooleanResponse(responseType: number, value: boolean): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE + BOOLEAN_SIZE_IN_BYTES);
    buf.fill(0);
    buf.writeUInt32LE(responseType >>> 0, 0);
    buf.writeUInt8(value ? 1 : 0, RESPONSE_HEADER_SIZE);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}

function _encodeIntResponse(responseType: number, value: number): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE + INT_SIZE_IN_BYTES);
    buf.fill(0);
    buf.writeUInt32LE(responseType >>> 0, 0);
    buf.writeInt32LE(value | 0, RESPONSE_HEADER_SIZE);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}

function _encodeStringResponse(responseType: number, value: string): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(responseType >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    StringCodec.encode(msg, value);
    msg.setFinal();
    return msg;
}

function _encodeNullableDataResponse(responseType: number, data: Data | null): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(responseType >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    if (data === null) {
        msg.add(CM.NULL_FRAME);
    } else {
        DataCodec.encode(msg, data);
    }
    msg.setFinal();
    return msg;
}

function _encodeDataListResponse(responseType: number, items: Data[]): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(responseType >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
    for (const item of items) {
        DataCodec.encode(msg, item);
    }
    msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
    msg.setFinal();
    return msg;
}

function _decodeDataList(iter: CM.ForwardFrameIterator): Data[] {
    const items: Data[] = [];
    if (!iter.hasNext()) return items;
    const beginFrame = iter.peekNext();
    if (!beginFrame || !beginFrame.isBeginFrame()) return items;
    iter.next();
    while (iter.hasNext()) {
        const next = iter.peekNext();
        if (next && next.isEndFrame()) { iter.next(); break; }
        if (next && next.isNullFrame()) { iter.next(); continue; }
        items.push(DataCodec.decode(iter));
    }
    return items;
}
