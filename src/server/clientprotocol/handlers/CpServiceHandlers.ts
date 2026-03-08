/**
 * Block C — CP Subsystem Service Protocol Handlers
 *
 * Registers handlers for all CP subsystem opcodes required by hazelcast-client@5.6.x:
 *
 * AtomicLong:
 *   AtomicLong.Apply              (0x0b0100)
 *   AtomicLong.Alter              (0x0b0200)
 *   AtomicLong.GetAndAlter        (0x0b0300)
 *   AtomicLong.AlterAndGet        (0x0b0400)
 *   AtomicLong.AddAndGet          (0x0b0500)
 *   AtomicLong.CompareAndSet      (0x0b0600)
 *   AtomicLong.Get                (0x0b0700)
 *   AtomicLong.GetAndAdd          (0x0b0800)
 *   AtomicLong.GetAndSet          (0x0b0900)
 *   AtomicLong.Set                (0x0b0a00)
 *
 * AtomicRef:
 *   AtomicRef.Apply               (0x0c0100)
 *   AtomicRef.Alter               (0x0c0200)
 *   AtomicRef.GetAndAlter         (0x0c0300)
 *   AtomicRef.AlterAndGet         (0x0c0400)
 *   AtomicRef.Contains            (0x0c0500)
 *   AtomicRef.Get                 (0x0c0600)
 *   AtomicRef.Set                 (0x0c0700)
 *   AtomicRef.IsNull              (0x0c0800)
 *   AtomicRef.Clear               (0x0c0900)
 *   AtomicRef.CompareAndSet       (0x0c0a00)
 *
 * CountDownLatch:
 *   CountDownLatch.TrySetCount    (0x0d0100)
 *   CountDownLatch.Await          (0x0d0200)
 *   CountDownLatch.CountDown      (0x0d0300)
 *   CountDownLatch.GetCount       (0x0d0400)
 *   CountDownLatch.GetRound       (0x0d0500)
 *
 * Semaphore:
 *   Semaphore.Init                (0x0e0100 — overlaps ReplicatedMap, handled by different services)
 *   Semaphore.Acquire             (0x1f0100)
 *   Semaphore.Release             (0x1f0200)
 *   Semaphore.Drain               (0x1f0300)
 *   Semaphore.Change              (0x1f0400)
 *   Semaphore.AvailablePermits    (0x1f0500)
 *   Semaphore.TryAcquire          (0x1f0600)
 *   Semaphore.Init                (0x1f0700)
 */

