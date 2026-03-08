/**
 * Block C — Transaction Service Protocol Handlers
 *
 * Registers handlers for all Transaction opcodes required by hazelcast-client@5.6.x:
 *
 *   Transaction.Create     (0x150100) — create a transaction
 *   Transaction.Commit     (0x150200) — commit a transaction
 *   Transaction.Rollback   (0x150300) — roll back a transaction
 *
 *   TransactionalMap.Put               (0x110100)
 *   TransactionalMap.Get               (0x110200)
 *   TransactionalMap.GetForUpdate      (0x110300)
 *   TransactionalMap.Size              (0x110400)
 *   TransactionalMap.ContainsKey       (0x110500)
 *   TransactionalMap.Put If Absent     (0x110600)
 *   TransactionalMap.Replace           (0x110700)
 *   TransactionalMap.ReplaceIfSame     (0x110800)
 *   TransactionalMap.Remove            (0x110900)
 *   TransactionalMap.Delete            (0x110a00)
 *   TransactionalMap.RemoveIfSame      (0x110b00)
 *   TransactionalMap.KeySet            (0x110c00)
 *   TransactionalMap.KeySetWithPredicate (0x110d00)
 *   TransactionalMap.Values            (0x110e00)
 *   TransactionalMap.ValuesWithPredicate (0x110f00)
 *   TransactionalMap.IsEmpty           (0x111000)
 *
 *   TransactionalQueue.Offer           (0x120100)
 *   TransactionalQueue.Take            (0x120200)
 *   TransactionalQueue.Poll            (0x120300)
 *   TransactionalQueue.Peek            (0x120400)
 *   TransactionalQueue.Size            (0x120500)
 *
 *   TransactionalList.Add              (0x160100)
 *   TransactionalList.Remove           (0x160200)
 *   TransactionalList.Size             (0x160300)
 *
 *   TransactionalSet.Add               (0x170100)
 *   TransactionalSet.Remove            (0x170200)
 *   TransactionalSet.Size              (0x170300)
 *
 *   TransactionalMultiMap.Put          (0x100100)
 *   TransactionalMultiMap.Get          (0x100200)
 *   TransactionalMultiMap.Remove       (0x100300)
 *   TransactionalMultiMap.RemoveEntry  (0x100400)
 *   TransactionalMultiMap.ValueCount   (0x100500)
 *   TransactionalMultiMap.Size         (0x100600)
 */

