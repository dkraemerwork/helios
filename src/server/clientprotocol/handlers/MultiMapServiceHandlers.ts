/**
 * Block C — MultiMap Service Protocol Handlers
 *
 * Registers handlers for all MultiMap opcodes required by hazelcast-client@5.6.x:
 *
 *   MultiMap.Put                (0x020100)
 *   MultiMap.Get                (0x020200)
 *   MultiMap.Remove             (0x020300)
 *   MultiMap.KeySet             (0x020400)
 *   MultiMap.Values             (0x020500)
 *   MultiMap.EntrySet           (0x020600)
 *   MultiMap.ContainsKey        (0x020700)
 *   MultiMap.ContainsValue      (0x020800)
 *   MultiMap.ContainsEntry      (0x020900)
 *   MultiMap.Size               (0x020a00)
 *   MultiMap.Clear              (0x020b00)
 *   MultiMap.ValueCount         (0x020c00)
 *   MultiMap.AddEntryListener   (0x020d00)
 *   MultiMap.RemoveEntryListener (0x020e00)
 *   MultiMap.Lock               (0x020f00)
 *   MultiMap.TryLock            (0x021000)
 *   MultiMap.IsLocked           (0x021100)
 *   MultiMap.Unlock             (0x021200)
 *   MultiMap.ForceUnlock        (0x021300)
 *   MultiMap.RemoveEntry        (0x021400)
 *   MultiMap.PutAll             (0x021500)
 *   MultiMap.Delete             (0x021600)
 */

import type { ClientMessage } from '../../../client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '../../../client/impl/protocol/ClientMessage.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import { MultiMapAddEntryListenerCodec } from '../../../client/impl/protocol/codec/MultiMapAddEntryListenerCodec.js';
import type { MultiMapServiceOperations } from './ServiceOperations.js';
import { FixedSizeTypesCodec, INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES } from '../../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '../../../client/impl/protocol/codec/builtin/StringCodec.js';
import { DataCodec } from '../../../client/impl/protocol/codec/builtin/DataCodec.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';

// ── Message type constants ─────────────────────────────────────────────────────

const MM_PUT_REQUEST            = 0x020100;
const MM_PUT_RESPONSE           = 0x020101;
const MM_GET_REQUEST            = 0x020200;
const MM_GET_RESPONSE           = 0x020201;
const MM_REMOVE_REQUEST         = 0x020300;
const MM_REMOVE_RESPONSE        = 0x020301;
const MM_KEY_SET_REQUEST        = 0x020400;
const MM_KEY_SET_RESPONSE       = 0x020401;
const MM_VALUES_REQUEST         = 0x020500;
const MM_VALUES_RESPONSE        = 0x020501;
const MM_ENTRY_SET_REQUEST      = 0x020600;
const MM_ENTRY_SET_RESPONSE     = 0x020601;
const MM_CONTAINS_KEY_REQUEST   = 0x020700;
const MM_CONTAINS_KEY_RESPONSE  = 0x020701;
const MM_CONTAINS_VALUE_REQUEST = 0x020800;
const MM_CONTAINS_VALUE_RESPONSE = 0x020801;
const MM_CONTAINS_ENTRY_REQUEST = 0x020900;
const MM_CONTAINS_ENTRY_RESPONSE = 0x020901;
const MM_SIZE_REQUEST           = 0x020a00;
const MM_SIZE_RESPONSE          = 0x020a01;
const MM_CLEAR_REQUEST          = 0x020b00;
const MM_CLEAR_RESPONSE         = 0x020b01;
const MM_VALUE_COUNT_REQUEST    = 0x020c00;
const MM_VALUE_COUNT_RESPONSE   = 0x020c01;
const MM_ADD_LISTENER_REQUEST   = 0x020e00;
const MM_ADD_LISTENER_RESPONSE  = 0x020e01;
const MM_REMOVE_LISTENER_REQUEST  = 0x020f00;
const MM_REMOVE_LISTENER_RESPONSE = 0x020f01;
const MM_LOCK_REQUEST           = 0x021000;
const MM_LOCK_RESPONSE          = 0x021001;
const MM_TRY_LOCK_REQUEST       = 0x021100;
const MM_TRY_LOCK_RESPONSE      = 0x021101;
const MM_IS_LOCKED_REQUEST      = 0x021200;
const MM_IS_LOCKED_RESPONSE     = 0x021201;
const MM_UNLOCK_REQUEST         = 0x021300;
const MM_UNLOCK_RESPONSE        = 0x021301;
const MM_FORCE_UNLOCK_REQUEST   = 0x021400;
const MM_FORCE_UNLOCK_RESPONSE  = 0x021401;
const MM_REMOVE_ENTRY_REQUEST   = 0x021500;
const MM_REMOVE_ENTRY_RESPONSE  = 0x021501;
const MM_DELETE_REQUEST         = 0x021600;
const MM_DELETE_RESPONSE        = 0x021601;
const MM_PUT_ALL_REQUEST        = 0x021700;
const MM_PUT_ALL_RESPONSE       = 0x021701;

const RH = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES; // Response header size = 13

// ── Registration ──────────────────────────────────────────────────────────────

