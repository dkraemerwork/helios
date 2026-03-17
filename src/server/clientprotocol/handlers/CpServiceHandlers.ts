/**
 * Block C — CP Subsystem Service Protocol Handlers
 *
 * Registers handlers for all CP subsystem opcodes required by hazelcast-client@5.6.x:
 *
 * AtomicLong (service ID=9, 0x09):
 *   AtomicLong.Apply              (0x090100)
 *   AtomicLong.Alter              (0x090200)
 *   AtomicLong.AddAndGet          (0x090300)
 *   AtomicLong.CompareAndSet      (0x090400)
 *   AtomicLong.Get                (0x090500)
 *   AtomicLong.GetAndAdd          (0x090600)
 *   AtomicLong.GetAndSet          (0x090700)
 *   AtomicLong.GetAndAlter        (0x090800)
 *   AtomicLong.AlterAndGet        (0x090900)
 *   AtomicLong.Set                (0x090a00)
 *
 * AtomicRef (service ID=10, 0x0a):
 *   AtomicRef.Apply               (0x0a0100) — handles apply/alter/alterAndGet/getAndAlter via returnValueType+alter
 *   AtomicRef.CompareAndSet       (0x0a0200)
 *   AtomicRef.Contains            (0x0a0300)
 *   AtomicRef.Get                 (0x0a0400)
 *   AtomicRef.Set                 (0x0a0500)
 *   AtomicRef.IsNull              (0x0c0800)
 *   AtomicRef.Clear               (0x0c0900)
 *   AtomicRef.CompareAndSet alias (0x0c0a00, legacy test support)
 *
 * CountDownLatch:
 *   CountDownLatch.TrySetCount    (0x0b0100)
 *   CountDownLatch.Await          (0x0b0200)
 *   CountDownLatch.CountDown      (0x0b0300)
 *   CountDownLatch.GetCount       (0x0b0400)
 *   CountDownLatch.GetRound       (0x0b0500)
 *
 * Semaphore:
 *   Semaphore.Init                (0x0c0100)
 *   Semaphore.Acquire/TryAcquire  (0x0c0200)
 *   Semaphore.Release             (0x0c0300)
 *   Semaphore.Drain               (0x0c0400)
 *   Semaphore.Change              (0x0c0500)
 *   Semaphore.AvailablePermits    (0x0c0600)
 *   Semaphore.GetSemaphoreType    (0x0c0700)
 *
 * CP sessions:
 *   CPSession.CreateSession       (0x1f0100)
 *   CPSession.CloseSession        (0x1f0200)
 *   CPSession.HeartbeatSession    (0x1f0300)
 *   CPSession.GenerateThreadId    (0x1f0400)
 */

import type { ClientMessage } from '../../../client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '../../../client/impl/protocol/ClientMessage.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type {
    AtomicLongOperations,
    AtomicRefOperations,
    CpGroupOperations,
    CpSessionOperations,
    CountDownLatchOperations,
    CPMapOperations,
    FencedLockOperations,
    SemaphoreOperations,
} from './ServiceOperations.js';
import {
    BOOLEAN_SIZE_IN_BYTES,
    FixedSizeTypesCodec,
    INT_SIZE_IN_BYTES,
    LONG_SIZE_IN_BYTES,
    UUID_SIZE_IN_BYTES,
} from '../../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '../../../client/impl/protocol/codec/builtin/StringCodec.js';
import { DataCodec } from '../../../client/impl/protocol/codec/builtin/DataCodec.js';
import { CodecUtil } from '../../../client/impl/protocol/codec/builtin/CodecUtil.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';

// ── AtomicLong message type constants ──────────────────────────────────────────
// AtomicLong service ID = 9 (0x09). Opcodes: (serviceId << 16) | (methodId << 8)
// Methods per protocol spec: apply=1, alter=2, addAndGet=3, compareAndSet=4,
//   get=5, getAndAdd=6, getAndSet=7. Non-spec methods use 0x09 prefix with
//   higher method IDs to avoid collision with other services.

const AL_APPLY_REQUEST           = 0x090100; const AL_APPLY_RESPONSE           = 0x090101;
const AL_ALTER_REQUEST           = 0x090200; const AL_ALTER_RESPONSE           = 0x090201;
const AL_GET_AND_ALTER_REQUEST   = 0x090800; const AL_GET_AND_ALTER_RESPONSE   = 0x090801;
const AL_ALTER_AND_GET_REQUEST   = 0x090900; const AL_ALTER_AND_GET_RESPONSE   = 0x090901;
const AL_ADD_AND_GET_REQUEST     = 0x090300; const AL_ADD_AND_GET_RESPONSE     = 0x090301;
const AL_COMPARE_AND_SET_REQUEST = 0x090400; const AL_COMPARE_AND_SET_RESPONSE = 0x090401;
const AL_GET_REQUEST             = 0x090500; const AL_GET_RESPONSE             = 0x090501;
const AL_GET_AND_ADD_REQUEST     = 0x090600; const AL_GET_AND_ADD_RESPONSE     = 0x090601;
const AL_GET_AND_SET_REQUEST     = 0x090700; const AL_GET_AND_SET_RESPONSE     = 0x090701;
const AL_SET_REQUEST             = 0x090a00; const AL_SET_RESPONSE             = 0x090a01;

