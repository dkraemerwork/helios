/**
 * Block C — Set Service Protocol Handlers
 *
 * Registers handlers for all Set opcodes required by hazelcast-client@5.6.x:
 *
 *   Set.Size              (0x060100)
 *   Set.Contains          (0x060200)
 *   Set.ContainsAll       (0x060300)
 *   Set.Add               (0x060400)
 *   Set.AddAll            (0x060500)
 *   Set.Remove            (0x060600)
 *   Set.RemoveAll         (0x060700)
 *   Set.RetainAll         (0x060800)
 *   Set.Clear             (0x060900)
 *   Set.GetAll            (0x060a00)
 *   Set.AddListener       (0x060b00)
 *   Set.RemoveListener    (0x060c00)
 *   Set.IsEmpty           (0x060d00)
 */

import type { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import { SetAddListenerCodec } from '@zenystx/helios-core/client/impl/protocol/codec/SetAddListenerCodec.js';
import type { SetServiceOperations } from './ServiceOperations.js';
import { FixedSizeTypesCodec, INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';

// ── Message type constants ─────────────────────────────────────────────────────

const SET_SIZE_REQUEST_TYPE            = 0x060100;
const SET_SIZE_RESPONSE_TYPE           = 0x060101;
const SET_CONTAINS_REQUEST_TYPE        = 0x060200;
const SET_CONTAINS_RESPONSE_TYPE       = 0x060201;
const SET_CONTAINS_ALL_REQUEST_TYPE    = 0x060300;
const SET_CONTAINS_ALL_RESPONSE_TYPE   = 0x060301;
const SET_ADD_REQUEST_TYPE             = 0x060400;
const SET_ADD_RESPONSE_TYPE            = 0x060401;
const SET_REMOVE_REQUEST_TYPE          = 0x060500;
const SET_REMOVE_RESPONSE_TYPE         = 0x060501;
const SET_ADD_ALL_REQUEST_TYPE         = 0x060600;
const SET_ADD_ALL_RESPONSE_TYPE        = 0x060601;
const SET_REMOVE_ALL_REQUEST_TYPE      = 0x060700;
const SET_REMOVE_ALL_RESPONSE_TYPE     = 0x060701;
const SET_RETAIN_ALL_REQUEST_TYPE      = 0x060800;
const SET_RETAIN_ALL_RESPONSE_TYPE     = 0x060801;
const SET_CLEAR_REQUEST_TYPE           = 0x060900;
const SET_CLEAR_RESPONSE_TYPE          = 0x060901;
const SET_GET_ALL_REQUEST_TYPE         = 0x060a00;
const SET_GET_ALL_RESPONSE_TYPE        = 0x060a01;
const SET_ADD_LISTENER_REQUEST_TYPE    = 0x060b00;
const SET_ADD_LISTENER_RESPONSE_TYPE   = 0x060b01;
const SET_REMOVE_LISTENER_REQUEST_TYPE = 0x060c00;
const SET_REMOVE_LISTENER_RESPONSE_TYPE = 0x060c01;
const SET_IS_EMPTY_REQUEST_TYPE        = 0x060d00;
const SET_IS_EMPTY_RESPONSE_TYPE       = 0x060d01;

const RESPONSE_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES; // 13

// ── Registration ──────────────────────────────────────────────────────────────

export function registerSetServiceHandlers(
    dispatcher: ClientMessageDispatcher,
    operations: SetServiceOperations,
): void {
    dispatcher.register(SET_SIZE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _encodeIntResponse(SET_SIZE_RESPONSE_TYPE, await operations.size(StringCodec.decode(iter)));
    });

    dispatcher.register(SET_CONTAINS_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        return _encodeBooleanResponse(SET_CONTAINS_RESPONSE_TYPE, await operations.contains(name, DataCodec.decode(iter)));
    });

    dispatcher.register(SET_CONTAINS_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        return _encodeBooleanResponse(SET_CONTAINS_ALL_RESPONSE_TYPE, await operations.containsAll(name, _decodeDataList(iter)));
    });

    dispatcher.register(SET_ADD_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        return _encodeBooleanResponse(SET_ADD_RESPONSE_TYPE, await operations.add(name, DataCodec.decode(iter)));
    });

    dispatcher.register(SET_ADD_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        return _encodeBooleanResponse(SET_ADD_ALL_RESPONSE_TYPE, await operations.addAll(name, _decodeDataList(iter)));
    });

    dispatcher.register(SET_REMOVE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        return _encodeBooleanResponse(SET_REMOVE_RESPONSE_TYPE, await operations.remove(name, DataCodec.decode(iter)));
    });

    dispatcher.register(SET_REMOVE_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        return _encodeBooleanResponse(SET_REMOVE_ALL_RESPONSE_TYPE, await operations.removeAll(name, _decodeDataList(iter)));
    });

    dispatcher.register(SET_RETAIN_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        return _encodeBooleanResponse(SET_RETAIN_ALL_RESPONSE_TYPE, await operations.retainAll(name, _decodeDataList(iter)));
    });

    dispatcher.register(SET_CLEAR_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        await operations.clear(StringCodec.decode(iter));
        return _encodeEmptyResponse(SET_CLEAR_RESPONSE_TYPE);
    });

    dispatcher.register(SET_GET_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _encodeDataListResponse(SET_GET_ALL_RESPONSE_TYPE, await operations.iterator(StringCodec.decode(iter)));
    });

    dispatcher.register(SET_ADD_LISTENER_REQUEST_TYPE, async (msg, session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const includeValue = initialFrame.content.readUInt8(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES) !== 0;
        const name = StringCodec.decode(iter);
        return SetAddListenerCodec.encodeResponse(await operations.addItemListener(name, includeValue, msg.getCorrelationId(), session));
    });

    dispatcher.register(SET_REMOVE_LISTENER_REQUEST_TYPE, async (msg, session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const registrationId = FixedSizeTypesCodec.decodeUUID(initialFrame.content, INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        StringCodec.decode(iter);
        if (registrationId === null) {
            throw new Error('registrationId is required');
        }
        return _encodeBooleanResponse(SET_REMOVE_LISTENER_RESPONSE_TYPE, await operations.removeItemListener(registrationId, session));
    });

    dispatcher.register(SET_IS_EMPTY_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _encodeBooleanResponse(SET_IS_EMPTY_RESPONSE_TYPE, await operations.isEmpty(StringCodec.decode(iter)));
    });
}

// ── Response helpers ──────────────────────────────────────────────────────────

function _encodeEmptyResponse(responseType: number): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0); buf.writeUInt32LE(responseType >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg;
}

function _encodeBooleanResponse(responseType: number, value: boolean): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE + BOOLEAN_SIZE_IN_BYTES);
    buf.fill(0); buf.writeUInt32LE(responseType >>> 0, 0);
    buf.writeUInt8(value ? 1 : 0, RESPONSE_HEADER_SIZE);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg;
}

function _encodeIntResponse(responseType: number, value: number): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE + INT_SIZE_IN_BYTES);
    buf.fill(0); buf.writeUInt32LE(responseType >>> 0, 0);
    buf.writeInt32LE(value | 0, RESPONSE_HEADER_SIZE);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg;
}

function _encodeDataListResponse(responseType: number, items: Data[]): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0); buf.writeUInt32LE(responseType >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
    for (const item of items) { DataCodec.encode(msg, item); }
    msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
    msg.setFinal(); return msg;
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
