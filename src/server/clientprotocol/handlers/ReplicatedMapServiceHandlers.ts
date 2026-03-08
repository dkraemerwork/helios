/**
 * Block C — ReplicatedMap Service Protocol Handlers
 *
 * Registers handlers for all ReplicatedMap opcodes required by hazelcast-client@5.6.x:
 *
 *   ReplicatedMap.Put                          (0x0e0100)
 *   ReplicatedMap.Get                          (0x0e0200)
 *   ReplicatedMap.Remove                       (0x0e0300)
 *   ReplicatedMap.Size                         (0x0e0400)
 *   ReplicatedMap.ContainsKey                  (0x0e0500)
 *   ReplicatedMap.ContainsValue                (0x0e0600)
 *   ReplicatedMap.Clear                        (0x0e0700)
 *   ReplicatedMap.KeySet                       (0x0e0800)
 *   ReplicatedMap.Values                       (0x0e0900)
 *   ReplicatedMap.EntrySet                     (0x0e0a00)
 *   ReplicatedMap.PutAll                       (0x0e0b00)
 *   ReplicatedMap.IsEmpty                      (0x0e0c00)
 *   ReplicatedMap.AddEntryListener             (0x0e0d00)
 *   ReplicatedMap.RemoveEntryListener          (0x0e0e00)
 *   ReplicatedMap.AddEntryListenerToKey        (0x0e0f00)
 *   ReplicatedMap.AddEntryListenerWithPredicate (0x0e1000)
 *   ReplicatedMap.AddEntryListenerToKeyWithPredicate (0x0e1100)
 */

import type { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { ReplicatedMapServiceOperations } from './ServiceOperations.js';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import { CodecUtil } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/CodecUtil.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';

// ── Message type constants ─────────────────────────────────────────────────────

const RM_PUT_REQUEST        = 0x0e0100; const RM_PUT_RESPONSE        = 0x0e0101;
const RM_GET_REQUEST        = 0x0e0200; const RM_GET_RESPONSE        = 0x0e0201;
const RM_REMOVE_REQUEST     = 0x0e0300; const RM_REMOVE_RESPONSE     = 0x0e0301;
const RM_SIZE_REQUEST       = 0x0e0400; const RM_SIZE_RESPONSE       = 0x0e0401;
const RM_CONTAINS_KEY_REQUEST  = 0x0e0500; const RM_CONTAINS_KEY_RESPONSE  = 0x0e0501;
const RM_CONTAINS_VALUE_REQUEST = 0x0e0600; const RM_CONTAINS_VALUE_RESPONSE = 0x0e0601;
const RM_CLEAR_REQUEST      = 0x0e0700; const RM_CLEAR_RESPONSE      = 0x0e0701;
const RM_KEY_SET_REQUEST    = 0x0e0800; const RM_KEY_SET_RESPONSE    = 0x0e0801;
const RM_VALUES_REQUEST     = 0x0e0900; const RM_VALUES_RESPONSE     = 0x0e0901;
const RM_ENTRY_SET_REQUEST  = 0x0e0a00; const RM_ENTRY_SET_RESPONSE  = 0x0e0a01;
const RM_PUT_ALL_REQUEST    = 0x0e0b00; const RM_PUT_ALL_RESPONSE    = 0x0e0b01;
const RM_IS_EMPTY_REQUEST   = 0x0e0c00; const RM_IS_EMPTY_RESPONSE   = 0x0e0c01;
const RM_ADD_LISTENER_REQUEST         = 0x0e0d00; const RM_ADD_LISTENER_RESPONSE         = 0x0e0d01;
const RM_REMOVE_LISTENER_REQUEST      = 0x0e0e00; const RM_REMOVE_LISTENER_RESPONSE      = 0x0e0e01;
const RM_ADD_LISTENER_KEY_REQUEST     = 0x0e0f00; const RM_ADD_LISTENER_KEY_RESPONSE     = 0x0e0f01;
const RM_ADD_LISTENER_PRED_REQUEST    = 0x0e1000; const RM_ADD_LISTENER_PRED_RESPONSE    = 0x0e1001;
const RM_ADD_LISTENER_KEY_PRED_REQUEST = 0x0e1100; const RM_ADD_LISTENER_KEY_PRED_RESPONSE = 0x0e1101;

const RH = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES;

// ── Registration ──────────────────────────────────────────────────────────────

export function registerReplicatedMapServiceHandlers(
    dispatcher: ClientMessageDispatcher,
    operations: ReplicatedMapServiceOperations,
): void {
    // Put
    dispatcher.register(RM_PUT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const ttl = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _nullable(RM_PUT_RESPONSE, await operations.put(name, key, value, ttl));
    });

    // Get
    dispatcher.register(RM_GET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _nullable(RM_GET_RESPONSE, await operations.get(name, key));
    });

    // Remove
    dispatcher.register(RM_REMOVE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _nullable(RM_REMOVE_RESPONSE, await operations.remove(name, key));
    });

    // Size
    dispatcher.register(RM_SIZE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _int(RM_SIZE_RESPONSE, await operations.size(StringCodec.decode(iter)));
    });

    // ContainsKey
    dispatcher.register(RM_CONTAINS_KEY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _bool(RM_CONTAINS_KEY_RESPONSE, await operations.containsKey(name, key));
    });

    // ContainsValue
    dispatcher.register(RM_CONTAINS_VALUE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _bool(RM_CONTAINS_VALUE_RESPONSE, await operations.containsValue(name, value));
    });

    // Clear
    dispatcher.register(RM_CLEAR_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        await operations.clear(StringCodec.decode(iter));
        return _empty(RM_CLEAR_RESPONSE);
    });

    // KeySet
    dispatcher.register(RM_KEY_SET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _dataList(RM_KEY_SET_RESPONSE, await operations.keySet(StringCodec.decode(iter)));
    });

    // Values
    dispatcher.register(RM_VALUES_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _dataList(RM_VALUES_RESPONSE, await operations.values(StringCodec.decode(iter)));
    });

    // EntrySet
    dispatcher.register(RM_ENTRY_SET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _entryList(RM_ENTRY_SET_RESPONSE, await operations.entrySet(StringCodec.decode(iter)));
    });

    // PutAll
    dispatcher.register(RM_PUT_ALL_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const entries = _decodeEntryList(iter);
        await operations.putAll(name, entries);
        return _empty(RM_PUT_ALL_RESPONSE);
    });

    // IsEmpty
    dispatcher.register(RM_IS_EMPTY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _bool(RM_IS_EMPTY_RESPONSE, await operations.isEmpty(StringCodec.decode(iter)));
    });

    // AddEntryListener
    dispatcher.register(RM_ADD_LISTENER_REQUEST, async (msg, session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        return _string(RM_ADD_LISTENER_RESPONSE, await operations.addEntryListener(name, session));
    });

    // RemoveEntryListener
    dispatcher.register(RM_REMOVE_LISTENER_REQUEST, async (msg, session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const registrationId = StringCodec.decode(iter);
        return _bool(RM_REMOVE_LISTENER_RESPONSE, await operations.removeEntryListener(registrationId, session));
    });

    // AddEntryListenerToKey
    dispatcher.register(RM_ADD_LISTENER_KEY_REQUEST, async (msg, session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _string(RM_ADD_LISTENER_KEY_RESPONSE, await operations.addEntryListenerWithKey(name, key, session));
    });

    // AddEntryListenerWithPredicate
    dispatcher.register(RM_ADD_LISTENER_PRED_REQUEST, async (msg, session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const predicate = DataCodec.decode(iter);
        return _string(RM_ADD_LISTENER_PRED_RESPONSE, await operations.addEntryListenerWithPredicate(name, predicate, session));
    });

    // AddEntryListenerToKeyWithPredicate
    dispatcher.register(RM_ADD_LISTENER_KEY_PRED_REQUEST, async (msg, session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const predicate = DataCodec.decode(iter);
        return _string(RM_ADD_LISTENER_KEY_PRED_RESPONSE, await operations.addEntryListenerWithKeyAndPredicate(name, key, predicate, session));
    });
}