export function registerMultiMapServiceHandlers(
    dispatcher: ClientMessageDispatcher,
    operations: MultiMapServiceOperations,
): void {
    // Put
    dispatcher.register(MM_PUT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _bool(MM_PUT_RESPONSE, await operations.put(name, key, value, threadId));
    });

    // Get
    dispatcher.register(MM_GET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _dataList(MM_GET_RESPONSE, await operations.get(name, key, threadId));
    });

    // Remove (returns removed values)
    dispatcher.register(MM_REMOVE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _dataList(MM_REMOVE_RESPONSE, await operations.remove(name, key, threadId));
    });

    // KeySet
    dispatcher.register(MM_KEY_SET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        return _dataList(MM_KEY_SET_RESPONSE, await operations.keySet(name));
    });

    // Values
    dispatcher.register(MM_VALUES_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        return _dataList(MM_VALUES_RESPONSE, await operations.values(name));
    });

    // EntrySet
    dispatcher.register(MM_ENTRY_SET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        return _entryList(MM_ENTRY_SET_RESPONSE, await operations.entrySet(name));
    });

    // ContainsKey
    dispatcher.register(MM_CONTAINS_KEY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _bool(MM_CONTAINS_KEY_RESPONSE, await operations.containsKey(name, key, threadId));
    });

    // ContainsValue
    dispatcher.register(MM_CONTAINS_VALUE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _bool(MM_CONTAINS_VALUE_RESPONSE, await operations.containsValue(name, value));
    });

    // ContainsEntry
    dispatcher.register(MM_CONTAINS_ENTRY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _bool(MM_CONTAINS_ENTRY_RESPONSE, await operations.containsEntry(name, key, value, threadId));
    });

    // Size
    dispatcher.register(MM_SIZE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _int(MM_SIZE_RESPONSE, await operations.size(StringCodec.decode(iter)));
    });

    // Clear
    dispatcher.register(MM_CLEAR_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        await operations.clear(StringCodec.decode(iter));
        return _empty(MM_CLEAR_RESPONSE);
    });

    // ValueCount
    dispatcher.register(MM_VALUE_COUNT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _int(MM_VALUE_COUNT_RESPONSE, await operations.valueCount(name, key, threadId));
    });

    // AddEntryListener
    dispatcher.register(MM_ADD_LISTENER_REQUEST, async (msg, session) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const includeValue = f.content.readUInt8(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES) !== 0;
        const localOnly = f.content.readUInt8(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES) !== 0;
        const name = StringCodec.decode(iter);
        return MultiMapAddEntryListenerCodec.encodeResponse(await operations.addEntryListener(name, includeValue, localOnly, msg.getCorrelationId(), session));
    });

    // RemoveEntryListener
    dispatcher.register(MM_REMOVE_LISTENER_REQUEST, async (msg, session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const registrationId = FixedSizeTypesCodec.decodeUUID(initialFrame.content, INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        StringCodec.decode(iter);
        if (registrationId === null) {
            throw new Error('registrationId is required');
        }
        return _bool(MM_REMOVE_LISTENER_RESPONSE, await operations.removeEntryListener(registrationId, session));
    });

    // Lock
    dispatcher.register(MM_LOCK_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const ttl = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const referenceId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        await operations.lock(name, key, threadId, ttl, referenceId);
        return _empty(MM_LOCK_RESPONSE);
    });

    // TryLock
    dispatcher.register(MM_TRY_LOCK_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const lease = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const timeout = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const referenceId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _bool(MM_TRY_LOCK_RESPONSE, await operations.tryLock(name, key, threadId, lease, timeout, referenceId));
    });

    // IsLocked
    dispatcher.register(MM_IS_LOCKED_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _bool(MM_IS_LOCKED_RESPONSE, await operations.isLocked(name, key));
    });

    // Unlock
    dispatcher.register(MM_UNLOCK_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const referenceId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        await operations.unlock(name, key, threadId, referenceId);
        return _empty(MM_UNLOCK_RESPONSE);
    });

    // ForceUnlock
    dispatcher.register(MM_FORCE_UNLOCK_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        await operations.forceUnlock(name, key);
        return _empty(MM_FORCE_UNLOCK_RESPONSE);
    });

    // RemoveEntry
    dispatcher.register(MM_REMOVE_ENTRY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _bool(MM_REMOVE_ENTRY_RESPONSE, await operations.removeEntry(name, key, value, threadId));
    });

    // PutAll
    dispatcher.register(MM_PUT_ALL_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const values = _decodeDataList(iter);
        await operations.putAll(name, key, values, threadId);
        return _empty(MM_PUT_ALL_RESPONSE);
    });

    // Delete (remove all values for a key)
    dispatcher.register(MM_DELETE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        await operations.remove(name, key, threadId);
        return _empty(MM_DELETE_RESPONSE);
    });
}

// ── Response helpers ──────────────────────────────────────────────────────────

function _empty(t: number): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg;
}

function _bool(t: number, v: boolean): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RH + BOOLEAN_SIZE_IN_BYTES); b.fill(0);
    b.writeUInt32LE(t >>> 0, 0); b.writeUInt8(v ? 1 : 0, RH);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg;
}

function _int(t: number, v: number): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RH + INT_SIZE_IN_BYTES); b.fill(0);
    b.writeUInt32LE(t >>> 0, 0); b.writeInt32LE(v | 0, RH);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg;
}

function _dataList(t: number, items: Data[]): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE));
    msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
    for (const item of items) DataCodec.encode(msg, item);
    msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
    msg.setFinal(); return msg;
}

function _entryList(t: number, entries: Array<[Data, Data]>): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE));
    msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
    for (const [k, v] of entries) { DataCodec.encode(msg, k); DataCodec.encode(msg, v); }
    msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
    msg.setFinal(); return msg;
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