// ── AtomicRef message type constants ──────────────────────────────────────────
// AtomicRef service ID = 10 (0x0a). Official methods per protocol spec:
//   apply=1, compareAndSet=2, contains=3, get=4, set=5
// The apply method handles alter/getAndAlter/alterAndGet/apply via
// the `returnValueType` (int) and `alter` (bool) fields in the request.

const AR_APPLY_REQUEST           = 0x0a0100; const AR_APPLY_RESPONSE           = 0x0a0101;
const AR_COMPARE_AND_SET_REQUEST = 0x0a0200; const AR_COMPARE_AND_SET_RESPONSE = 0x0a0201;
const AR_CONTAINS_REQUEST        = 0x0a0300; const AR_CONTAINS_RESPONSE        = 0x0a0301;
const AR_GET_REQUEST             = 0x0a0400; const AR_GET_RESPONSE             = 0x0a0401;
const AR_SET_REQUEST             = 0x0a0500; const AR_SET_RESPONSE             = 0x0a0501;
const AR_IS_NULL_REQUEST         = 0x0c0800; const AR_IS_NULL_RESPONSE         = 0x0c0801;
const AR_CLEAR_REQUEST           = 0x0c0900; const AR_CLEAR_RESPONSE           = 0x0c0901;
const AR_COMPARE_AND_SET_LEGACY_REQUEST = 0x0c0a00; const AR_COMPARE_AND_SET_LEGACY_RESPONSE = 0x0c0a01;

// ── CountDownLatch message type constants ─────────────────────────────────────

const CDL_TRY_SET_COUNT_REQUEST = 0x0b0100; const CDL_TRY_SET_COUNT_RESPONSE = 0x0b0101;
const CDL_AWAIT_REQUEST         = 0x0b0200; const CDL_AWAIT_RESPONSE         = 0x0b0201;
const CDL_COUNT_DOWN_REQUEST    = 0x0b0300; const CDL_COUNT_DOWN_RESPONSE    = 0x0b0301;
const CDL_GET_COUNT_REQUEST     = 0x0b0400; const CDL_GET_COUNT_RESPONSE     = 0x0b0401;
const CDL_GET_ROUND_REQUEST     = 0x0b0500; const CDL_GET_ROUND_RESPONSE     = 0x0b0501;

// ── Semaphore message type constants ──────────────────────────────────────────

const SEM_INIT_REQUEST               = 0x0c0100; const SEM_INIT_RESPONSE               = 0x0c0101;
const SEM_ACQUIRE_REQUEST            = 0x0c0200; const SEM_ACQUIRE_RESPONSE            = 0x0c0201;
const SEM_RELEASE_REQUEST            = 0x0c0300; const SEM_RELEASE_RESPONSE            = 0x0c0301;
const SEM_DRAIN_REQUEST              = 0x0c0400; const SEM_DRAIN_RESPONSE              = 0x0c0401;
const SEM_CHANGE_REQUEST             = 0x0c0500; const SEM_CHANGE_RESPONSE             = 0x0c0501;
const SEM_AVAILABLE_PERMITS_REQUEST  = 0x0c0600; const SEM_AVAILABLE_PERMITS_RESPONSE  = 0x0c0601;
const SEM_GET_TYPE_REQUEST           = 0x0c0700; const SEM_GET_TYPE_RESPONSE           = 0x0c0701;

// ── FencedLock message type constants ─────────────────────────────────────────
// FencedLock service ID = 7 (0x07). Opcodes: lock=1, tryLock=2, unlock=3, getLockOwnership=4.

const FL_LOCK_REQUEST                = 0x070100; const FL_LOCK_RESPONSE                = 0x070101;
const FL_TRY_LOCK_REQUEST            = 0x070200; const FL_TRY_LOCK_RESPONSE            = 0x070201;
const FL_UNLOCK_REQUEST              = 0x070300; const FL_UNLOCK_RESPONSE              = 0x070301;
const FL_GET_LOCK_OWNERSHIP_REQUEST  = 0x070400; const FL_GET_LOCK_OWNERSHIP_RESPONSE  = 0x070401;

const CP_SESSION_CREATE_REQUEST      = 0x1f0100; const CP_SESSION_CREATE_RESPONSE      = 0x1f0101;
const CP_SESSION_CLOSE_REQUEST       = 0x1f0200; const CP_SESSION_CLOSE_RESPONSE       = 0x1f0201;
const CP_SESSION_HEARTBEAT_REQUEST   = 0x1f0300; const CP_SESSION_HEARTBEAT_RESPONSE   = 0x1f0301;
const CP_SESSION_THREAD_ID_REQUEST   = 0x1f0400; const CP_SESSION_THREAD_ID_RESPONSE   = 0x1f0401;