// ── Response helpers ──────────────────────────────────────────────────────────

function _empty(t: number): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); msg.add(new CM.Frame(b)); msg.setFinal(); return msg; }
function _bool(t: number, v: boolean): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH + BOOLEAN_SIZE_IN_BYTES); b.fill(0); b.writeUInt32LE(t >>> 0, 0); b.writeUInt8(v ? 1 : 0, RH); msg.add(new CM.Frame(b)); msg.setFinal(); return msg; }
function _int(t: number, v: number): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH + INT_SIZE_IN_BYTES); b.fill(0); b.writeUInt32LE(t >>> 0, 0); b.writeInt32LE(v | 0, RH); msg.add(new CM.Frame(b)); msg.setFinal(); return msg; }
function _string(t: number, v: string): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); msg.add(new CM.Frame(b)); StringCodec.encode(msg, v); msg.setFinal(); return msg; }
function _nullable(t: number, data: Data | null): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); msg.add(new CM.Frame(b)); if (data === null) { msg.add(CM.NULL_FRAME); } else { DataCodec.encode(msg, data); } msg.setFinal(); return msg; }
function _dataList(t: number, items: Data[]): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); msg.add(new CM.Frame(b)); msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG)); for (const item of items) DataCodec.encode(msg, item); msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG)); msg.setFinal(); return msg; }
function _entryList(t: number, entries: Array<[Data, Data]>): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); msg.add(new CM.Frame(b)); msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG)); for (const [k, v] of entries) { DataCodec.encode(msg, k); DataCodec.encode(msg, v); } msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG)); msg.setFinal(); return msg; }

function _decodeEntryList(iter: CM.ForwardFrameIterator): Array<[Data, Data]> {
    const entries: Array<[Data, Data]> = [];
    if (!iter.hasNext()) return entries;
    const bf = iter.peekNext();
    if (!bf || !bf.isBeginFrame()) return entries;
    iter.next();
    while (iter.hasNext()) {
        const n = iter.peekNext();
        if (n && n.isEndFrame()) { iter.next(); break; }
        entries.push([DataCodec.decode(iter), DataCodec.decode(iter)]);
    }
    return entries;
}