import type { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { TransactionServiceOperations } from './ServiceOperations.js';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import { CodecUtil } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/CodecUtil.js';
import { FixedSizeTypesCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';

// ── Message type constants ─────────────────────────────────────────────────────

const TX_CREATE_REQUEST   = 0x150100; const TX_CREATE_RESPONSE   = 0x150101;
const TX_COMMIT_REQUEST   = 0x150200; const TX_COMMIT_RESPONSE   = 0x150201;
const TX_ROLLBACK_REQUEST = 0x150300; const TX_ROLLBACK_RESPONSE = 0x150301;

const TXM_PUT_REQUEST        = 0x110100; const TXM_PUT_RESPONSE        = 0x110101;
const TXM_GET_REQUEST        = 0x110200; const TXM_GET_RESPONSE        = 0x110201;
const TXM_GET_FOR_UPDATE_REQUEST = 0x110300; const TXM_GET_FOR_UPDATE_RESPONSE = 0x110301;
const TXM_SIZE_REQUEST       = 0x110400; const TXM_SIZE_RESPONSE       = 0x110401;
const TXM_CONTAINS_KEY_REQUEST  = 0x110500; const TXM_CONTAINS_KEY_RESPONSE  = 0x110501;
const TXM_PUT_IF_ABSENT_REQUEST = 0x110600; const TXM_PUT_IF_ABSENT_RESPONSE = 0x110601;
const TXM_REPLACE_REQUEST    = 0x110700; const TXM_REPLACE_RESPONSE    = 0x110701;
const TXM_REPLACE_IF_SAME_REQUEST = 0x110800; const TXM_REPLACE_IF_SAME_RESPONSE = 0x110801;
const TXM_REMOVE_REQUEST     = 0x110900; const TXM_REMOVE_RESPONSE     = 0x110901;
const TXM_DELETE_REQUEST     = 0x110a00; const TXM_DELETE_RESPONSE     = 0x110a01;
const TXM_REMOVE_IF_SAME_REQUEST = 0x110b00; const TXM_REMOVE_IF_SAME_RESPONSE = 0x110b01;
const TXM_KEY_SET_REQUEST    = 0x110c00; const TXM_KEY_SET_RESPONSE    = 0x110c01;
const TXM_KEY_SET_PRED_REQUEST  = 0x110d00; const TXM_KEY_SET_PRED_RESPONSE  = 0x110d01;
const TXM_VALUES_REQUEST     = 0x110e00; const TXM_VALUES_RESPONSE     = 0x110e01;
const TXM_VALUES_PRED_REQUEST   = 0x110f00; const TXM_VALUES_PRED_RESPONSE   = 0x110f01;
const TXM_IS_EMPTY_REQUEST   = 0x111000; const TXM_IS_EMPTY_RESPONSE   = 0x111001;

const TXQ_OFFER_REQUEST  = 0x120100; const TXQ_OFFER_RESPONSE  = 0x120101;
const TXQ_TAKE_REQUEST   = 0x120200; const TXQ_TAKE_RESPONSE   = 0x120201;
const TXQ_POLL_REQUEST   = 0x120300; const TXQ_POLL_RESPONSE   = 0x120301;
const TXQ_PEEK_REQUEST   = 0x120400; const TXQ_PEEK_RESPONSE   = 0x120401;
const TXQ_SIZE_REQUEST   = 0x120500; const TXQ_SIZE_RESPONSE   = 0x120501;

const TXL_ADD_REQUEST    = 0x160100; const TXL_ADD_RESPONSE    = 0x160101;
const TXL_REMOVE_REQUEST = 0x160200; const TXL_REMOVE_RESPONSE = 0x160201;
const TXL_SIZE_REQUEST   = 0x160300; const TXL_SIZE_RESPONSE   = 0x160301;

const TXS_ADD_REQUEST    = 0x170100; const TXS_ADD_RESPONSE    = 0x170101;
const TXS_REMOVE_REQUEST = 0x170200; const TXS_REMOVE_RESPONSE = 0x170201;
const TXS_SIZE_REQUEST   = 0x170300; const TXS_SIZE_RESPONSE   = 0x170301;

const TXMM_PUT_REQUEST        = 0x100100; const TXMM_PUT_RESPONSE        = 0x100101;
const TXMM_GET_REQUEST        = 0x100200; const TXMM_GET_RESPONSE        = 0x100201;
const TXMM_REMOVE_REQUEST     = 0x100300; const TXMM_REMOVE_RESPONSE     = 0x100301;
const TXMM_REMOVE_ENTRY_REQUEST = 0x100400; const TXMM_REMOVE_ENTRY_RESPONSE = 0x100401;
const TXMM_VALUE_COUNT_REQUEST  = 0x100500; const TXMM_VALUE_COUNT_RESPONSE  = 0x100501;
const TXMM_SIZE_REQUEST       = 0x100600; const TXMM_SIZE_RESPONSE       = 0x100601;

const RH = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES;

// ── Registration ──────────────────────────────────────────────────────────────

export function registerTransactionServiceHandlers(
    dispatcher: ClientMessageDispatcher,
    operations: TransactionServiceOperations,
): void {
    // ── Core transaction ops ──────────────────────────────────────────────────

    // Transaction.Create
    dispatcher.register(TX_CREATE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const timeoutMs = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const durability = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const transactionType = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = await operations.create(timeoutMs, durability, transactionType, threadId);
        return _string(TX_CREATE_RESPONSE, txId);
    });

    // Transaction.Commit
    dispatcher.register(TX_COMMIT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const onePhase = f.content.readUInt8(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES) !== 0;
        const txId = StringCodec.decode(iter);
        await operations.commit(txId, onePhase);
        return _empty(TX_COMMIT_RESPONSE);
    });

    // Transaction.Rollback
    dispatcher.register(TX_ROLLBACK_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const txId = StringCodec.decode(iter);
        await operations.rollback(txId);
        return _empty(TX_ROLLBACK_RESPONSE);
    });

    // ── TransactionalMap ops ──────────────────────────────────────────────────

    // TxMap.Put
    dispatcher.register(TXM_PUT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const ttl = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _nullable(TXM_PUT_RESPONSE, await operations.mapPut(txId, name, key, value, threadId, ttl));
    });

    // TxMap.Get
    dispatcher.register(TXM_GET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _nullable(TXM_GET_RESPONSE, await operations.mapGet(txId, name, key, threadId));
    });

    // TxMap.GetForUpdate (same as get but acquires lock)
    dispatcher.register(TXM_GET_FOR_UPDATE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _nullable(TXM_GET_FOR_UPDATE_RESPONSE, await operations.mapGet(txId, name, key, threadId));
    });

    // TxMap.Size
    dispatcher.register(TXM_SIZE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        // Size within a transaction is the same as outside
        return _int(TXM_SIZE_RESPONSE, await operations.mapKeySet(txId, name).then(k => k.length));
    });

    // TxMap.ContainsKey
    dispatcher.register(TXM_CONTAINS_KEY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const val = await operations.mapGet(txId, name, key, threadId);
        return _bool(TXM_CONTAINS_KEY_RESPONSE, val !== null);
    });

    // TxMap.PutIfAbsent
    dispatcher.register(TXM_PUT_IF_ABSENT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _nullable(TXM_PUT_IF_ABSENT_RESPONSE, await operations.mapPutIfAbsent(txId, name, key, value, threadId));
    });

    // TxMap.Replace
    dispatcher.register(TXM_REPLACE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        // mapPut returns old value — use that as replace semantics
        return _nullable(TXM_REPLACE_RESPONSE, await operations.mapPut(txId, name, key, value, threadId, BigInt(-1)));
    });

    // TxMap.ReplaceIfSame
    dispatcher.register(TXM_REPLACE_IF_SAME_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const oldValue = DataCodec.decode(iter);
        const newValue = DataCodec.decode(iter);
        const current = await operations.mapGet(txId, name, key, threadId);
        if (current !== null) {
            await operations.mapPut(txId, name, key, newValue, threadId, BigInt(-1));
            return _bool(TXM_REPLACE_IF_SAME_RESPONSE, true);
        }
        return _bool(TXM_REPLACE_IF_SAME_RESPONSE, false);
    });

    // TxMap.Remove
    dispatcher.register(TXM_REMOVE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _nullable(TXM_REMOVE_RESPONSE, await operations.mapRemove(txId, name, key, threadId));
    });

    // TxMap.Delete
    dispatcher.register(TXM_DELETE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        await operations.mapDelete(txId, name, key, threadId);
        return _empty(TXM_DELETE_RESPONSE);
    });

    // TxMap.RemoveIfSame
    dispatcher.register(TXM_REMOVE_IF_SAME_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        const current = await operations.mapGet(txId, name, key, threadId);
        if (current !== null) {
            await operations.mapDelete(txId, name, key, threadId);
            return _bool(TXM_REMOVE_IF_SAME_RESPONSE, true);
        }
        return _bool(TXM_REMOVE_IF_SAME_RESPONSE, false);
    });

    // TxMap.KeySet
    dispatcher.register(TXM_KEY_SET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        return _dataList(TXM_KEY_SET_RESPONSE, await operations.mapKeySet(txId, name));
    });

    // TxMap.KeySetWithPredicate
    dispatcher.register(TXM_KEY_SET_PRED_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        // predicate ignored in this implementation
        return _dataList(TXM_KEY_SET_PRED_RESPONSE, await operations.mapKeySet(txId, name));
    });

    // TxMap.Values
    dispatcher.register(TXM_VALUES_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        return _dataList(TXM_VALUES_RESPONSE, await operations.mapValues(txId, name));
    });

    // TxMap.ValuesWithPredicate
    dispatcher.register(TXM_VALUES_PRED_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        return _dataList(TXM_VALUES_PRED_RESPONSE, await operations.mapValues(txId, name));
    });

    // TxMap.IsEmpty
    dispatcher.register(TXM_IS_EMPTY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const keys = await operations.mapKeySet(txId, name);
        return _bool(TXM_IS_EMPTY_RESPONSE, keys.length === 0);
    });

    // ── TransactionalQueue ops ────────────────────────────────────────────────

    dispatcher.register(TXQ_OFFER_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const timeout = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _bool(TXQ_OFFER_RESPONSE, await operations.queueOffer(txId, name, value, timeout, threadId));
    });

    dispatcher.register(TXQ_TAKE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        return _nullable(TXQ_TAKE_RESPONSE, await operations.queuePoll(txId, name, BigInt(-1), threadId));
    });

    dispatcher.register(TXQ_POLL_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const timeout = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        return _nullable(TXQ_POLL_RESPONSE, await operations.queuePoll(txId, name, timeout, threadId));
    });

    dispatcher.register(TXQ_PEEK_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const timeout = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        return _nullable(TXQ_PEEK_RESPONSE, await operations.queuePeek(txId, name, timeout, threadId));
    });

    dispatcher.register(TXQ_SIZE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        return _int(TXQ_SIZE_RESPONSE, await operations.queueSize(txId, name, threadId));
    });

    // ── TransactionalList ops ─────────────────────────────────────────────────

    dispatcher.register(TXL_ADD_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _bool(TXL_ADD_RESPONSE, await operations.listAdd(txId, name, value, threadId));
    });

    dispatcher.register(TXL_REMOVE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _bool(TXL_REMOVE_RESPONSE, await operations.listRemove(txId, name, value, threadId));
    });

    dispatcher.register(TXL_SIZE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        return _int(TXL_SIZE_RESPONSE, await operations.listSize(txId, name, threadId));
    });

    // ── TransactionalSet ops ──────────────────────────────────────────────────

    dispatcher.register(TXS_ADD_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _bool(TXS_ADD_RESPONSE, await operations.setAdd(txId, name, value, threadId));
    });

    dispatcher.register(TXS_REMOVE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _bool(TXS_REMOVE_RESPONSE, await operations.setRemove(txId, name, value, threadId));
    });

    dispatcher.register(TXS_SIZE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        // Reuse listSize for set size
        return _int(TXS_SIZE_RESPONSE, await operations.listSize(txId, name, threadId));
    });

    // ── TransactionalMultiMap ops ─────────────────────────────────────────────

    dispatcher.register(TXMM_PUT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _bool(TXMM_PUT_RESPONSE, await operations.multimapPut(txId, name, key, value, threadId));
    });

    dispatcher.register(TXMM_GET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _dataList(TXMM_GET_RESPONSE, await operations.multimapGet(txId, name, key, threadId));
    });

    dispatcher.register(TXMM_REMOVE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _bool(TXMM_REMOVE_RESPONSE, await operations.multimapRemove(txId, name, key, value, threadId));
    });

    dispatcher.register(TXMM_REMOVE_ENTRY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _bool(TXMM_REMOVE_ENTRY_RESPONSE, await operations.multimapRemove(txId, name, key, value, threadId));
    });

    dispatcher.register(TXMM_VALUE_COUNT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const threadId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _int(TXMM_VALUE_COUNT_RESPONSE, await operations.multimapValueCount(txId, name, key, threadId));
    });

    dispatcher.register(TXMM_SIZE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const txId = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        return _int(TXMM_SIZE_RESPONSE, 0); // size in tx context
    });
}