const CP_GROUP_CREATE_REQUEST      = 0x1e0100; const CP_GROUP_CREATE_RESPONSE      = 0x1e0101;
const CP_GROUP_DESTROY_REQUEST     = 0x1e0200; const CP_GROUP_DESTROY_RESPONSE     = 0x1e0201;

// ── CPMap message type constants ──────────────────────────────────────────────
// CPMap service ID = 0x25. Opcodes per Hazelcast protocol F7:
//   get=1, put=2, set=3, remove=4, delete=5, compareAndSet=6, putIfAbsent=7

const CPMAP_GET_REQUEST             = 0x250100; const CPMAP_GET_RESPONSE             = 0x250101;
const CPMAP_PUT_REQUEST             = 0x250200; const CPMAP_PUT_RESPONSE             = 0x250201;
const CPMAP_SET_REQUEST             = 0x250300; const CPMAP_SET_RESPONSE             = 0x250301;
const CPMAP_REMOVE_REQUEST          = 0x250400; const CPMAP_REMOVE_RESPONSE          = 0x250401;
const CPMAP_DELETE_REQUEST          = 0x250500; const CPMAP_DELETE_RESPONSE          = 0x250501;
const CPMAP_COMPARE_AND_SET_REQUEST = 0x250600; const CPMAP_COMPARE_AND_SET_RESPONSE = 0x250601;
const CPMAP_PUT_IF_ABSENT_REQUEST   = 0x250700; const CPMAP_PUT_IF_ABSENT_RESPONSE   = 0x250701;

const REQUEST_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES;
const RESPONSE_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES;

// ── CP group name encoding constants ──────────────────────────────────────────

/**
 * Decode CP proxy name from the first string frame after the initial frame.
 * CP objects are identified by a proxyName that includes the CP group name.
 */
function _scopedCpProxyName(groupName: string, objectName: string): string {
    return groupName === 'default' ? objectName : `${objectName}@${groupName}`;
}

function _decodeCpObjectReference(iter: CM.ForwardFrameIterator): { groupName: string; objectName: string; proxyName: string } {
    if (!iter.hasNext()) {
        throw new Error('Missing CP group frame');
    }

    const firstFrame = iter.next();
    if ((firstFrame.flags & CM.BEGIN_DATA_STRUCTURE_FLAG) === 0) {
        const proxyName = firstFrame.content.toString('utf8');
        const separatorIndex = proxyName.indexOf('@');
        if (separatorIndex < 0) {
            return { groupName: 'default', objectName: proxyName, proxyName };
        }

        const objectName = proxyName.slice(0, separatorIndex).trim();
        const groupName = proxyName.slice(separatorIndex + 1).trim() || 'default';
        return { groupName, objectName, proxyName: _scopedCpProxyName(groupName, objectName) };
    }

    if (!iter.hasNext()) {
        throw new Error('Missing CP group initial frame');
    }

    iter.next();
    const groupName = StringCodec.decode(iter);

    while (iter.hasNext()) {
        const frame = iter.next();
        if ((frame.flags & CM.END_DATA_STRUCTURE_FLAG) !== 0) {
            break;
        }
    }

    const objectName = StringCodec.decode(iter);
    return { groupName, objectName, proxyName: _scopedCpProxyName(groupName, objectName) };
}

function _isNullAtomicReferenceValue(value: Data | null): boolean {
    return value === null || (value.getType() === 0 && value.dataSize() === 0);
}

function _decodeRaftGroupName(iter: CM.ForwardFrameIterator): string {
    if (!iter.hasNext()) {
        throw new Error('Missing CP group frame');
    }

    const firstFrame = iter.next();
    if ((firstFrame.flags & CM.BEGIN_DATA_STRUCTURE_FLAG) === 0) {
        throw new Error('Missing CP group begin frame');
    }

    if (!iter.hasNext()) {
        throw new Error('Missing CP group initial frame');
    }

    iter.next();
    const groupName = StringCodec.decode(iter);

    while (iter.hasNext()) {
        const frame = iter.next();
        if ((frame.flags & CM.END_DATA_STRUCTURE_FLAG) !== 0) {
            break;
        }
    }

    return groupName;
}

function _decodeCountDownLatchAwait(msg: ClientMessage): { name: string; timeoutMs: bigint } {
    const iter = msg.forwardFrameIterator();
    const initialFrame = iter.next();
    const content = initialFrame.content;
    const timeoutOffset = content.length >= REQUEST_HEADER_SIZE + UUID_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES
        ? REQUEST_HEADER_SIZE + UUID_SIZE_IN_BYTES
        : REQUEST_HEADER_SIZE;

    return {
        name: _decodeCpObjectReference(iter).proxyName,
        timeoutMs: content.readBigInt64LE(timeoutOffset),
    };
}

