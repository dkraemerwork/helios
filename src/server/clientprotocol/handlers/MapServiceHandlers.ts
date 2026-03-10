/**
 * Block C — Map Service Protocol Handlers
 *
 * Registers handlers for all Map opcodes required by hazelcast-client@5.6.x:
 *
 *   Map.Put                 (0x010100)
 *   Map.Get                 (0x010200)
 *   Map.Remove              (0x010300)
 *   Map.Size                (0x012a00)
 *   Map.ContainsKey         (0x010600)
 *   Map.Clear               (0x012d00)
 *   Map.Delete              (0x010900)
 *   Map.Set                 (0x010f00)
 *   Map.AddEntryListener    (0x011900)
 *   Map.RemoveEntryListener (0x011a00)
 *   Map.Lock                (0x011200)
 *   Map.Unlock              (0x011300)
 *   Map.TryLock             (0x011400)
 *   Map.IsLocked            (0x011500)
 *   Map.ForceUnlock         (0x011600)
 *   Map.GetAll              (0x012300)
 *   Map.PutAll              (0x012c00)
 *   Map.GetEntryView        (0x011d00)
 *   Map.Evict               (0x011e00)
 *   Map.EvictAll            (0x011f00)
 *   Map.Flush               (0x010a00)
 *   Map.ContainsValue       (0x010700)
 *   Map.KeySet              (0x012200)
 *   Map.Values              (0x012400)
 *   Map.EntrySet            (0x012500)
 *   Map.TryPut              (0x010c00)
 *   Map.PutIfAbsent         (0x010e00)
 *   Map.Replace             (0x010400)
 *   Map.ReplaceIfSame       (0x010500)
 *   Map.RemoveIfSame        (0x010800)
 *   Map.RemoveInterceptor   (0x012100)
 *   Map.ExecuteOnKey        (0x012e00)
 *   Map.ExecuteOnAllKeys    (0x013000)
 *   Map.ExecuteWithPredicate (0x013100)
 *   Map.ExecuteOnKeys       (0x013200)
 *   Map.SetWithMaxIdle      (0x014700)
 *   Map.PutTransient        (0x010d00)
 *   Map.PutTransientWithMaxIdle (0x014500)
 *   Map.PutIfAbsentWithMaxIdle  (0x014600)
 *   Map.SetTtl              (0x014300)
 *
 * Each handler: decode → dispatch → encode.
 * Handlers are thin — all business logic is in the service layer.
 *
 * Port of Hazelcast Map message tasks.
 */

