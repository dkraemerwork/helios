/**
 * Block C — Map Service Protocol Handlers
 *
 * Registers handlers for all Map opcodes required by hazelcast-client@5.6.x:
 *
 *   Map.Put                              (0x010100)
 *   Map.Get                              (0x010200)
 *   Map.Remove                           (0x010300)
 *   Map.Size                             (0x012a00)
 *   Map.ContainsKey                      (0x010600)
 *   Map.Clear                            (0x012d00)
 *   Map.Delete                           (0x010900)
 *   Map.Set                              (0x010f00)
 *   Map.AddEntryListener                 (0x011900)
 *   Map.RemoveEntryListener              (0x011a00)
 *   Map.Lock                             (0x011200)
 *   Map.Unlock                           (0x011300)
 *   Map.TryLock                          (0x011400)
 *   Map.IsLocked                         (0x011500)
 *   Map.ForceUnlock                      (0x013300)
 *   Map.GetAll                           (0x012300)
 *   Map.PutAll                           (0x012c00)
 *   Map.GetEntryView                     (0x011d00)
 *   Map.Evict                            (0x011e00)
 *   Map.EvictAll                         (0x011f00)
 *   Map.Flush                            (0x010a00)
 *   Map.ContainsValue                    (0x010700)
 *   Map.KeySet                           (0x012200)
 *   Map.Values                           (0x012400)
 *   Map.EntrySet                         (0x012500)
 *   Map.TryPut                           (0x010c00)
 *   Map.PutIfAbsent                      (0x010e00)
 *   Map.Replace                          (0x010400)
 *   Map.ReplaceIfSame                    (0x010500)
 *   Map.RemoveIfSame                     (0x010800)
 *   Map.RemoveInterceptor                (0x014800)
 *   Map.ExecuteOnKey                     (0x012e00)
 *   Map.ExecuteOnAllKeys                 (0x013000)
 *   Map.ExecuteWithPredicate             (0x013100)
 *   Map.ExecuteOnKeys                    (0x013200)
 *   Map.SetWithMaxIdle                   (0x014700)
 *   Map.PutTransient                     (0x010d00)
 *   Map.PutTransientWithMaxIdle          (0x014500)
 *   Map.PutIfAbsentWithMaxIdle           (0x014600)
 *   Map.SetTtl                           (0x014300)
 *   Map.TryRemove                        (0x010b00)
 *   Map.AddEntryListenerToKeyWithPred    (0x011600)
 *   Map.AddEntryListenerWithPredicate    (0x011700)
 *   Map.AddEntryListenerToKey            (0x011800)
 *   Map.LoadAll                          (0x012000)
 *   Map.LoadGivenKeys                    (0x012100)
 *   Map.KeySetWithPredicate              (0x012600)
 *   Map.ValuesWithPredicate              (0x012700)
 *   Map.EntriesWithPredicate             (0x012800)
 *   Map.AddIndex                         (0x012900)
 *   Map.IsEmpty                          (0x012b00)
 *   Map.KeySetWithPagingPredicate        (0x013400)
 *   Map.ValuesWithPagingPredicate        (0x013500)
 *   Map.EntriesWithPagingPredicate       (0x013600)
 *   Map.Aggregate                        (0x013900)
 *   Map.AggregateWithPredicate           (0x013a00)
 *   Map.Project                          (0x013b00)
 *   Map.ProjectWithPredicate             (0x013c00)
 *   Map.RemoveAll                        (0x013e00)
 *   Map.PutWithMaxIdle                   (0x014400)
 *
 * Each handler: decode → dispatch → encode.
 * Handlers are thin — all business logic is in the service layer.
 *
 * Port of Hazelcast Map message tasks.
 */