function _decodeCountDownLatchCountDown(msg: ClientMessage): { name: string; expectedRound: number; invocationUuid: string } {
    const iter = msg.forwardFrameIterator();
    const initialFrame = iter.next();
    const content = initialFrame.content;

    if (content.length >= REQUEST_HEADER_SIZE + UUID_SIZE_IN_BYTES + INT_SIZE_IN_BYTES) {
        return {
            name: _decodeCpObjectReference(iter).proxyName,
            expectedRound: content.readInt32LE(REQUEST_HEADER_SIZE + UUID_SIZE_IN_BYTES),
            invocationUuid: FixedSizeTypesCodec.decodeUUID(content, REQUEST_HEADER_SIZE) ?? '',
        };
    }

    const name = _decodeCpObjectReference(iter).proxyName;
    return {
        name,
        expectedRound: content.readInt32LE(REQUEST_HEADER_SIZE),
        invocationUuid: StringCodec.decode(iter),
    };
}

// ── Registration ──────────────────────────────────────────────────────────────

export interface CpServiceHandlersOptions {
    dispatcher: ClientMessageDispatcher;
    cpGroup: CpGroupOperations;
    cpSession: CpSessionOperations;
    atomicLong: AtomicLongOperations;
    atomicRef: AtomicRefOperations;
    countDownLatch: CountDownLatchOperations;
    semaphore: SemaphoreOperations;
    fencedLock: FencedLockOperations;
    cpMap: CPMapOperations;
}