import type { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { MapPutCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapPutCodec.js';
import { MapGetCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapGetCodec.js';
import { MapRemoveCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapRemoveCodec.js';
import { MapSizeCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapSizeCodec.js';
import { MapContainsKeyCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapContainsKeyCodec.js';
import { MapClearCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapClearCodec.js';
import { MapDeleteCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapDeleteCodec.js';
import { MapSetCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapSetCodec.js';
import { MapAddEntryListenerCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapAddEntryListenerCodec.js';
import { MapGetEntryViewCodec } from '@zenystx/helios-core/client/impl/protocol/codec/MapGetEntryViewCodec.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { ClusteredOperationDispatcher } from '@zenystx/helios-core/spi/impl/ClusteredOperationDispatcher.js';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES, UUID_SIZE_IN_BYTES, FixedSizeTypesCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { CodecUtil } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/CodecUtil.js';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import type { MapServiceOperations } from './ServiceOperations.js';

// ── Message type constants ─────────────────────────────────────────────────────

const MAP_REMOVE_ENTRY_LISTENER_REQUEST_TYPE  = 0x011a00;
const MAP_REMOVE_ENTRY_LISTENER_RESPONSE_TYPE = 0x011a01;
const MAP_LOCK_REQUEST_TYPE       = 0x011000;
const MAP_LOCK_RESPONSE_TYPE      = 0x011001;
const MAP_UNLOCK_REQUEST_TYPE     = 0x011300;
const MAP_UNLOCK_RESPONSE_TYPE    = 0x011301;
const MAP_TRY_LOCK_REQUEST_TYPE   = 0x011100;
const MAP_TRY_LOCK_RESPONSE_TYPE  = 0x011101;
const MAP_IS_LOCKED_REQUEST_TYPE  = 0x011200;
const MAP_IS_LOCKED_RESPONSE_TYPE = 0x011201;
const MAP_FORCE_UNLOCK_REQUEST_TYPE  = 0x013300;
const MAP_FORCE_UNLOCK_RESPONSE_TYPE = 0x013301;
const MAP_GET_ALL_REQUEST_TYPE    = 0x012300;
const MAP_GET_ALL_RESPONSE_TYPE   = 0x012301;
const MAP_PUT_ALL_REQUEST_TYPE    = 0x012c00;
const MAP_PUT_ALL_RESPONSE_TYPE   = 0x012c01;
const MAP_GET_ENTRY_VIEW_REQUEST_TYPE  = 0x011d00;
const MAP_GET_ENTRY_VIEW_RESPONSE_TYPE = 0x011d01;
const MAP_EVICT_REQUEST_TYPE      = 0x011e00;
const MAP_EVICT_RESPONSE_TYPE     = 0x011e01;
const MAP_EVICT_ALL_REQUEST_TYPE  = 0x011f00;
const MAP_EVICT_ALL_RESPONSE_TYPE = 0x011f01;
const MAP_FLUSH_REQUEST_TYPE      = 0x010a00;
const MAP_FLUSH_RESPONSE_TYPE     = 0x010a01;
const MAP_CONTAINS_VALUE_REQUEST_TYPE  = 0x010700;
const MAP_CONTAINS_VALUE_RESPONSE_TYPE = 0x010701;
const MAP_KEY_SET_REQUEST_TYPE    = 0x012200;
const MAP_KEY_SET_RESPONSE_TYPE   = 0x012201;
const MAP_VALUES_REQUEST_TYPE     = 0x012400;
const MAP_VALUES_RESPONSE_TYPE    = 0x012401;
const MAP_ENTRY_SET_REQUEST_TYPE  = 0x012500;
const MAP_ENTRY_SET_RESPONSE_TYPE = 0x012501;
const MAP_TRY_PUT_REQUEST_TYPE    = 0x010c00;
const MAP_TRY_PUT_RESPONSE_TYPE   = 0x010c01;
const MAP_PUT_IF_ABSENT_REQUEST_TYPE  = 0x010e00;
const MAP_PUT_IF_ABSENT_RESPONSE_TYPE = 0x010e01;
const MAP_REPLACE_REQUEST_TYPE    = 0x010400;
const MAP_REPLACE_RESPONSE_TYPE   = 0x010401;
const MAP_REPLACE_IF_SAME_REQUEST_TYPE  = 0x010500;
const MAP_REPLACE_IF_SAME_RESPONSE_TYPE = 0x010501;
const MAP_REMOVE_IF_SAME_REQUEST_TYPE   = 0x010800;
const MAP_REMOVE_IF_SAME_RESPONSE_TYPE  = 0x010801;
const MAP_REMOVE_INTERCEPTOR_REQUEST_TYPE  = 0x012100;
const MAP_REMOVE_INTERCEPTOR_RESPONSE_TYPE = 0x012101;
const MAP_EXECUTE_ON_KEY_REQUEST_TYPE      = 0x012e00;
const MAP_EXECUTE_ON_KEY_RESPONSE_TYPE     = 0x012e01;
const MAP_EXECUTE_ON_ALL_KEYS_REQUEST_TYPE = 0x013000;
const MAP_EXECUTE_ON_ALL_KEYS_RESPONSE_TYPE = 0x013001;
const MAP_EXECUTE_WITH_PREDICATE_REQUEST_TYPE  = 0x013100;
const MAP_EXECUTE_WITH_PREDICATE_RESPONSE_TYPE = 0x013101;
const MAP_EXECUTE_ON_KEYS_REQUEST_TYPE   = 0x013200;
const MAP_EXECUTE_ON_KEYS_RESPONSE_TYPE  = 0x013201;
const MAP_SET_WITH_MAX_IDLE_REQUEST_TYPE = 0x014700;
const MAP_SET_WITH_MAX_IDLE_RESPONSE_TYPE = 0x014701;
const MAP_PUT_TRANSIENT_REQUEST_TYPE     = 0x010d00;
const MAP_PUT_TRANSIENT_RESPONSE_TYPE    = 0x010d01;
const MAP_PUT_TRANSIENT_MAX_IDLE_REQUEST_TYPE  = 0x014500;
const MAP_PUT_TRANSIENT_MAX_IDLE_RESPONSE_TYPE = 0x014501;
const MAP_PUT_IF_ABSENT_MAX_IDLE_REQUEST_TYPE  = 0x014600;
const MAP_PUT_IF_ABSENT_MAX_IDLE_RESPONSE_TYPE = 0x014601;
const MAP_SET_TTL_REQUEST_TYPE    = 0x014300;
const MAP_SET_TTL_RESPONSE_TYPE   = 0x014301;

// Standard response header (messageType + correlationId + backupAcks) = 13 bytes
const RESPONSE_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES; // 13

// ── Registration ──────────────────────────────────────────────────────────────

export interface MapServiceHandlersOptions {
    dispatcher: ClientMessageDispatcher;
    operations: MapServiceOperations;
    clusteredDispatcher?: ClusteredOperationDispatcher;
}

export function registerMapServiceHandlers(opts: MapServiceHandlersOptions): void {
    const { dispatcher, operations } = opts;

    // Map.Put
    dispatcher.register(MapPutCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const req = MapPutCodec.decodeRequest(msg);
        const prev = await operations.put(req.name, req.key, req.value, req.threadId, req.ttl);
        return MapPutCodec.encodeResponse(prev);
    });

    // Map.Get
    dispatcher.register(MapGetCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const req = MapGetCodec.decodeRequest(msg);
        const value = await operations.get(req.name, req.key, req.threadId);
        return MapGetCodec.encodeResponse(value);
    });

    // Map.Remove
    dispatcher.register(MapRemoveCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const req = MapRemoveCodec.decodeRequest(msg);
        const prev = await operations.remove(req.name, req.key, req.threadId);
        return MapRemoveCodec.encodeResponse(prev);
    });

    // Map.Size
    dispatcher.register(MapSizeCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const { name } = MapSizeCodec.decodeRequest(msg);
        const size = await operations.size(name);
        return MapSizeCodec.encodeResponse(size);
    });

    // Map.ContainsKey
    dispatcher.register(MapContainsKeyCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const req = MapContainsKeyCodec.decodeRequest(msg);
        const result = await operations.containsKey(req.name, req.key, req.threadId);
        return MapContainsKeyCodec.encodeResponse(result);
    });

    // Map.Clear
    dispatcher.register(MapClearCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const { name } = MapClearCodec.decodeRequest(msg);
        await operations.clear(name);
        return MapClearCodec.encodeResponse();
    });

    // Map.Delete
    dispatcher.register(MapDeleteCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const req = MapDeleteCodec.decodeRequest(msg);
        await operations.delete(req.name, req.key, req.threadId);
        return MapDeleteCodec.encodeResponse();
    });

    // Map.Set
    dispatcher.register(MapSetCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const req = MapSetCodec.decodeRequest(msg);
        await operations.set(req.name, req.key, req.value, req.threadId, req.ttl);
        return MapSetCodec.encodeResponse();
    });

    // Map.AddEntryListener
    dispatcher.register(MapAddEntryListenerCodec.REQUEST_MESSAGE_TYPE, async (msg, session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const listenerFlags = initialFrame.content.readInt32LE(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES);
        const localOnly = initialFrame.content.readUInt8(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES + INT_SIZE_IN_BYTES) !== 0;
        const name = StringCodec.decode(iter);
        const registrationId = await operations.addEntryListener(name, listenerFlags, localOnly, msg.getCorrelationId(), session);
        return _encodeListenerRegistrationResponse(0x011901, registrationId);
    });

    // Map.RemoveEntryListener
    dispatcher.register(MAP_REMOVE_ENTRY_LISTENER_REQUEST_TYPE, async (msg, session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const registrationId = initialFrame.content.length >= CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES + UUID_SIZE_IN_BYTES
            ? FixedSizeTypesCodec.decodeUUID(initialFrame.content, CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES)
            : null;
        const fallbackRegistrationId = iter.hasNext() ? StringCodec.decode(iter) : null;
        const resolvedRegistrationId = registrationId ?? fallbackRegistrationId;
        if (resolvedRegistrationId === null) {
            throw new Error('registrationId is required');
        }
        const removed = await operations.removeEntryListener(resolvedRegistrationId, session);
        return _encodeBooleanResponse(MAP_REMOVE_ENTRY_LISTENER_RESPONSE_TYPE, removed);
    });

    // Map.Lock
    dispatcher.register(MAP_LOCK_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const ttl = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const referenceId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        await operations.lock(name, key, threadId, ttl, referenceId);
        return _encodeEmptyResponse(MAP_LOCK_RESPONSE_TYPE);
    });

    // Map.Unlock
    dispatcher.register(MAP_UNLOCK_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const referenceId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        await operations.unlock(name, key, threadId, referenceId);
        return _encodeEmptyResponse(MAP_UNLOCK_RESPONSE_TYPE);
    });

    // Map.TryLock
    dispatcher.register(MAP_TRY_LOCK_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const lease = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const timeout = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const referenceId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const result = await operations.tryLock(name, key, threadId, lease, timeout, referenceId);
        return _encodeBooleanResponse(MAP_TRY_LOCK_RESPONSE_TYPE, result);
    });

    // Map.IsLocked
    dispatcher.register(MAP_IS_LOCKED_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const result = await operations.isLocked(name, key);
        return _encodeBooleanResponse(MAP_IS_LOCKED_RESPONSE_TYPE, result);
    });

    // Map.ForceUnlock
    dispatcher.register(MAP_FORCE_UNLOCK_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const referenceId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        await operations.forceUnlock(name, key, referenceId);
        return _encodeEmptyResponse(MAP_FORCE_UNLOCK_RESPONSE_TYPE);
    });

    // Map.GetAll — returns a list of (key,value) pairs
    dispatcher.register(MAP_GET_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const keys = _decodeDataList(iter);
        const entries = await operations.getAll(name, keys);
        return _encodeEntryListResponse(MAP_GET_ALL_RESPONSE_TYPE, entries);
    });

    // Map.PutAll
    dispatcher.register(MAP_PUT_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const triggerMapLoader = initialFrame.content.length > (INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES)
            ? initialFrame.content.readUInt8(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES) !== 0
            : false;
        const name = StringCodec.decode(iter);
        const entries = _decodeEntryList(iter);
        await operations.putAll(name, entries, triggerMapLoader);
        return _encodeEmptyResponse(MAP_PUT_ALL_RESPONSE_TYPE);
    });

    // Map.GetEntryView
    dispatcher.register(MAP_GET_ENTRY_VIEW_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const view = await operations.getEntryView(name, key, threadId);
        return MapGetEntryViewCodec.encodeResponse(view, BigInt(view?.getMaxIdle() ?? -1));
    });

    // Map.Evict
    dispatcher.register(MAP_EVICT_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const evicted = await operations.evict(name, key, threadId);
        return _encodeBooleanResponse(MAP_EVICT_RESPONSE_TYPE, evicted);
    });

    // Map.EvictAll
    dispatcher.register(MAP_EVICT_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        await operations.evictAll(name);
        return _encodeEmptyResponse(MAP_EVICT_ALL_RESPONSE_TYPE);
    });

    // Map.Flush
    dispatcher.register(MAP_FLUSH_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        await operations.flush(name);
        return _encodeEmptyResponse(MAP_FLUSH_RESPONSE_TYPE);
    });

    // Map.ContainsValue
    dispatcher.register(MAP_CONTAINS_VALUE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        const result = await operations.containsValue(name, value);
        return _encodeBooleanResponse(MAP_CONTAINS_VALUE_RESPONSE_TYPE, result);
    });

    // Map.KeySet
    dispatcher.register(MAP_KEY_SET_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const keys = await operations.keySet(name);
        return _encodeDataListResponse(MAP_KEY_SET_RESPONSE_TYPE, keys);
    });

    // Map.Values
    dispatcher.register(MAP_VALUES_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const values = await operations.values(name);
        return _encodeDataListResponse(MAP_VALUES_RESPONSE_TYPE, values);
    });

    // Map.EntrySet
    dispatcher.register(MAP_ENTRY_SET_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const entries = await operations.entrySet(name);
        return _encodeEntryListResponse(MAP_ENTRY_SET_RESPONSE_TYPE, entries);
    });

    // Map.TryPut
    dispatcher.register(MAP_TRY_PUT_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const timeout = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        const result = await operations.tryPut(name, key, value, threadId, timeout);
        return _encodeBooleanResponse(MAP_TRY_PUT_RESPONSE_TYPE, result);
    });

    // Map.PutIfAbsent
    dispatcher.register(MAP_PUT_IF_ABSENT_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const ttl = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        const prev = await operations.putIfAbsent(name, key, value, threadId, ttl);
        return _encodeNullableDataResponse(MAP_PUT_IF_ABSENT_RESPONSE_TYPE, prev);
    });

    // Map.Replace
    dispatcher.register(MAP_REPLACE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        const prev = await operations.replace(name, key, value, threadId);
        return _encodeNullableDataResponse(MAP_REPLACE_RESPONSE_TYPE, prev);
    });

    // Map.ReplaceIfSame
    dispatcher.register(MAP_REPLACE_IF_SAME_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const oldValue = DataCodec.decode(iter);
        const newValue = DataCodec.decode(iter);
        const result = await operations.replaceIfSame(name, key, oldValue, newValue, threadId);
        return _encodeBooleanResponse(MAP_REPLACE_IF_SAME_RESPONSE_TYPE, result);
    });

    // Map.RemoveIfSame
    dispatcher.register(MAP_REMOVE_IF_SAME_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        const result = await operations.removeIfSame(name, key, value, threadId);
        return _encodeBooleanResponse(MAP_REMOVE_IF_SAME_RESPONSE_TYPE, result);
    });

    // Map.RemoveInterceptor
    dispatcher.register(MAP_REMOVE_INTERCEPTOR_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const id = StringCodec.decode(iter);
        const removed = await operations.removeInterceptor(name, id);
        return _encodeBooleanResponse(MAP_REMOVE_INTERCEPTOR_RESPONSE_TYPE, removed);
    });

    // Map.ExecuteOnKey
    dispatcher.register(MAP_EXECUTE_ON_KEY_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const entryProcessor = DataCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const result = await operations.executeOnKey(name, key, entryProcessor, threadId);
        return _encodeNullableDataResponse(MAP_EXECUTE_ON_KEY_RESPONSE_TYPE, result);
    });

    // Map.ExecuteOnAllKeys
    dispatcher.register(MAP_EXECUTE_ON_ALL_KEYS_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const entryProcessor = DataCodec.decode(iter);
        const entries = await operations.executeOnAllKeys(name, entryProcessor);
        return _encodeEntryListResponse(MAP_EXECUTE_ON_ALL_KEYS_RESPONSE_TYPE, entries);
    });

    // Map.ExecuteWithPredicate
    dispatcher.register(MAP_EXECUTE_WITH_PREDICATE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const entryProcessor = DataCodec.decode(iter);
        const predicate = DataCodec.decode(iter);
        const entries = await operations.executeWithPredicate(name, entryProcessor, predicate);
        return _encodeEntryListResponse(MAP_EXECUTE_WITH_PREDICATE_RESPONSE_TYPE, entries);
    });

    // Map.ExecuteOnKeys
    dispatcher.register(MAP_EXECUTE_ON_KEYS_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const entryProcessor = DataCodec.decode(iter);
        const keys = _decodeDataList(iter);
        const entries = await operations.executeOnKeys(name, keys, entryProcessor);
        return _encodeEntryListResponse(MAP_EXECUTE_ON_KEYS_RESPONSE_TYPE, entries);
    });

    // Map.SetWithMaxIdle
    dispatcher.register(MAP_SET_WITH_MAX_IDLE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const ttl = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const maxIdle = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        await operations.set(name, key, value, threadId, ttl);
        return _encodeEmptyResponse(MAP_SET_WITH_MAX_IDLE_RESPONSE_TYPE);
    });

    // Map.PutTransient
    dispatcher.register(MAP_PUT_TRANSIENT_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const ttl = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        await operations.set(name, key, value, threadId, ttl);
        return _encodeEmptyResponse(MAP_PUT_TRANSIENT_RESPONSE_TYPE);
    });

    // Map.PutTransientWithMaxIdle
    dispatcher.register(MAP_PUT_TRANSIENT_MAX_IDLE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const ttl = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        await operations.set(name, key, value, threadId, ttl);
        return _encodeEmptyResponse(MAP_PUT_TRANSIENT_MAX_IDLE_RESPONSE_TYPE);
    });

    // Map.PutIfAbsentWithMaxIdle
    dispatcher.register(MAP_PUT_IF_ABSENT_MAX_IDLE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const ttl = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        const prev = await operations.putIfAbsent(name, key, value, threadId, ttl);
        return _encodeNullableDataResponse(MAP_PUT_IF_ABSENT_MAX_IDLE_RESPONSE_TYPE, prev);
    });

    // Map.SetTtl
    dispatcher.register(MAP_SET_TTL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const ttl = initialFrame.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const result = await operations.setTtl(name, key, ttl);
        return _encodeBooleanResponse(MAP_SET_TTL_RESPONSE_TYPE, result);
    });
}

