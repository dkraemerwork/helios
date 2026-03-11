/**
 * Block C — Cache Service Protocol Handlers
 *
 * Registers handlers for all Cache (JCache) opcodes required by hazelcast-client@5.6.x:
 *
 *   Cache.Get                     (0x130100)
 *   Cache.GetAll                  (0x130200)
 *   Cache.Put                     (0x130300)
 *   Cache.PutIfAbsent             (0x130400)
 *   Cache.Remove                  (0x130500)
 *   Cache.RemoveAll               (0x130600)
 *   Cache.ContainsKey             (0x130700)
 *   Cache.Replace                 (0x130800)
 *   Cache.Size                    (0x130900)
 *   Cache.Clear                   (0x130a00)
 *   Cache.GetAndRemove            (0x130b00)
 *   Cache.GetAndPut               (0x130c00)
 *   Cache.GetAndReplace           (0x130d00)
 *   Cache.PutAll                  (0x130e00)
 *   Cache.Destroy                 (0x130f00)
 *   Cache.AddInvalidationListener (0x131000)
 *   Cache.RemoveInvalidationListener (0x131100)
 */

import type { ClientMessage } from '../../../client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '../../../client/impl/protocol/ClientMessage.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { CacheServiceOperations } from './ServiceOperations.js';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES } from '../../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '../../../client/impl/protocol/codec/builtin/StringCodec.js';
import { DataCodec } from '../../../client/impl/protocol/codec/builtin/DataCodec.js';
import { CodecUtil } from '../../../client/impl/protocol/codec/builtin/CodecUtil.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';

// ── Message type constants ─────────────────────────────────────────────────────

const CACHE_GET_REQUEST           = 0x130100; const CACHE_GET_RESPONSE           = 0x130101;
const CACHE_GET_ALL_REQUEST       = 0x130200; const CACHE_GET_ALL_RESPONSE       = 0x130201;
const CACHE_PUT_REQUEST           = 0x130300; const CACHE_PUT_RESPONSE           = 0x130301;
const CACHE_PUT_IF_ABSENT_REQUEST = 0x130400; const CACHE_PUT_IF_ABSENT_RESPONSE = 0x130401;
const CACHE_REMOVE_REQUEST        = 0x130500; const CACHE_REMOVE_RESPONSE        = 0x130501;
const CACHE_REMOVE_ALL_REQUEST    = 0x130600; const CACHE_REMOVE_ALL_RESPONSE    = 0x130601;
const CACHE_CONTAINS_KEY_REQUEST  = 0x130700; const CACHE_CONTAINS_KEY_RESPONSE  = 0x130701;
const CACHE_REPLACE_REQUEST       = 0x130800; const CACHE_REPLACE_RESPONSE       = 0x130801;
const CACHE_SIZE_REQUEST          = 0x130900; const CACHE_SIZE_RESPONSE          = 0x130901;
const CACHE_CLEAR_REQUEST         = 0x130a00; const CACHE_CLEAR_RESPONSE         = 0x130a01;
const CACHE_GET_AND_REMOVE_REQUEST = 0x130b00; const CACHE_GET_AND_REMOVE_RESPONSE = 0x130b01;
const CACHE_GET_AND_PUT_REQUEST   = 0x130c00; const CACHE_GET_AND_PUT_RESPONSE   = 0x130c01;
const CACHE_GET_AND_REPLACE_REQUEST = 0x130d00; const CACHE_GET_AND_REPLACE_RESPONSE = 0x130d01;
const CACHE_PUT_ALL_REQUEST       = 0x130e00; const CACHE_PUT_ALL_RESPONSE       = 0x130e01;
const CACHE_DESTROY_REQUEST       = 0x130f00; const CACHE_DESTROY_RESPONSE       = 0x130f01;
const CACHE_ADD_LISTENER_REQUEST  = 0x131000; const CACHE_ADD_LISTENER_RESPONSE  = 0x131001;
const CACHE_REMOVE_LISTENER_REQUEST = 0x131100; const CACHE_REMOVE_LISTENER_RESPONSE = 0x131101;

const RH = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES;

// ── Registration ──────────────────────────────────────────────────────────────

