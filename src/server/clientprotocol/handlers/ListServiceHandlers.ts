/**
 * Block C — List Service Protocol Handlers
 *
 * Registers handlers for all List opcodes required by hazelcast-client@5.6.x:
 *
 *   List.Size              (0x050100)
 *   List.Contains          (0x050200)
 *   List.ContainsAll       (0x050300)
 *   List.Add               (0x050400)
 *   List.Remove            (0x050500)
 *   List.AddAll            (0x050600)
 *   List.RemoveAll         (0x050700)
 *   List.RetainAll         (0x050800)
 *   List.Clear             (0x050900)
 *   List.Iterator          (0x050a00)
 *   List.AddListener       (0x050b00)
 *   List.RemoveListener    (0x050c00)
 *   List.IsEmpty           (0x050d00)
 *   List.AddAllWithIndex   (0x050e00)
 *   List.Get               (0x050f00)
 *   List.Set               (0x051000)
 *   List.AddWithIndex      (0x051100)
 *   List.RemoveWithIndex   (0x051200)
 *   List.LastIndexOf       (0x051300)
 *   List.IndexOf           (0x051400)
 *   List.SubList           (0x051500)
 *   List.ListIterator      (0x051600)
 */

import type { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import { ListAddListenerCodec } from '@zenystx/helios-core/client/impl/protocol/codec/ListAddListenerCodec.js';
import type { ListServiceOperations } from './ServiceOperations.js';
import { FixedSizeTypesCodec, INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import { CodecUtil } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/CodecUtil.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';

// ── Message type constants ─────────────────────────────────────────────────────

const LIST_SIZE_REQUEST_TYPE            = 0x050100;
const LIST_SIZE_RESPONSE_TYPE           = 0x050101;
const LIST_CONTAINS_REQUEST_TYPE        = 0x050200;
const LIST_CONTAINS_RESPONSE_TYPE       = 0x050201;
const LIST_CONTAINS_ALL_REQUEST_TYPE    = 0x050300;
const LIST_CONTAINS_ALL_RESPONSE_TYPE   = 0x050301;
const LIST_ADD_REQUEST_TYPE             = 0x050400;
const LIST_ADD_RESPONSE_TYPE            = 0x050401;
const LIST_REMOVE_REQUEST_TYPE          = 0x050500;
const LIST_REMOVE_RESPONSE_TYPE         = 0x050501;
const LIST_ADD_ALL_REQUEST_TYPE         = 0x050600;
const LIST_ADD_ALL_RESPONSE_TYPE        = 0x050601;
const LIST_REMOVE_ALL_REQUEST_TYPE      = 0x050700;
const LIST_REMOVE_ALL_RESPONSE_TYPE     = 0x050701;
const LIST_RETAIN_ALL_REQUEST_TYPE      = 0x050800;
const LIST_RETAIN_ALL_RESPONSE_TYPE     = 0x050801;
const LIST_CLEAR_REQUEST_TYPE           = 0x050900;
const LIST_CLEAR_RESPONSE_TYPE          = 0x050901;
const LIST_ITERATOR_REQUEST_TYPE        = 0x050a00;
const LIST_ITERATOR_RESPONSE_TYPE       = 0x050a01;
const LIST_ADD_LISTENER_REQUEST_TYPE    = 0x050b00;
const LIST_ADD_LISTENER_RESPONSE_TYPE   = 0x050b01;
const LIST_REMOVE_LISTENER_REQUEST_TYPE = 0x050c00;
const LIST_REMOVE_LISTENER_RESPONSE_TYPE = 0x050c01;
const LIST_IS_EMPTY_REQUEST_TYPE        = 0x050d00;
const LIST_IS_EMPTY_RESPONSE_TYPE       = 0x050d01;
const LIST_ADD_ALL_WITH_INDEX_REQUEST_TYPE  = 0x050e00;
const LIST_ADD_ALL_WITH_INDEX_RESPONSE_TYPE = 0x050e01;
const LIST_GET_REQUEST_TYPE             = 0x050f00;
const LIST_GET_RESPONSE_TYPE            = 0x050f01;
const LIST_SET_REQUEST_TYPE             = 0x051000;
const LIST_SET_RESPONSE_TYPE            = 0x051001;
const LIST_ADD_WITH_INDEX_REQUEST_TYPE  = 0x051100;
const LIST_ADD_WITH_INDEX_RESPONSE_TYPE = 0x051101;
const LIST_REMOVE_WITH_INDEX_REQUEST_TYPE  = 0x051200;
const LIST_REMOVE_WITH_INDEX_RESPONSE_TYPE = 0x051201;
const LIST_LAST_INDEX_OF_REQUEST_TYPE   = 0x051300;
const LIST_LAST_INDEX_OF_RESPONSE_TYPE  = 0x051301;
const LIST_INDEX_OF_REQUEST_TYPE        = 0x051400;
const LIST_INDEX_OF_RESPONSE_TYPE       = 0x051401;
const LIST_SUB_LIST_REQUEST_TYPE        = 0x051500;
const LIST_SUB_LIST_RESPONSE_TYPE       = 0x051501;
const LIST_LIST_ITERATOR_REQUEST_TYPE   = 0x051600;
const LIST_LIST_ITERATOR_RESPONSE_TYPE  = 0x051601;

const RESPONSE_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES; // 13

// ── Registration ──────────────────────────────────────────────────────────────

export function registerListServiceHandlers(
    dispatcher: ClientMessageDispatcher,
    operations: ListServiceOperations,
): void {
    dispatcher.register(LIST_SIZE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        return _encodeIntResponse(LIST_SIZE_RESPONSE_TYPE, await operations.size(name));
    });

    dispatcher.register(LIST_CONTAINS_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _encodeBooleanResponse(LIST_CONTAINS_RESPONSE_TYPE, await operations.contains(name, value));
    });

    dispatcher.register(LIST_CONTAINS_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const values = _decodeDataList(iter);
        return _encodeBooleanResponse(LIST_CONTAINS_ALL_RESPONSE_TYPE, await operations.containsAll(name, values));
    });

    dispatcher.register(LIST_ADD_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _encodeBooleanResponse(LIST_ADD_RESPONSE_TYPE, await operations.add(name, value));
    });

    dispatcher.register(LIST_ADD_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const values = _decodeDataList(iter);
        return _encodeBooleanResponse(LIST_ADD_ALL_RESPONSE_TYPE, await operations.addAll(name, values));
    });

    dispatcher.register(LIST_ADD_ALL_WITH_INDEX_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const index = initialFrame.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const values = _decodeDataList(iter);
        return _encodeBooleanResponse(LIST_ADD_ALL_WITH_INDEX_RESPONSE_TYPE, await operations.addAllWithIndex(name, index, values));
    });

    dispatcher.register(LIST_REMOVE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _encodeBooleanResponse(LIST_REMOVE_RESPONSE_TYPE, await operations.remove(name, value));
    });

    dispatcher.register(LIST_REMOVE_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const values = _decodeDataList(iter);
        return _encodeBooleanResponse(LIST_REMOVE_ALL_RESPONSE_TYPE, await operations.removeAll(name, values));
    });

    dispatcher.register(LIST_RETAIN_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const values = _decodeDataList(iter);
        return _encodeBooleanResponse(LIST_RETAIN_ALL_RESPONSE_TYPE, await operations.retainAll(name, values));
    });

    dispatcher.register(LIST_CLEAR_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        await operations.clear(name);
        return _encodeEmptyResponse(LIST_CLEAR_RESPONSE_TYPE);
    });

    dispatcher.register(LIST_GET_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const index = initialFrame.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const value = await operations.get(name, index);
        return _encodeNullableDataResponse(LIST_GET_RESPONSE_TYPE, value);
    });

    dispatcher.register(LIST_SET_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const index = initialFrame.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        const old = await operations.set(name, index, value);
        return _encodeNullableDataResponse(LIST_SET_RESPONSE_TYPE, old);
    });

    dispatcher.register(LIST_ADD_WITH_INDEX_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const index = initialFrame.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        await operations.addWithIndex(name, index, value);
        return _encodeEmptyResponse(LIST_ADD_WITH_INDEX_RESPONSE_TYPE);
    });

    dispatcher.register(LIST_REMOVE_WITH_INDEX_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const index = initialFrame.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const value = await operations.removeWithIndex(name, index);
        return _encodeNullableDataResponse(LIST_REMOVE_WITH_INDEX_RESPONSE_TYPE, value);
    });

    dispatcher.register(LIST_LAST_INDEX_OF_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _encodeIntResponse(LIST_LAST_INDEX_OF_RESPONSE_TYPE, await operations.lastIndexOf(name, value));
    });

    dispatcher.register(LIST_INDEX_OF_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _encodeIntResponse(LIST_INDEX_OF_RESPONSE_TYPE, await operations.indexOf(name, value));
    });

    dispatcher.register(LIST_SUB_LIST_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const from = initialFrame.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const to = initialFrame.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const size = await operations.size(name);
        if (from < 0 || to > size || from > to) {
            throw new Error(`IndexOutOfBoundsException: fromIndex=${from} toIndex=${to}`);
        }
        const items = await operations.subList(name, from, to);
        return _encodeDataListResponse(LIST_SUB_LIST_RESPONSE_TYPE, items);
    });

    dispatcher.register(LIST_ITERATOR_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const items = await operations.iterator(name);
        return _encodeDataListResponse(LIST_ITERATOR_RESPONSE_TYPE, items);
    });

    dispatcher.register(LIST_LIST_ITERATOR_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const startIndex = initialFrame.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const size = await operations.size(name);
        if (startIndex < 0 || startIndex > size) {
            throw new Error(`IndexOutOfBoundsException: index ${startIndex}`);
        }
        const items = await operations.subList(name, startIndex, size);
        return _encodeDataListResponse(LIST_LIST_ITERATOR_RESPONSE_TYPE, items);
    });

    dispatcher.register(LIST_IS_EMPTY_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        return _encodeBooleanResponse(LIST_IS_EMPTY_RESPONSE_TYPE, await operations.isEmpty(name));
    });

    dispatcher.register(LIST_ADD_LISTENER_REQUEST_TYPE, async (msg, session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const includeValue = initialFrame.content.readUInt8(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES) !== 0;
        const name = StringCodec.decode(iter);
        const registrationId = await operations.addItemListener(name, includeValue, msg.getCorrelationId(), session);
        return ListAddListenerCodec.encodeResponse(registrationId);
    });

    dispatcher.register(LIST_REMOVE_LISTENER_REQUEST_TYPE, async (msg, session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const registrationId = FixedSizeTypesCodec.decodeUUID(initialFrame.content, INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        StringCodec.decode(iter);
        if (registrationId === null) {
            throw new Error('registrationId is required');
        }
        const result = await operations.removeItemListener(registrationId, session);
        return _encodeBooleanResponse(LIST_REMOVE_LISTENER_RESPONSE_TYPE, result);
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

function _encodeNullableDataResponse(responseType: number, data: Data | null): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(responseType >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    if (data === null) { msg.add(CM.NULL_FRAME); } else { DataCodec.encode(msg, data); }
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
    for (const item of items) { DataCodec.encode(msg, item); }
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