// ── Response helpers ──────────────────────────────────────────────────────────

import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';

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

function _encodeListenerRegistrationResponse(responseType: number, registrationId: string): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE + UUID_SIZE_IN_BYTES);
    buf.fill(0);
    buf.writeUInt32LE(responseType >>> 0, 0);
    FixedSizeTypesCodec.encodeUUID(buf, RESPONSE_HEADER_SIZE, registrationId);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
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

function _encodeEntryListResponse(responseType: number, entries: Array<[Data, Data]>): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(responseType >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
    for (const [k, v] of entries) {
        DataCodec.encode(msg, k);
        DataCodec.encode(msg, v);
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
    iter.next(); // consume BEGIN
    while (iter.hasNext()) {
        const next = iter.peekNext();
        if (next && next.isEndFrame()) { iter.next(); break; }
        if (next && next.isNullFrame()) { iter.next(); continue; }
        items.push(DataCodec.decode(iter));
    }
    return items;
}

function _decodeEntryList(iter: CM.ForwardFrameIterator): Array<[Data, Data]> {
    const entries: Array<[Data, Data]> = [];
    if (!iter.hasNext()) return entries;
    const beginFrame = iter.peekNext();
    if (!beginFrame || !beginFrame.isBeginFrame()) return entries;
    iter.next(); // consume BEGIN
    while (iter.hasNext()) {
        const next = iter.peekNext();
        if (next && next.isEndFrame()) { iter.next(); break; }
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        entries.push([key, value]);
    }
    return entries;
}