export function registerCpServiceHandlers(opts: CpServiceHandlersOptions): void {
    const { dispatcher, cpGroup, cpSession, atomicLong, atomicRef, countDownLatch, semaphore, fencedLock, cpMap } = opts;

    const handleAtomicRefGet = async (msg: ClientMessage, responseType: number) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpObjectReference(iter).proxyName;
        return _nullable(responseType, await atomicRef.get(name));
    };

    const handleAtomicRefSet = async (msg: ClientMessage, responseType: number) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpObjectReference(iter).proxyName;
        const value = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        await atomicRef.set(name, value);
        return _empty(responseType);
    };

    const handleAtomicRefContains = async (msg: ClientMessage, responseType: number) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpObjectReference(iter).proxyName;
        const value = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        if (_isNullAtomicReferenceValue(value)) {
            return _bool(responseType, await atomicRef.isNull(name));
        }
        return _bool(responseType, await atomicRef.contains(name, value));
    };

    const handleAtomicRefCompareAndSet = async (msg: ClientMessage, responseType: number) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpObjectReference(iter).proxyName;
        const expected = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        const updated = CodecUtil.decodeNullable(iter, i => DataCodec.decode(i));
        return _bool(responseType, await atomicRef.compareAndSet(name, expected, updated));
    };

    dispatcher.register(CP_GROUP_CREATE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const proxyName = StringCodec.decode(iter);
        const groupId = await cpGroup.createCPGroup(proxyName);
        return _raftGroupId(CP_GROUP_CREATE_RESPONSE, groupId);
    });

    dispatcher.register(CP_GROUP_DESTROY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const groupName = _decodeRaftGroupName(iter);
        const serviceName = StringCodec.decode(iter);
        const objectName = StringCodec.decode(iter);
        await cpGroup.destroyCPObject(groupName, serviceName, objectName);
        return _empty(CP_GROUP_DESTROY_RESPONSE);
    });

    dispatcher.register(CP_SESSION_CREATE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const groupName = _decodeRaftGroupName(iter);
        const endpointName = StringCodec.decode(iter);
        const session = await cpSession.createSession(groupName, endpointName);
        return _cpSessionCreateResponse(CP_SESSION_CREATE_RESPONSE, session.sessionId, session.ttlMillis, session.heartbeatMillis);
    });

    dispatcher.register(CP_SESSION_CLOSE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const sessionId = initialFrame.content.readBigInt64LE(REQUEST_HEADER_SIZE);
        const groupName = _decodeRaftGroupName(iter);
        return _bool(CP_SESSION_CLOSE_RESPONSE, await cpSession.closeSession(groupName, sessionId));
    });

    dispatcher.register(CP_SESSION_HEARTBEAT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const sessionId = initialFrame.content.readBigInt64LE(REQUEST_HEADER_SIZE);
        const groupName = _decodeRaftGroupName(iter);
        await cpSession.heartbeatSession(groupName, sessionId);
        return _empty(CP_SESSION_HEARTBEAT_RESPONSE);
    });

    dispatcher.register(CP_SESSION_THREAD_ID_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const groupName = _decodeRaftGroupName(iter);
        return _long(CP_SESSION_THREAD_ID_RESPONSE, await cpSession.generateThreadId(groupName));
    });

    // ── AtomicLong ────────────────────────────────────────────────────────────

    dispatcher.register(AL_GET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpObjectReference(iter).proxyName;
        return _long(AL_GET_RESPONSE, await atomicLong.get(name));
    });

    dispatcher.register(AL_SET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const value = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = _decodeCpObjectReference(iter).proxyName;
        await atomicLong.set(name, value);
        return _empty(AL_SET_RESPONSE);
    });

    dispatcher.register(AL_GET_AND_SET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const value = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = _decodeCpObjectReference(iter).proxyName;
        return _long(AL_GET_AND_SET_RESPONSE, await atomicLong.getAndSet(name, value));
    });

    dispatcher.register(AL_ADD_AND_GET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const delta = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = _decodeCpObjectReference(iter).proxyName;
        return _long(AL_ADD_AND_GET_RESPONSE, await atomicLong.addAndGet(name, delta));
    });

    dispatcher.register(AL_GET_AND_ADD_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const delta = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = _decodeCpObjectReference(iter).proxyName;
        return _long(AL_GET_AND_ADD_RESPONSE, await atomicLong.getAndAdd(name, delta));
    });

    dispatcher.register(AL_COMPARE_AND_SET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const expect = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const update = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const name = _decodeCpObjectReference(iter).proxyName;
        return _bool(AL_COMPARE_AND_SET_RESPONSE, await atomicLong.compareAndSet(name, expect, update));
    });

    dispatcher.register(AL_ALTER_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpObjectReference(iter).proxyName;
        const fn = DataCodec.decode(iter);
        await atomicLong.alter(name, fn);
        return _empty(AL_ALTER_RESPONSE);
    });

    dispatcher.register(AL_ALTER_AND_GET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpObjectReference(iter).proxyName;
        const fn = DataCodec.decode(iter);
        return _long(AL_ALTER_AND_GET_RESPONSE, await atomicLong.alterAndGet(name, fn));
    });

    dispatcher.register(AL_GET_AND_ALTER_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpObjectReference(iter).proxyName;
        const fn = DataCodec.decode(iter);
        return _long(AL_GET_AND_ALTER_RESPONSE, await atomicLong.getAndAlter(name, fn));
    });

    dispatcher.register(AL_APPLY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpObjectReference(iter).proxyName;
        const fn = DataCodec.decode(iter);
        return _nullable(AL_APPLY_RESPONSE, await atomicLong.apply(name, fn));
    });

    // ── AtomicRef ─────────────────────────────────────────────────────────────

    dispatcher.register(AR_GET_REQUEST, async (msg, _s) => handleAtomicRefGet(msg, AR_GET_RESPONSE));

    dispatcher.register(AR_SET_REQUEST, async (msg, _s) => handleAtomicRefSet(msg, AR_SET_RESPONSE));

    dispatcher.register(AR_IS_NULL_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpObjectReference(iter).proxyName;
        return _bool(AR_IS_NULL_RESPONSE, await atomicRef.isNull(name));
    });

    dispatcher.register(AR_CLEAR_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpObjectReference(iter).proxyName;
        await atomicRef.clear(name);
        return _empty(AR_CLEAR_RESPONSE);
    });

    dispatcher.register(AR_CONTAINS_REQUEST, async (msg, _s) => handleAtomicRefContains(msg, AR_CONTAINS_RESPONSE));

    dispatcher.register(AR_COMPARE_AND_SET_REQUEST, async (msg, _s) => handleAtomicRefCompareAndSet(msg, AR_COMPARE_AND_SET_RESPONSE));
    dispatcher.register(AR_COMPARE_AND_SET_LEGACY_REQUEST, async (msg, _s) => handleAtomicRefCompareAndSet(msg, AR_COMPARE_AND_SET_LEGACY_RESPONSE));

    // AtomicRef.Apply (0x0a0100) — unified handler for apply/alter/alterAndGet/getAndAlter.
    // The request carries returnValueType (int) and alter (bool) after the function frame:
    //   returnValueType: 0=no value, 1=old value, 2=new value
    //   alter: true if the function result should be written back to the reference
    dispatcher.register(AR_APPLY_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const returnValueType = initialFrame.content.readInt32LE(REQUEST_HEADER_SIZE);
        const doAlter = initialFrame.content.readUInt8(REQUEST_HEADER_SIZE + INT_SIZE_IN_BYTES) !== 0;
        const name = _decodeCpObjectReference(iter).proxyName;
        const fn = DataCodec.decode(iter);

        if (doAlter && returnValueType === 0) {
            await atomicRef.alter(name, fn);
            return _empty(AR_APPLY_RESPONSE);
        }
        if (doAlter && returnValueType === 2) {
            return _nullable(AR_APPLY_RESPONSE, await atomicRef.alterAndGet(name, fn));
        }
        if (doAlter && returnValueType === 1) {
            return _nullable(AR_APPLY_RESPONSE, await atomicRef.getAndAlter(name, fn));
        }
        return _nullable(AR_APPLY_RESPONSE, await atomicRef.apply(name, fn));
    });

    // ── CountDownLatch ────────────────────────────────────────────────────────

    dispatcher.register(CDL_TRY_SET_COUNT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const count = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = _decodeCpObjectReference(iter).proxyName;
        return _bool(CDL_TRY_SET_COUNT_RESPONSE, await countDownLatch.trySetCount(name, count));
    });

    dispatcher.register(CDL_AWAIT_REQUEST, async (msg, _s) => {
        const { name, timeoutMs } = _decodeCountDownLatchAwait(msg);
        return _bool(CDL_AWAIT_RESPONSE, await countDownLatch.await(name, timeoutMs));
    });

    dispatcher.register(CDL_COUNT_DOWN_REQUEST, async (msg, _s) => {
        const { name, expectedRound, invocationUuid } = _decodeCountDownLatchCountDown(msg);
        await countDownLatch.countDown(name, expectedRound, invocationUuid);
        return _empty(CDL_COUNT_DOWN_RESPONSE);
    });

    dispatcher.register(CDL_GET_COUNT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpObjectReference(iter).proxyName;
        return _int(CDL_GET_COUNT_RESPONSE, await countDownLatch.getCount(name));
    });

    dispatcher.register(CDL_GET_ROUND_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpObjectReference(iter).proxyName;
        return _int(CDL_GET_ROUND_RESPONSE, await countDownLatch.getRound(name));
    });

    // ── Semaphore ─────────────────────────────────────────────────────────────

    dispatcher.register(SEM_INIT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const permits = f.content.readInt32LE(REQUEST_HEADER_SIZE);
        const name = _decodeCpObjectReference(iter).proxyName;
        return _bool(SEM_INIT_RESPONSE, await semaphore.init(name, permits));
    });

    dispatcher.register(SEM_ACQUIRE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const sessionId = f.content.readBigInt64LE(REQUEST_HEADER_SIZE);
        const threadId  = f.content.readBigInt64LE(REQUEST_HEADER_SIZE + LONG_SIZE_IN_BYTES);
        const invocationUuid = FixedSizeTypesCodec.decodeUUID(f.content, REQUEST_HEADER_SIZE + (LONG_SIZE_IN_BYTES * 2)) ?? '';
        const permits = f.content.readInt32LE(REQUEST_HEADER_SIZE + (LONG_SIZE_IN_BYTES * 2) + UUID_SIZE_IN_BYTES);
        const timeoutMs = f.content.readBigInt64LE(REQUEST_HEADER_SIZE + (LONG_SIZE_IN_BYTES * 2) + UUID_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = _decodeCpObjectReference(iter).proxyName;
        return _bool(SEM_ACQUIRE_RESPONSE, await semaphore.acquire(name, sessionId, threadId, invocationUuid, permits, timeoutMs));
    });

    dispatcher.register(SEM_RELEASE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const sessionId = f.content.readBigInt64LE(REQUEST_HEADER_SIZE);
        const threadId  = f.content.readBigInt64LE(REQUEST_HEADER_SIZE + LONG_SIZE_IN_BYTES);
        const invocationUuid = FixedSizeTypesCodec.decodeUUID(f.content, REQUEST_HEADER_SIZE + (LONG_SIZE_IN_BYTES * 2)) ?? '';
        const permits   = f.content.readInt32LE(REQUEST_HEADER_SIZE + (LONG_SIZE_IN_BYTES * 2) + UUID_SIZE_IN_BYTES);
        const name = _decodeCpObjectReference(iter).proxyName;
        await semaphore.release(name, sessionId, threadId, invocationUuid, permits);
        return _empty(SEM_RELEASE_RESPONSE);
    });

    dispatcher.register(SEM_DRAIN_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const sessionId = f.content.readBigInt64LE(REQUEST_HEADER_SIZE);
        const threadId  = f.content.readBigInt64LE(REQUEST_HEADER_SIZE + LONG_SIZE_IN_BYTES);
        const invocationUuid = FixedSizeTypesCodec.decodeUUID(f.content, REQUEST_HEADER_SIZE + (LONG_SIZE_IN_BYTES * 2)) ?? '';
        const name = _decodeCpObjectReference(iter).proxyName;
        return _int(SEM_DRAIN_RESPONSE, await semaphore.drain(name, sessionId, threadId, invocationUuid));
    });

    dispatcher.register(SEM_CHANGE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const sessionId = f.content.readBigInt64LE(REQUEST_HEADER_SIZE);
        const threadId  = f.content.readBigInt64LE(REQUEST_HEADER_SIZE + LONG_SIZE_IN_BYTES);
        const invocationUuid = FixedSizeTypesCodec.decodeUUID(f.content, REQUEST_HEADER_SIZE + (LONG_SIZE_IN_BYTES * 2)) ?? '';
        const permits   = f.content.readInt32LE(REQUEST_HEADER_SIZE + (LONG_SIZE_IN_BYTES * 2) + UUID_SIZE_IN_BYTES);
        const name = _decodeCpObjectReference(iter).proxyName;
        await semaphore.change(name, sessionId, threadId, invocationUuid, permits);
        return _empty(SEM_CHANGE_RESPONSE);
    });

    dispatcher.register(SEM_AVAILABLE_PERMITS_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const name = _decodeCpObjectReference(iter).proxyName;
        return _int(SEM_AVAILABLE_PERMITS_RESPONSE, await semaphore.availablePermits(name));
    });

    dispatcher.register(SEM_GET_TYPE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = _decodeCpObjectReference(iter).proxyName;
        return _bool(SEM_GET_TYPE_RESPONSE, await semaphore.isJdkCompatible(name));
    });

    // ── FencedLock ────────────────────────────────────────────────────────────
    //
    // Initial frame layout (after TYPE+CORR_ID at offsets 0-11):
    //   PARTITION_ID(4)     @ 12  (REQUEST_HEADER_SIZE = 16)
    //   SESSION_ID(8)       @ 16
    //   THREAD_ID(8)        @ 24
    //   INVOCATION_UID(17)  @ 32
    //   [TIMEOUT_MS(8)      @ 49  — TryLock only]
    //
    // Variable frames: RaftGroupId struct (BEGIN + initial-frame + name + END),
    //                  then lock name string.

    const FL_SESSION_ID_OFFSET     = REQUEST_HEADER_SIZE;
    const FL_THREAD_ID_OFFSET      = FL_SESSION_ID_OFFSET    + LONG_SIZE_IN_BYTES;
    const FL_INVOCATION_UID_OFFSET = FL_THREAD_ID_OFFSET     + LONG_SIZE_IN_BYTES;
    const FL_TIMEOUT_MS_OFFSET     = FL_INVOCATION_UID_OFFSET + UUID_SIZE_IN_BYTES;

    dispatcher.register(FL_LOCK_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const sessionId     = f.content.readBigInt64LE(FL_SESSION_ID_OFFSET);
        const threadId      = f.content.readBigInt64LE(FL_THREAD_ID_OFFSET);
        const invocationUid = FixedSizeTypesCodec.decodeUUID(f.content, FL_INVOCATION_UID_OFFSET) ?? '';
        const groupName     = _decodeRaftGroupName(iter);
        const lockName      = StringCodec.decode(iter);
        const fence         = await fencedLock.lock(groupName, lockName, sessionId, threadId, invocationUid);
        return _long(FL_LOCK_RESPONSE, fence);
    });

    dispatcher.register(FL_TRY_LOCK_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const sessionId     = f.content.readBigInt64LE(FL_SESSION_ID_OFFSET);
        const threadId      = f.content.readBigInt64LE(FL_THREAD_ID_OFFSET);
        const invocationUid = FixedSizeTypesCodec.decodeUUID(f.content, FL_INVOCATION_UID_OFFSET) ?? '';
        const timeoutMs     = f.content.length > FL_TIMEOUT_MS_OFFSET
            ? f.content.readBigInt64LE(FL_TIMEOUT_MS_OFFSET)
            : 0n;
        const groupName     = _decodeRaftGroupName(iter);
        const lockName      = StringCodec.decode(iter);
        const fence         = await fencedLock.tryLock(groupName, lockName, sessionId, threadId, invocationUid, timeoutMs);
        return _long(FL_TRY_LOCK_RESPONSE, fence);
    });

    dispatcher.register(FL_UNLOCK_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const sessionId     = f.content.readBigInt64LE(FL_SESSION_ID_OFFSET);
        const threadId      = f.content.readBigInt64LE(FL_THREAD_ID_OFFSET);
        const invocationUid = FixedSizeTypesCodec.decodeUUID(f.content, FL_INVOCATION_UID_OFFSET) ?? '';
        const groupName     = _decodeRaftGroupName(iter);
        const lockName      = StringCodec.decode(iter);
        const result        = await fencedLock.unlock(groupName, lockName, sessionId, threadId, invocationUid);
        return _bool(FL_UNLOCK_RESPONSE, result);
    });

    dispatcher.register(FL_GET_LOCK_OWNERSHIP_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next(); // initial frame — no extra fields for GetLockOwnership
        const groupName = _decodeRaftGroupName(iter);
        const lockName  = StringCodec.decode(iter);
        const ownership = await fencedLock.getLockOwnership(groupName, lockName);
        return _lockOwnership(FL_GET_LOCK_OWNERSHIP_RESPONSE, ownership);
    });

    // ── CPMap ─────────────────────────────────────────────────────────────────
    //
    // CPMap request layout (after TYPE+CORR_ID at offsets 0-7):
    //   No fixed fields in initial frame (after the standard header)
    //   Variable frames: map name (string), key (Data), [value (Data)], [expectedValue (Data)], [newValue (Data)]

    dispatcher.register(CPMAP_GET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _nullable(CPMAP_GET_RESPONSE, await cpMap.get(name, key));
    });

    dispatcher.register(CPMAP_PUT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _nullable(CPMAP_PUT_RESPONSE, await cpMap.put(name, key, value));
    });

    dispatcher.register(CPMAP_SET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        await cpMap.set(name, key, value);
        return _empty(CPMAP_SET_RESPONSE);
    });

    dispatcher.register(CPMAP_REMOVE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return _nullable(CPMAP_REMOVE_RESPONSE, await cpMap.remove(name, key));
    });

    dispatcher.register(CPMAP_DELETE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        await cpMap.delete(name, key);
        return _empty(CPMAP_DELETE_RESPONSE);
    });

    dispatcher.register(CPMAP_COMPARE_AND_SET_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const expectedValue = DataCodec.decode(iter);
        const newValue = DataCodec.decode(iter);
        return _bool(CPMAP_COMPARE_AND_SET_RESPONSE, await cpMap.compareAndSet(name, key, expectedValue, newValue));
    });

    dispatcher.register(CPMAP_PUT_IF_ABSENT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return _nullable(CPMAP_PUT_IF_ABSENT_RESPONSE, await cpMap.putIfAbsent(name, key, value));
    });
}