import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { ClusteredOperationDispatcher } from '@zenystx/helios-core/spi/impl/ClusteredOperationDispatcher.js';
import type { ClientMessage } from '../../../client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '../../../client/impl/protocol/ClientMessage.js';
import { CodecUtil } from '../../../client/impl/protocol/codec/builtin/CodecUtil.js';
import { DataCodec } from '../../../client/impl/protocol/codec/builtin/DataCodec.js';
import { BOOLEAN_SIZE_IN_BYTES, FixedSizeTypesCodec, INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, UUID_SIZE_IN_BYTES } from '../../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { ListIntegerCodec } from '../../../client/impl/protocol/codec/builtin/ListIntegerCodec.js';
import { ListMultiFrameCodec } from '../../../client/impl/protocol/codec/builtin/ListMultiFrameCodec.js';
import { StringCodec } from '../../../client/impl/protocol/codec/builtin/StringCodec.js';
import { MapAddEntryListenerCodec } from '../../../client/impl/protocol/codec/MapAddEntryListenerCodec.js';
import { MapClearCodec } from '../../../client/impl/protocol/codec/MapClearCodec.js';
import { MapContainsKeyCodec } from '../../../client/impl/protocol/codec/MapContainsKeyCodec.js';
import { MapDeleteCodec } from '../../../client/impl/protocol/codec/MapDeleteCodec.js';
import { MapGetCodec } from '../../../client/impl/protocol/codec/MapGetCodec.js';
import { MapGetEntryViewCodec } from '../../../client/impl/protocol/codec/MapGetEntryViewCodec.js';
import { MapPutCodec } from '../../../client/impl/protocol/codec/MapPutCodec.js';
import { MapRemoveCodec } from '../../../client/impl/protocol/codec/MapRemoveCodec.js';
import { MapSetCodec } from '../../../client/impl/protocol/codec/MapSetCodec.js';
import { MapSizeCodec } from '../../../client/impl/protocol/codec/MapSizeCodec.js';
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
const MAP_ADD_INTERCEPTOR_REQUEST_TYPE     = 0x014900;
const MAP_ADD_INTERCEPTOR_RESPONSE_TYPE    = 0x014901;
const MAP_REMOVE_INTERCEPTOR_REQUEST_TYPE  = 0x014800;
const MAP_REMOVE_INTERCEPTOR_RESPONSE_TYPE = 0x014801;
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
const MAP_TRY_REMOVE_REQUEST_TYPE = 0x010b00;
const MAP_TRY_REMOVE_RESPONSE_TYPE = 0x010b01;
const MAP_IS_EMPTY_REQUEST_TYPE   = 0x012b00;
const MAP_IS_EMPTY_RESPONSE_TYPE  = 0x012b01;
const MAP_PUT_WITH_MAX_IDLE_REQUEST_TYPE  = 0x014400;
const MAP_PUT_WITH_MAX_IDLE_RESPONSE_TYPE = 0x014401;
const MAP_LOAD_ALL_REQUEST_TYPE   = 0x012000;
const MAP_LOAD_ALL_RESPONSE_TYPE  = 0x012001;
const MAP_LOAD_GIVEN_KEYS_REQUEST_TYPE  = 0x012100;
const MAP_LOAD_GIVEN_KEYS_RESPONSE_TYPE = 0x012101;
const MAP_KEY_SET_WITH_PREDICATE_REQUEST_TYPE  = 0x012600;
const MAP_KEY_SET_WITH_PREDICATE_RESPONSE_TYPE = 0x012601;
const MAP_VALUES_WITH_PREDICATE_REQUEST_TYPE   = 0x012700;
const MAP_VALUES_WITH_PREDICATE_RESPONSE_TYPE  = 0x012701;
const MAP_ENTRIES_WITH_PREDICATE_REQUEST_TYPE  = 0x012800;
const MAP_ENTRIES_WITH_PREDICATE_RESPONSE_TYPE = 0x012801;
const MAP_ADD_INDEX_REQUEST_TYPE  = 0x012900;
const MAP_ADD_INDEX_RESPONSE_TYPE = 0x012901;
const MAP_KEY_SET_WITH_PAGING_PREDICATE_REQUEST_TYPE  = 0x013400;
const MAP_KEY_SET_WITH_PAGING_PREDICATE_RESPONSE_TYPE = 0x013401;
const MAP_VALUES_WITH_PAGING_PREDICATE_REQUEST_TYPE   = 0x013500;
const MAP_VALUES_WITH_PAGING_PREDICATE_RESPONSE_TYPE  = 0x013501;
const MAP_ENTRIES_WITH_PAGING_PREDICATE_REQUEST_TYPE  = 0x013600;
const MAP_ENTRIES_WITH_PAGING_PREDICATE_RESPONSE_TYPE = 0x013601;
const MAP_AGGREGATE_REQUEST_TYPE  = 0x013900;
const MAP_AGGREGATE_RESPONSE_TYPE = 0x013901;
const MAP_AGGREGATE_WITH_PREDICATE_REQUEST_TYPE  = 0x013a00;
const MAP_AGGREGATE_WITH_PREDICATE_RESPONSE_TYPE = 0x013a01;
const MAP_REMOVE_ALL_REQUEST_TYPE = 0x013e00;
const MAP_REMOVE_ALL_RESPONSE_TYPE = 0x013e01;
const MAP_PROJECT_REQUEST_TYPE = 0x013b00;
const MAP_PROJECT_RESPONSE_TYPE = 0x013b01;
const MAP_PROJECT_WITH_PREDICATE_REQUEST_TYPE = 0x013c00;
const MAP_PROJECT_WITH_PREDICATE_RESPONSE_TYPE = 0x013c01;
const MAP_ENTRY_LISTENER_TO_KEY_WITH_PREDICATE_REQUEST_TYPE = 0x011600;
const MAP_ENTRY_LISTENER_WITH_PREDICATE_REQUEST_TYPE        = 0x011700;
const MAP_ENTRY_LISTENER_TO_KEY_REQUEST_TYPE                = 0x011800;