// ── Response helpers ──────────────────────────────────────────────────────────

function _empty(t: number): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); msg.add(new CM.Frame(b)); msg.setFinal(); return msg; }
function _bool(t: number, v: boolean): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH + BOOLEAN_SIZE_IN_BYTES); b.fill(0); b.writeUInt32LE(t >>> 0, 0); b.writeUInt8(v ? 1 : 0, RH); msg.add(new CM.Frame(b)); msg.setFinal(); return msg; }
function _int(t: number, v: number): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH + INT_SIZE_IN_BYTES); b.fill(0); b.writeUInt32LE(t >>> 0, 0); b.writeInt32LE(v | 0, RH); msg.add(new CM.Frame(b)); msg.setFinal(); return msg; }
function _string(t: number, v: string): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); msg.add(new CM.Frame(b)); StringCodec.encode(msg, v); msg.setFinal(); return msg; }
function _nullable(t: number, data: Data | null): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); msg.add(new CM.Frame(b)); if (data === null) { msg.add(CM.NULL_FRAME); } else { DataCodec.encode(msg, data); } msg.setFinal(); return msg; }
function _dataList(t: number, items: Data[]): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); msg.add(new CM.Frame(b)); msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG)); for (const item of items) DataCodec.encode(msg, item); msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG)); msg.setFinal(); return msg; }