// ── Response helpers ──────────────────────────────────────────────────────────

function _empty(t: number): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE); b.fill(0); b.writeUInt32LE(t >>> 0, 0); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg; }
function _bool(t: number, v: boolean): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE + BOOLEAN_SIZE_IN_BYTES); b.fill(0); b.writeUInt32LE(t >>> 0, 0); b.writeUInt8(v ? 1 : 0, RESPONSE_HEADER_SIZE); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg; }
function _int(t: number, v: number): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE + INT_SIZE_IN_BYTES); b.fill(0); b.writeUInt32LE(t >>> 0, 0); b.writeInt32LE(v | 0, RESPONSE_HEADER_SIZE); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg; }
function _long(t: number, v: bigint): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE + LONG_SIZE_IN_BYTES); b.fill(0); b.writeUInt32LE(t >>> 0, 0); b.writeBigInt64LE(v, RESPONSE_HEADER_SIZE); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg; }
function _cpSessionCreateResponse(t: number, sessionId: bigint, ttlMillis: bigint, heartbeatMillis: bigint): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE + (LONG_SIZE_IN_BYTES * 3)); b.fill(0); b.writeUInt32LE(t >>> 0, 0); b.writeBigInt64LE(sessionId, RESPONSE_HEADER_SIZE); b.writeBigInt64LE(ttlMillis, RESPONSE_HEADER_SIZE + LONG_SIZE_IN_BYTES); b.writeBigInt64LE(heartbeatMillis, RESPONSE_HEADER_SIZE + (LONG_SIZE_IN_BYTES * 2)); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg; }
function _nullable(t: number, data: Data | null): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE); b.fill(0); b.writeUInt32LE(t >>> 0, 0); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); if (data === null) { msg.add(CM.NULL_FRAME); } else { DataCodec.encode(msg, data); } msg.setFinal(); return msg; }
function _raftGroupId(t: number, groupId: { name: string; seed: bigint; id: bigint }): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE); b.fill(0); b.writeUInt32LE(t >>> 0, 0); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.add(CM.BEGIN_FRAME); const initial = Buffer.allocUnsafe(LONG_SIZE_IN_BYTES * 2); initial.writeBigInt64LE(groupId.seed, 0); initial.writeBigInt64LE(groupId.id, LONG_SIZE_IN_BYTES); msg.add(new CM.Frame(initial)); StringCodec.encode(msg, groupId.name); msg.add(CM.END_FRAME); msg.setFinal(); return msg; }