// Event Journal opcodes
const MAP_EVENT_JOURNAL_SUBSCRIBE_REQUEST_TYPE  = 0x014100;
const MAP_EVENT_JOURNAL_SUBSCRIBE_RESPONSE_TYPE = 0x014101;
const MAP_EVENT_JOURNAL_READ_REQUEST_TYPE       = 0x014200;
const MAP_EVENT_JOURNAL_READ_RESPONSE_TYPE      = 0x014201;

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

    // Map.AddInterceptor (0x014900)
    dispatcher.register(MAP_ADD_INTERCEPTOR_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const interceptorData = DataCodec.decode(iter);
        const id = await operations.addInterceptor(name, interceptorData);
        return _encodeStringResponse(MAP_ADD_INTERCEPTOR_RESPONSE_TYPE, id);
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

    // Map.TryRemove (0x010b00)
    dispatcher.register(MAP_TRY_REMOVE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES);
        const timeout = initialFrame.content.readBigInt64LE(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const result = await operations.tryRemove(name, key, threadId, timeout);
        return _encodeBooleanResponse(MAP_TRY_REMOVE_RESPONSE_TYPE, result);
    });

    // Map.IsEmpty (0x012b00)
    dispatcher.register(MAP_IS_EMPTY_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const result = await operations.isEmpty(name);
        return _encodeBooleanResponse(MAP_IS_EMPTY_RESPONSE_TYPE, result);
    });

    // Map.PutWithMaxIdle (0x014400)
    dispatcher.register(MAP_PUT_WITH_MAX_IDLE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES);
        const ttl = initialFrame.content.readBigInt64LE(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const maxIdle = initialFrame.content.readBigInt64LE(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        const prev = await operations.putWithMaxIdle(name, key, value, threadId, ttl, maxIdle);
        return _encodeNullableDataResponse(MAP_PUT_WITH_MAX_IDLE_RESPONSE_TYPE, prev);
    });

    // Map.LoadAll (0x012000)
    dispatcher.register(MAP_LOAD_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const replaceExistingValues = initialFrame.content.readUInt8(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES) !== 0;
        const name = StringCodec.decode(iter);
        await operations.loadAll(name, replaceExistingValues);
        return _encodeEmptyResponse(MAP_LOAD_ALL_RESPONSE_TYPE);
    });

    // Map.LoadGivenKeys (0x012100)
    dispatcher.register(MAP_LOAD_GIVEN_KEYS_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const replaceExistingValues = initialFrame.content.readUInt8(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES) !== 0;
        const name = StringCodec.decode(iter);
        const keys = _decodeDataList(iter);
        await operations.loadGivenKeys(name, keys, replaceExistingValues);
        return _encodeEmptyResponse(MAP_LOAD_GIVEN_KEYS_RESPONSE_TYPE);
    });

    // Map.KeySetWithPredicate (0x012600)
    dispatcher.register(MAP_KEY_SET_WITH_PREDICATE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const predicate = DataCodec.decode(iter);
        const keys = await operations.keySetWithPredicate(name, predicate);
        return _encodeDataListResponse(MAP_KEY_SET_WITH_PREDICATE_RESPONSE_TYPE, keys);
    });

    // Map.ValuesWithPredicate (0x012700)
    dispatcher.register(MAP_VALUES_WITH_PREDICATE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const predicate = DataCodec.decode(iter);
        const values = await operations.valuesWithPredicate(name, predicate);
        return _encodeDataListResponse(MAP_VALUES_WITH_PREDICATE_RESPONSE_TYPE, values);
    });

    // Map.EntriesWithPredicate (0x012800)
    dispatcher.register(MAP_ENTRIES_WITH_PREDICATE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const predicate = DataCodec.decode(iter);
        const entries = await operations.entriesWithPredicate(name, predicate);
        return _encodeEntryListResponse(MAP_ENTRIES_WITH_PREDICATE_RESPONSE_TYPE, entries);
    });

    // Map.AddIndex (0x012900)
    // IndexConfig is encoded as structured wire frames (not Data serialization)
    dispatcher.register(MAP_ADD_INDEX_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next(); // consume initial frame
        const name = StringCodec.decode(iter);
        // Decode IndexConfigCodec: BEGIN_FRAME, initialFrame(type:int), nullable name, List<string>, nullable bitmapIndexOptions, END_FRAME
        const indexType = _decodeIndexType(iter);
        const indexAttributes = _decodeIndexAttributes(iter);
        await operations.addIndex(name, indexType, indexAttributes);
        return _encodeEmptyResponse(MAP_ADD_INDEX_RESPONSE_TYPE);
    });

    // Map.RemoveAll (0x013e00)
    dispatcher.register(MAP_REMOVE_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const predicate = DataCodec.decode(iter);
        await operations.removeAll(name, predicate);
        return _encodeEmptyResponse(MAP_REMOVE_ALL_RESPONSE_TYPE);
    });

    // Map.Aggregate (0x013900)
    dispatcher.register(MAP_AGGREGATE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const aggregator = DataCodec.decode(iter);
        const result = await operations.aggregate(name, aggregator);
        return _encodeNullableDataResponse(MAP_AGGREGATE_RESPONSE_TYPE, result);
    });

    // Map.AggregateWithPredicate (0x013a00)
    dispatcher.register(MAP_AGGREGATE_WITH_PREDICATE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const aggregator = DataCodec.decode(iter);
        const predicate = DataCodec.decode(iter);
        const result = await operations.aggregateWithPredicate(name, aggregator, predicate);
        return _encodeNullableDataResponse(MAP_AGGREGATE_WITH_PREDICATE_RESPONSE_TYPE, result);
    });

    // Map.Project (0x013b00)
    dispatcher.register(MAP_PROJECT_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const projection = DataCodec.decode(iter);
        const items = await operations.project(name, projection);
        return _encodeNullableDataListResponse(MAP_PROJECT_RESPONSE_TYPE, items);
    });

    // Map.ProjectWithPredicate (0x013c00)
    dispatcher.register(MAP_PROJECT_WITH_PREDICATE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const projection = DataCodec.decode(iter);
        const predicate = DataCodec.decode(iter);
        const items = await operations.projectWithPredicate(name, projection, predicate);
        return _encodeNullableDataListResponse(MAP_PROJECT_WITH_PREDICATE_RESPONSE_TYPE, items);
    });

    // Map.AddEntryListenerToKeyWithPredicate (0x011600)
    // Wire: initial frame: includeValue(bool), listenerFlags(int), localOnly(bool); name, key, predicate
    dispatcher.register(MAP_ENTRY_LISTENER_TO_KEY_WITH_PREDICATE_REQUEST_TYPE, async (msg, session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const includeValue = initialFrame.content.readUInt8(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES) !== 0;
        const listenerFlags = initialFrame.content.readInt32LE(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES);
        const localOnly = initialFrame.content.readUInt8(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES + INT_SIZE_IN_BYTES) !== 0;
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const predicate = DataCodec.decode(iter);
        const registrationId = await operations.addEntryListenerToKeyWithPredicate(
            name, key, predicate, includeValue, listenerFlags, localOnly, msg.getCorrelationId(), session,
        );
        return _encodeListenerRegistrationResponse(0x011601, registrationId);
    });

    // Map.AddEntryListenerWithPredicate (0x011700)
    // Wire: initial frame: includeValue(bool), listenerFlags(int), localOnly(bool); name, predicate
    dispatcher.register(MAP_ENTRY_LISTENER_WITH_PREDICATE_REQUEST_TYPE, async (msg, session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const includeValue = initialFrame.content.readUInt8(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES) !== 0;
        const listenerFlags = initialFrame.content.readInt32LE(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES);
        const localOnly = initialFrame.content.readUInt8(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES + INT_SIZE_IN_BYTES) !== 0;
        const name = StringCodec.decode(iter);
        const predicate = DataCodec.decode(iter);
        const registrationId = await operations.addEntryListenerWithPredicate(
            name, predicate, includeValue, listenerFlags, localOnly, msg.getCorrelationId(), session,
        );
        return _encodeListenerRegistrationResponse(0x011701, registrationId);
    });

    // Map.AddEntryListenerToKey (0x011800)
    // Wire: initial frame: includeValue(bool), listenerFlags(int), localOnly(bool); name, key
    dispatcher.register(MAP_ENTRY_LISTENER_TO_KEY_REQUEST_TYPE, async (msg, session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const includeValue = initialFrame.content.readUInt8(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES) !== 0;
        const listenerFlags = initialFrame.content.readInt32LE(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES);
        const localOnly = initialFrame.content.readUInt8(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES + INT_SIZE_IN_BYTES) !== 0;
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const registrationId = await operations.addEntryListenerToKey(
            name, key, includeValue, listenerFlags, localOnly, msg.getCorrelationId(), session,
        );
        return _encodeListenerRegistrationResponse(0x011801, registrationId);
    });

    // Map.KeySetWithPagingPredicate (0x013400)
    // Decodes PagingPredicateHolder, extracts inner predicate (if any), returns keys + empty anchor list
    dispatcher.register(MAP_KEY_SET_WITH_PAGING_PREDICATE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next(); // initial frame
        const name = StringCodec.decode(iter);
        const predicateData = _decodePagingPredicateInnerPredicate(iter);
        const keys = predicateData !== null
            ? await operations.keySetWithPredicate(name, predicateData)
            : await operations.keySet(name);
        return _encodePagingPredicateKeySetResponse(MAP_KEY_SET_WITH_PAGING_PREDICATE_RESPONSE_TYPE, keys);
    });

    // Map.ValuesWithPagingPredicate (0x013500)
    dispatcher.register(MAP_VALUES_WITH_PAGING_PREDICATE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next(); // initial frame
        const name = StringCodec.decode(iter);
        const predicateData = _decodePagingPredicateInnerPredicate(iter);
        const values = predicateData !== null
            ? await operations.valuesWithPredicate(name, predicateData)
            : await operations.values(name);
        return _encodePagingPredicateDataListResponse(MAP_VALUES_WITH_PAGING_PREDICATE_RESPONSE_TYPE, values);
    });

    // Map.EntriesWithPagingPredicate (0x013600)
    dispatcher.register(MAP_ENTRIES_WITH_PAGING_PREDICATE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next(); // initial frame
        const name = StringCodec.decode(iter);
        const predicateData = _decodePagingPredicateInnerPredicate(iter);
        const entries = predicateData !== null
            ? await operations.entriesWithPredicate(name, predicateData)
            : await operations.entrySet(name);
        return _encodePagingPredicateEntriesResponse(MAP_ENTRIES_WITH_PAGING_PREDICATE_RESPONSE_TYPE, entries);
    });

    // Map.EventJournalSubscribe (0x014100)
    // Request: name (string), partitionId (int)
    // Response: oldestSequence (long), newestSequence (long)
    dispatcher.register(MAP_EVENT_JOURNAL_SUBSCRIBE_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const partitionId = initialFrame.content.readInt32LE(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const { oldest, newest } = await operations.eventJournalSubscribe(name, partitionId);
        const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        buf.fill(0);
        buf.writeUInt32LE(MAP_EVENT_JOURNAL_SUBSCRIBE_RESPONSE_TYPE >>> 0, 0);
        buf.writeBigInt64LE(oldest, RESPONSE_HEADER_SIZE);
        buf.writeBigInt64LE(newest, RESPONSE_HEADER_SIZE + LONG_SIZE_IN_BYTES);
        const response = CM.createForEncode();
        response.add(new CM.Frame(buf, CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG));
        response.setFinal();
        return response;
    });

    // Map.EventJournalRead (0x014200)
    // Request: startSequence (long), minCount (int), maxCount (int), partitionId (int), name (string), predicate (Data nullable)
    // Response: readCount (int), items (list of journal events), nextSeq (long)
    dispatcher.register(MAP_EVENT_JOURNAL_READ_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const startSequence = initialFrame.content.readBigInt64LE(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES);
        const minCount = initialFrame.content.readInt32LE(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const maxCount = initialFrame.content.readInt32LE(CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const partitionId = initialFrame.content.readInt32LE(CM.PARTITION_ID_FIELD_OFFSET);
        const name = StringCodec.decode(iter);
        const events = await operations.eventJournalRead(name, partitionId, startSequence, minCount, maxCount);
        // Encode response: readCount (int) + nextSeq (long) in initial frame
        // items: list of event objects (each is a data structure with key, newValue, oldValue, eventType, timestamp)
        const nextSeq = startSequence + BigInt(events.length);
        const headerBuf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        headerBuf.fill(0);
        headerBuf.writeUInt32LE(MAP_EVENT_JOURNAL_READ_RESPONSE_TYPE >>> 0, 0);
        headerBuf.writeInt32LE(events.length, RESPONSE_HEADER_SIZE);
        headerBuf.writeBigInt64LE(nextSeq, RESPONSE_HEADER_SIZE + INT_SIZE_IN_BYTES);
        const response = CM.createForEncode();
        response.add(new CM.Frame(headerBuf, CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG));
        // Encode items as a list of journal event data structures
        response.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
        for (const event of events) {
            // Each event is a data structure: fixed fields (eventType int32, timestamp long) + key + newValue + oldValue
            response.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
            // Fixed-size fields frame: eventType (int32) + timestamp (long)
            const eventFrameBuf = Buffer.allocUnsafe(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
            eventFrameBuf.writeInt32LE(event.eventType, 0);
            eventFrameBuf.writeBigInt64LE(BigInt(event.timestamp), INT_SIZE_IN_BYTES);
            response.add(new CM.Frame(eventFrameBuf, 0));
            // key (required Data)
            DataCodec.encode(response, event.key);
            // newValue (nullable Data)
            if (event.newValue !== null) {
                DataCodec.encode(response, event.newValue);
            } else {
                response.add(CM.NULL_FRAME);
            }
            // oldValue (nullable Data)
            if (event.oldValue !== null) {
                DataCodec.encode(response, event.oldValue);
            } else {
                response.add(CM.NULL_FRAME);
            }
            response.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
        }
        response.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
        response.setFinal();
        return response;
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

/**
 * Encodes a response containing a List<nullable Data> — ListMultiFrameCodec.encodeContainsNullable pattern.
 * Used by Map.Project and Map.ProjectWithPredicate responses.
 */
function _encodeNullableDataListResponse(responseType: number, items: Array<Data | null>): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(responseType >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
    for (const item of items) {
        if (item === null) {
            msg.add(CM.NULL_FRAME);
        } else {
            DataCodec.encode(msg, item);
        }
    }
    msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
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

/**
 * Decodes an IndexConfigCodec from the iterator.
 * Wire layout (inside BEGIN/END structure frames):
 *   BEGIN_FRAME
 *   initialFrame: type (int at offset 0)
 *   nullable string (name) — skipped
 *   ListMultiFrame<string> (attributes)
 *   nullable BitmapIndexOptions — skipped
 *   END_FRAME
 *
 * Returns the integer index type (0=SORTED, 1=HASH, 2=BITMAP).
 */
function _decodeIndexType(iter: CM.ForwardFrameIterator): number {
    // consume BEGIN_FRAME
    iter.next();
    // read initial frame — type is at offset 0 within frame content
    const initialFrame = iter.next();
    return initialFrame.content.readInt32LE(0);
}

/**
 * Reads the attribute list from an IndexConfig after _decodeIndexType has consumed
 * the BEGIN_FRAME and initial frame. Skips nullable name, reads string list, then
 * fast-forwards to the END_FRAME.
 */
function _decodeIndexAttributes(iter: CM.ForwardFrameIterator): string[] {
    // nullable name — skip
    CodecUtil.decodeNullable(iter, StringCodec.decode);
    // ListMultiFrame<string> attributes
    const attributes = ListMultiFrameCodec.decode(iter, StringCodec.decode);
    // fast-forward to END_FRAME (skipping nullable BitmapIndexOptions)
    CodecUtil.fastForwardToEndFrame(iter);
    return attributes;
}

/**
 * Decodes a PagingPredicateHolder from the wire and returns the inner predicateData
 * (as a Data object) or null if none was set. Consumes all frames up to and including
 * the END_FRAME of the PagingPredicateHolder.
 *
 * Wire layout of PagingPredicateHolder:
 *   BEGIN_FRAME
 *   initialFrame: pageSize(int), page(int), iterationTypeId(byte)
 *   AnchorDataListHolder (BEGIN_FRAME, ListIntegerCodec, EntryListCodec, END_FRAME)
 *   nullable predicateData  ← we want this
 *   nullable comparatorData (skipped)
 *   nullable partitionKeyData (skipped)
 *   END_FRAME
 */
function _decodePagingPredicateInnerPredicate(iter: CM.ForwardFrameIterator): Data | null {
    // BEGIN_FRAME of PagingPredicateHolder
    iter.next();
    // initial frame (pageSize, page, iterationTypeId) — we don't need these values
    iter.next();
    // AnchorDataListHolder: BEGIN_FRAME, ListIntegerCodec (one frame), EntryListCodec (BEGIN+entries+END), END_FRAME
    _skipAnchorDataListHolder(iter);
    // nullable predicateData
    const predicateData = CodecUtil.decodeNullable(iter, DataCodec.decode);
    // fast-forward to END_FRAME (skips comparatorData + partitionKeyData)
    CodecUtil.fastForwardToEndFrame(iter);
    return predicateData;
}

/** Skips an AnchorDataListHolder structure. */
function _skipAnchorDataListHolder(iter: CM.ForwardFrameIterator): void {
    // BEGIN_FRAME
    iter.next();
    // ListIntegerCodec: one raw frame of ints
    ListIntegerCodec.decode(iter);
    // EntryListCodec: BEGIN_FRAME + pairs of Data + END_FRAME
    _decodeEntryList(iter);
    // END_FRAME
    CodecUtil.fastForwardToEndFrame(iter);
}

/**
 * Encodes a paging predicate response for KeySet queries.
 * Response wire format:
 *   initial frame (empty header)
 *   ListMultiFrame<Data> keys
 *   AnchorDataListHolder (empty — no anchors for single-node)
 */
function _encodePagingPredicateKeySetResponse(responseType: number, keys: Data[]): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(responseType >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    // encode keys as ListMultiFrame<Data>
    msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
    for (const key of keys) {
        DataCodec.encode(msg, key);
    }
    msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
    // encode empty AnchorDataListHolder
    _encodeEmptyAnchorDataListHolder(msg);
    msg.setFinal();
    return msg;
}

/**
 * Encodes a paging predicate response for Values queries.
 */
function _encodePagingPredicateDataListResponse(responseType: number, values: Data[]): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(responseType >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    // encode values as ListMultiFrame<Data>
    msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
    for (const val of values) {
        DataCodec.encode(msg, val);
    }
    msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
    // encode empty AnchorDataListHolder
    _encodeEmptyAnchorDataListHolder(msg);
    msg.setFinal();
    return msg;
}

/**
 * Encodes a paging predicate response for Entries queries.
 */
function _encodePagingPredicateEntriesResponse(responseType: number, entries: Array<[Data, Data]>): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(responseType >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    // encode entries as EntryList<Data, Data>
    msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
    for (const [k, v] of entries) {
        DataCodec.encode(msg, k);
        DataCodec.encode(msg, v);
    }
    msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
    // encode empty AnchorDataListHolder
    _encodeEmptyAnchorDataListHolder(msg);
    msg.setFinal();
    return msg;
}

/**
 * Encodes an empty AnchorDataListHolder.
 * Wire layout:
 *   BEGIN_FRAME
 *   ListIntegerCodec (empty — zero ints, zero-byte frame)
 *   EntryListCodec (BEGIN_FRAME + END_FRAME — empty list)
 *   END_FRAME
 */
function _encodeEmptyAnchorDataListHolder(msg: ClientMessage): void {
    msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
    // empty ListIntegerCodec: a frame with zero bytes
    msg.add(new CM.Frame(Buffer.alloc(0)));
    // empty EntryListCodec: BEGIN + END
    msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
    msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
    msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
}