import type { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type {
    AtomicLongOperations,
    AtomicRefOperations,
    CountDownLatchOperations,
    SemaphoreOperations,
} from './ServiceOperations.js';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import { CodecUtil } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/CodecUtil.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';

// ── AtomicLong message type constants ──────────────────────────────────────────

const AL_APPLY_REQUEST           = 0x0b0100; const AL_APPLY_RESPONSE           = 0x0b0101;
const AL_ALTER_REQUEST           = 0x0b0200; const AL_ALTER_RESPONSE           = 0x0b0201;
const AL_GET_AND_ALTER_REQUEST   = 0x0b0300; const AL_GET_AND_ALTER_RESPONSE   = 0x0b0301;
const AL_ALTER_AND_GET_REQUEST   = 0x0b0400; const AL_ALTER_AND_GET_RESPONSE   = 0x0b0401;
const AL_ADD_AND_GET_REQUEST     = 0x0b0500; const AL_ADD_AND_GET_RESPONSE     = 0x0b0501;
const AL_COMPARE_AND_SET_REQUEST = 0x0b0600; const AL_COMPARE_AND_SET_RESPONSE = 0x0b0601;
const AL_GET_REQUEST             = 0x0b0700; const AL_GET_RESPONSE             = 0x0b0701;
const AL_GET_AND_ADD_REQUEST     = 0x0b0800; const AL_GET_AND_ADD_RESPONSE     = 0x0b0801;
const AL_GET_AND_SET_REQUEST     = 0x0b0900; const AL_GET_AND_SET_RESPONSE     = 0x0b0901;
const AL_SET_REQUEST             = 0x0b0a00; const AL_SET_RESPONSE             = 0x0b0a01;

// ── AtomicRef message type constants ──────────────────────────────────────────

const AR_APPLY_REQUEST           = 0x0c0100; const AR_APPLY_RESPONSE           = 0x0c0101;
const AR_ALTER_REQUEST           = 0x0c0200; const AR_ALTER_RESPONSE           = 0x0c0201;
const AR_GET_AND_ALTER_REQUEST   = 0x0c0300; const AR_GET_AND_ALTER_RESPONSE   = 0x0c0301;
const AR_ALTER_AND_GET_REQUEST   = 0x0c0400; const AR_ALTER_AND_GET_RESPONSE   = 0x0c0401;
const AR_CONTAINS_REQUEST        = 0x0c0500; const AR_CONTAINS_RESPONSE        = 0x0c0501;
const AR_GET_REQUEST             = 0x0c0600; const AR_GET_RESPONSE             = 0x0c0601;
const AR_SET_REQUEST             = 0x0c0700; const AR_SET_RESPONSE             = 0x0c0701;
const AR_IS_NULL_REQUEST         = 0x0c0800; const AR_IS_NULL_RESPONSE         = 0x0c0801;
const AR_CLEAR_REQUEST           = 0x0c0900; const AR_CLEAR_RESPONSE           = 0x0c0901;
const AR_COMPARE_AND_SET_REQUEST = 0x0c0a00; const AR_COMPARE_AND_SET_RESPONSE = 0x0c0a01;

// ── CountDownLatch message type constants ─────────────────────────────────────

const CDL_TRY_SET_COUNT_REQUEST = 0x0d0100; const CDL_TRY_SET_COUNT_RESPONSE = 0x0d0101;
const CDL_AWAIT_REQUEST         = 0x0d0200; const CDL_AWAIT_RESPONSE         = 0x0d0201;
const CDL_COUNT_DOWN_REQUEST    = 0x0d0300; const CDL_COUNT_DOWN_RESPONSE    = 0x0d0301;
const CDL_GET_COUNT_REQUEST     = 0x0d0400; const CDL_GET_COUNT_RESPONSE     = 0x0d0401;
const CDL_GET_ROUND_REQUEST     = 0x0d0500; const CDL_GET_ROUND_RESPONSE     = 0x0d0501;

// ── Semaphore message type constants ──────────────────────────────────────────

const SEM_ACQUIRE_REQUEST          = 0x1f0100; const SEM_ACQUIRE_RESPONSE          = 0x1f0101;
const SEM_RELEASE_REQUEST          = 0x1f0200; const SEM_RELEASE_RESPONSE          = 0x1f0201;
const SEM_DRAIN_REQUEST            = 0x1f0300; const SEM_DRAIN_RESPONSE            = 0x1f0301;
const SEM_CHANGE_REQUEST           = 0x1f0400; const SEM_CHANGE_RESPONSE           = 0x1f0401;
const SEM_AVAILABLE_PERMITS_REQUEST = 0x1f0500; const SEM_AVAILABLE_PERMITS_RESPONSE = 0x1f0501;
const SEM_TRY_ACQUIRE_REQUEST      = 0x1f0600; const SEM_TRY_ACQUIRE_RESPONSE      = 0x1f0601;
const SEM_INIT_REQUEST             = 0x1f0700; const SEM_INIT_RESPONSE             = 0x1f0701;

const RH = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES;

// ── CP group name encoding constants ──────────────────────────────────────────

/**
 * Decode CP proxy name from the first string frame after the initial frame.
 * CP objects are identified by a proxyName that includes the CP group name.
 */
function _decodeCpProxyName(iter: CM.ForwardFrameIterator): string {
    // CP proxy name is encoded as: groupId + objectName combined as "name@group"
    // For simplicity we decode just the name string
    return StringCodec.decode(iter);
}

// ── Registration ──────────────────────────────────────────────────────────────

export interface CpServiceHandlersOptions {
    dispatcher: ClientMessageDispatcher;
    atomicLong: AtomicLongOperations;
    atomicRef: AtomicRefOperations;
    countDownLatch: CountDownLatchOperations;
    semaphore: SemaphoreOperations;
}

export function registerCpServiceHandlers(opts: CpServiceHandlersOptions): void {
    const { dispatcher, atomicLong, atomicRef, countDownLatch, semaphore } = opts;

    // ── AtomicLong ────────────────────────────────────────────────────────────

    dispatcher.register(AL_GET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        return _long(AL_GET_RESPONSE, await atomicLong.get(name));
    });

    dispatcher.register(AL_SET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const value = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = _decodeCpProxyName(iter);
        await atomicLong.set(name, value);
        return _empty(AL_SET_RESPONSE);
    });

    dispatcher.register(AL_GET_AND_SET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const value = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = _decodeCpProxyName(iter);
        return _long(AL_GET_AND_SET_RESPONSE, await atomicLong.getAndSet(name, value));
    });

    dispatcher.register(AL_ADD_AND_GET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const delta = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = _decodeCpProxyName(iter);
        return _long(AL_ADD_AND_GET_RESPONSE, await atomicLong.addAndGet(name, delta));
    });

    dispatcher.register(AL_GET_AND_ADD_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const delta = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = _decodeCpProxyName(iter);
        return _long(AL_GET_AND_ADD_RESPONSE, await atomicLong.getAndAdd(name, delta));
    });

    dispatcher.register(AL_COMPARE_AND_SET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const expect = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const update = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = _decodeCpProxyName(iter);
        return _bool(AL_COMPARE_AND_SET_RESPONSE, await atomicLong.compareAndSet(name, expect, update));
    });

    dispatcher.register(AL_ALTER_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        const fn = DataCodec.decode(iter);
        await atomicLong.alter(name, fn);
        return _empty(AL_ALTER_RESPONSE);
    });

    dispatcher.register(AL_ALTER_AND_GET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        const fn = DataCodec.decode(iter);
        return _long(AL_ALTER_AND_GET_RESPONSE, await atomicLong.alterAndGet(name, fn));
    });

    dispatcher.register(AL_GET_AND_ALTER_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        const fn = DataCodec.decode(iter);
        return _long(AL_GET_AND_ALTER_RESPONSE, await atomicLong.getAndAlter(name, fn));
    });

    dispatcher.register(AL_APPLY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        const fn = DataCodec.decode(iter);
        return _nullable(AL_APPLY_RESPONSE, await atomicLong.apply(name, fn));
    });

    // ── AtomicRef ─────────────────────────────────────────────────────────────

    dispatcher.register(AR_GET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        return _nullable(AR_GET_RESPONSE, await atomicRef.get(name));
    });

    dispatcher.register(AR_SET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        const value = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        await atomicRef.set(name, value);
        return _empty(AR_SET_RESPONSE);
    });

    dispatcher.register(AR_IS_NULL_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        return _bool(AR_IS_NULL_RESPONSE, await atomicRef.isNull(name));
    });

    dispatcher.register(AR_CLEAR_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        await atomicRef.clear(name);
        return _empty(AR_CLEAR_RESPONSE);
    });

    dispatcher.register(AR_CONTAINS_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        const value = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        return _bool(AR_CONTAINS_RESPONSE, await atomicRef.contains(name, value));
    });

    dispatcher.register(AR_COMPARE_AND_SET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        const expected = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        const updated = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        return _bool(AR_COMPARE_AND_SET_RESPONSE, await atomicRef.compareAndSet(name, expected, updated));
    });

    dispatcher.register(AR_ALTER_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        const fn = DataCodec.decode(iter);
        await atomicRef.alter(name, fn);
        return _empty(AR_ALTER_RESPONSE);
    });

    dispatcher.register(AR_ALTER_AND_GET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        const fn = DataCodec.decode(iter);
        return _nullable(AR_ALTER_AND_GET_RESPONSE, await atomicRef.alterAndGet(name, fn));
    });

    dispatcher.register(AR_GET_AND_ALTER_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        const fn = DataCodec.decode(iter);
        return _nullable(AR_GET_AND_ALTER_RESPONSE, await atomicRef.getAndAlter(name, fn));
    });

    dispatcher.register(AR_APPLY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        const fn = DataCodec.decode(iter);
        return _nullable(AR_APPLY_RESPONSE, await atomicRef.apply(name, fn));
    });

    // ── CountDownLatch ────────────────────────────────────────────────────────

    dispatcher.register(CDL_TRY_SET_COUNT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const count = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = _decodeCpProxyName(iter);
        return _bool(CDL_TRY_SET_COUNT_RESPONSE, await countDownLatch.trySetCount(name, count));
    });

    dispatcher.register(CDL_AWAIT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const timeoutMs = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = _decodeCpProxyName(iter);
        return _bool(CDL_AWAIT_RESPONSE, await countDownLatch.await(name, timeoutMs));
    });

    dispatcher.register(CDL_COUNT_DOWN_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const expectedRound = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = _decodeCpProxyName(iter);
        const invocationUuid = StringCodec.decode(iter);
        await countDownLatch.countDown(name, expectedRound, invocationUuid);
        return _empty(CDL_COUNT_DOWN_RESPONSE);
    });

    dispatcher.register(CDL_GET_COUNT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        return _int(CDL_GET_COUNT_RESPONSE, await countDownLatch.getCount(name));
    });

    dispatcher.register(CDL_GET_ROUND_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        return _int(CDL_GET_ROUND_RESPONSE, await countDownLatch.getRound(name));
    });

    // ── Semaphore ─────────────────────────────────────────────────────────────

    dispatcher.register(SEM_INIT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const permits = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = _decodeCpProxyName(iter);
        return _bool(SEM_INIT_RESPONSE, await semaphore.init(name, permits));
    });

    dispatcher.register(SEM_ACQUIRE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const sessionId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const threadId  = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const permits   = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = _decodeCpProxyName(iter);
        const invocationUuid = StringCodec.decode(iter);
        await semaphore.acquire(name, sessionId, threadId, invocationUuid, permits);
        return _empty(SEM_ACQUIRE_RESPONSE);
    });

    dispatcher.register(SEM_RELEASE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const sessionId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const threadId  = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const permits   = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = _decodeCpProxyName(iter);
        const invocationUuid = StringCodec.decode(iter);
        await semaphore.release(name, sessionId, threadId, invocationUuid, permits);
        return _empty(SEM_RELEASE_RESPONSE);
    });

    dispatcher.register(SEM_DRAIN_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const sessionId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const threadId  = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = _decodeCpProxyName(iter);
        const invocationUuid = StringCodec.decode(iter);
        return _int(SEM_DRAIN_RESPONSE, await semaphore.drain(name, sessionId, threadId, invocationUuid));
    });

    dispatcher.register(SEM_CHANGE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const sessionId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const threadId  = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const permits   = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = _decodeCpProxyName(iter);
        const invocationUuid = StringCodec.decode(iter);
        await semaphore.change(name, sessionId, threadId, invocationUuid, permits);
        return _empty(SEM_CHANGE_RESPONSE);
    });

    dispatcher.register(SEM_AVAILABLE_PERMITS_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpProxyName(iter);
        return _int(SEM_AVAILABLE_PERMITS_RESPONSE, await semaphore.availablePermits(name));
    });

    dispatcher.register(SEM_TRY_ACQUIRE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const sessionId = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const threadId  = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const permits   = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const timeoutMs = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = _decodeCpProxyName(iter);
        const invocationUuid = StringCodec.decode(iter);
        return _bool(SEM_TRY_ACQUIRE_RESPONSE, await semaphore.tryAcquire(name, sessionId, threadId, invocationUuid, permits, timeoutMs));
    });
}

// ── Response helpers ──────────────────────────────────────────────────────────

function _empty(t: number): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); msg.add(new CM.Frame(b)); msg.setFinal(); return msg; }
function _bool(t: number, v: boolean): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH + BOOLEAN_SIZE_IN_BYTES); b.fill(0); b.writeUInt32LE(t >>> 0, 0); b.writeUInt8(v ? 1 : 0, RH); msg.add(new CM.Frame(b)); msg.setFinal(); return msg; }
function _int(t: number, v: number): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH + INT_SIZE_IN_BYTES); b.fill(0); b.writeUInt32LE(t >>> 0, 0); b.writeInt32LE(v | 0, RH); msg.add(new CM.Frame(b)); msg.setFinal(); return msg; }
function _long(t: number, v: bigint): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH + LONG_SIZE_IN_BYTES); b.fill(0); b.writeUInt32LE(t >>> 0, 0); b.writeBigInt64LE(v, RH); msg.add(new CM.Frame(b)); msg.setFinal(); return msg; }
function _nullable(t: number, data: Data | null): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); msg.add(new CM.Frame(b)); if (data === null) { msg.add(CM.NULL_FRAME); } else { DataCodec.encode(msg, data); } msg.setFinal(); return msg; }