export function registerCacheServiceHandlers(
    dispatcher: ClientMessageDispatcher,
    operations: CacheServiceOperations,
): void {
    // Cache.Get
    dispatcher.register(CACHE_GET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const expiryPolicy = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        return _nullable(CACHE_GET_RESPONSE, await operations.get(name, key, expiryPolicy));
    });

    // Cache.GetAll
    dispatcher.register(CACHE_GET_ALL_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const keys = _decodeDataList(iter);
        const expiryPolicy = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        return _entryList(CACHE_GET_ALL_RESPONSE, await operations.getAll(name, keys, expiryPolicy));
    });

    // Cache.Put
    dispatcher.register(CACHE_PUT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const completionId = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const isGet = f.content.readUInt8(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + INT_SIZE_IN_BYTES) !== 0;
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        const expiryPolicy = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        return _nullable(CACHE_PUT_RESPONSE, await operations.put(name, key, value, expiryPolicy, isGet, completionId));
    });

    // Cache.PutIfAbsent
    dispatcher.register(CACHE_PUT_IF_ABSENT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const completionId = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        const expiryPolicy = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        return _bool(CACHE_PUT_IF_ABSENT_RESPONSE, await operations.putIfAbsent(name, key, value, expiryPolicy, completionId));
    });

    // Cache.Remove
    dispatcher.register(CACHE_REMOVE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const completionId = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const currentValue = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        return _bool(CACHE_REMOVE_RESPONSE, await operations.remove(name, key, currentValue, completionId));
    });

    // Cache.RemoveAll
    dispatcher.register(CACHE_REMOVE_ALL_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const completionId = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const keys = _decodeDataList(iter);
        await operations.removeAll(name, keys.length > 0 ? keys : null, completionId);
        return _empty(CACHE_REMOVE_ALL_RESPONSE);
    });

    // Cache.ContainsKey
    dispatcher.register(CACHE_CONTAINS_KEY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _bool(CACHE_CONTAINS_KEY_RESPONSE, await operations.containsKey(name, key));
    });

    // Cache.Replace
    dispatcher.register(CACHE_REPLACE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const completionId = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const oldValue = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        const newValue = DataCodec.decode(iter);
        const expiryPolicy = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        return _bool(CACHE_REPLACE_RESPONSE, await operations.replace(name, key, oldValue, newValue, expiryPolicy, completionId));
    });

    // Cache.Size
    dispatcher.register(CACHE_SIZE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _int(CACHE_SIZE_RESPONSE, await operations.size(StringCodec.decode(iter)));
    });

    // Cache.Clear
    dispatcher.register(CACHE_CLEAR_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        await operations.clear(StringCodec.decode(iter));
        return _empty(CACHE_CLEAR_RESPONSE);
    });

    // Cache.GetAndRemove
    dispatcher.register(CACHE_GET_AND_REMOVE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const completionId = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _nullable(CACHE_GET_AND_REMOVE_RESPONSE, await operations.getAndRemove(name, key, completionId));
    });

    // Cache.GetAndPut
    dispatcher.register(CACHE_GET_AND_PUT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const completionId = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        const expiryPolicy = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        return _nullable(CACHE_GET_AND_PUT_RESPONSE, await operations.getAndPut(name, key, value, expiryPolicy, completionId));
    });

    // Cache.GetAndReplace
    dispatcher.register(CACHE_GET_AND_REPLACE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const completionId = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        const expiryPolicy = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        return _nullable(CACHE_GET_AND_REPLACE_RESPONSE, await operations.getAndReplace(name, key, value, expiryPolicy, completionId));
    });

    // Cache.PutAll
    dispatcher.register(CACHE_PUT_ALL_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const completionId = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const entries = _decodeEntryList(iter);
        const expiryPolicy = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        await operations.putAll(name, entries, expiryPolicy, completionId);
        return _empty(CACHE_PUT_ALL_RESPONSE);
    });

    // Cache.Destroy
    dispatcher.register(CACHE_DESTROY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        await operations.destroy(StringCodec.decode(iter));
        return _empty(CACHE_DESTROY_RESPONSE);
    });

    // Cache.AddInvalidationListener
    dispatcher.register(CACHE_ADD_LISTENER_REQUEST, async (msg, session) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const localOnly = f.content.readUInt8(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES) !== 0;
        const name = StringCodec.decode(iter);
        return _string(CACHE_ADD_LISTENER_RESPONSE, await operations.addInvalidationListener(name, localOnly, session));
    });

    // Cache.RemoveInvalidationListener
    dispatcher.register(CACHE_REMOVE_LISTENER_REQUEST, async (msg, session) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const registrationId = StringCodec.decode(iter);
        return _bool(CACHE_REMOVE_LISTENER_RESPONSE, await operations.removeInvalidationListener(registrationId, session));
    });
}

// ── Response helpers ──────────────────────────────────────────────────────────

function _empty(t: number): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg; }
function _bool(t: number, v: boolean): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH + BOOLEAN_SIZE_IN_BYTES); b.fill(0); b.writeUInt32LE(t >>> 0, 0); b.writeUInt8(v ? 1 : 0, RH); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg; }
function _int(t: number, v: number): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH + INT_SIZE_IN_BYTES); b.fill(0); b.writeUInt32LE(t >>> 0, 0); b.writeInt32LE(v | 0, RH); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg; }
function _string(t: number, v: string): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); StringCodec.encode(msg, v); msg.setFinal(); return msg; }
function _nullable(t: number, data: Data | null): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); if (data === null) { msg.add(CM.NULL_FRAME); } else { DataCodec.encode(msg, data); } msg.setFinal(); return msg; }
function _entryList(t: number, entries: Array<[Data, Data]>): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG)); for (const [k, v] of entries) { DataCodec.encode(msg, k); DataCodec.encode(msg, v); } msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG)); msg.setFinal(); return msg; }

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