/**
 * Encode FencedLock.GetLockOwnership response.
 *
 * Response layout (from FencedLockGetLockOwnershipCodec):
 *   FENCE(8)      @ RESPONSE_HEADER_SIZE
 *   LOCK_COUNT(4) @ RESPONSE_HEADER_SIZE + 8
 *   SESSION_ID(8) @ RESPONSE_HEADER_SIZE + 12
 *   THREAD_ID(8)  @ RESPONSE_HEADER_SIZE + 20
 */
function _lockOwnership(
    t: number,
    ownership: { fence: bigint; lockCount: number; sessionId: bigint; threadId: bigint },
): ClientMessage {
    const PAYLOAD_SIZE = LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES; // 8+4+8+8 = 28
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE + PAYLOAD_SIZE);
    b.fill(0);
    b.writeUInt32LE(t >>> 0, 0);
    b.writeBigInt64LE(ownership.fence,     RESPONSE_HEADER_SIZE);
    b.writeInt32LE(ownership.lockCount | 0, RESPONSE_HEADER_SIZE + LONG_SIZE_IN_BYTES);
    b.writeBigInt64LE(ownership.sessionId, RESPONSE_HEADER_SIZE + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
    b.writeBigInt64LE(ownership.threadId,  RESPONSE_HEADER_SIZE + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}
