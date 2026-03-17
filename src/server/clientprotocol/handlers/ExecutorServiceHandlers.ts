/**
 * Block C — Executor Service Protocol Handlers
 *
 * Registers handlers for all Executor opcodes required by hazelcast-client@5.6.x:
 *
 *   ExecutorService.Shutdown          (0x080100)  service id=8
 *   ExecutorService.IsShutdown        (0x080200)
 *   ExecutorService.IsTerminated      (0x080300)
 *   ExecutorService.CancelOnPartition (0x080400)
 *   ExecutorService.CancelOnMember    (0x080500)
 *   ExecutorService.SubmitToPartition (0x080600)
 *   ExecutorService.SubmitToMember    (0x080700)
 *
 * Also registers DurableExecutor handlers:
 *   DurableExecutor.Shutdown                (0x180100)  service id=24
 *   DurableExecutor.IsShutdown              (0x180200)
 *   DurableExecutor.SubmitToPartition       (0x180300)
 *   DurableExecutor.RetrieveResult          (0x180400)
 *   DurableExecutor.DisposeResult           (0x180500)
 *   DurableExecutor.RetrieveAndDisposeResult (0x180600)
 *
 * Wire protocol source: hazelcast/hazelcast-client-protocol DurableExecutor.yaml (id: 24)
 * NOTE: 0x0f0x00 is TransactionalMultiMap (service id=15) — DO NOT use for DurableExecutor.
 */

import type { ClientMessage } from '../../../client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '../../../client/impl/protocol/ClientMessage.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { ExecutorServiceOperations } from './ServiceOperations.js';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES, BYTE_SIZE_IN_BYTES, UUID_SIZE_IN_BYTES } from '../../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '../../../client/impl/protocol/codec/builtin/StringCodec.js';
import { DataCodec } from '../../../client/impl/protocol/codec/builtin/DataCodec.js';

// ── Message type constants ─────────────────────────────────────────────────────

const EXEC_SHUTDOWN_REQUEST         = 0x080100; const EXEC_SHUTDOWN_RESPONSE         = 0x080101;
const EXEC_IS_SHUTDOWN_REQUEST      = 0x080200; const EXEC_IS_SHUTDOWN_RESPONSE      = 0x080201;
const EXEC_IS_TERMINATED_REQUEST    = 0x080300; const EXEC_IS_TERMINATED_RESPONSE    = 0x080301;
const EXEC_CANCEL_ON_PART_REQUEST   = 0x080400; const EXEC_CANCEL_ON_PART_RESPONSE   = 0x080401;
const EXEC_CANCEL_ON_MEMBER_REQUEST = 0x080500; const EXEC_CANCEL_ON_MEMBER_RESPONSE = 0x080501;
const EXEC_SUBMIT_TO_PART_REQUEST   = 0x080600; const EXEC_SUBMIT_TO_PART_RESPONSE   = 0x080601;
const EXEC_SUBMIT_TO_MEMBER_REQUEST = 0x080700; const EXEC_SUBMIT_TO_MEMBER_RESPONSE = 0x080701;

// DurableExecutor service id=24 (0x18) — hazelcast-client-protocol DurableExecutor.yaml
const DE_SHUTDOWN_REQUEST            = 0x180100; const DE_SHUTDOWN_RESPONSE            = 0x180101;
const DE_IS_SHUTDOWN_REQUEST         = 0x180200; const DE_IS_SHUTDOWN_RESPONSE         = 0x180201;
const DE_SUBMIT_REQUEST              = 0x180300; const DE_SUBMIT_RESPONSE              = 0x180301;
const DE_RETRIEVE_REQUEST            = 0x180400; const DE_RETRIEVE_RESPONSE            = 0x180401;
const DE_DISPOSE_REQUEST             = 0x180500; const DE_DISPOSE_RESPONSE             = 0x180501;
const DE_RETRIEVE_DISPOSE_REQUEST    = 0x180600; const DE_RETRIEVE_DISPOSE_RESPONSE    = 0x180601;

/** Request initial frame header: type(4) + correlationId(8) + partitionId(4) = 16 */
const RH = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES;
/** Response initial frame header: type(4) + correlationId(8) + backupAcks(1) = 13 */
const RESP_H = CM.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + BYTE_SIZE_IN_BYTES;

// ── Registration ──────────────────────────────────────────────────────────────

export function registerExecutorServiceHandlers(
    dispatcher: ClientMessageDispatcher,
    operations: ExecutorServiceOperations,
): void {
    // ExecutorService.Shutdown
    dispatcher.register(EXEC_SHUTDOWN_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        await operations.shutdown(StringCodec.decode(iter));
        return _empty(EXEC_SHUTDOWN_RESPONSE);
    });

    // ExecutorService.IsShutdown
    dispatcher.register(EXEC_IS_SHUTDOWN_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _bool(EXEC_IS_SHUTDOWN_RESPONSE, await operations.isShutdown(StringCodec.decode(iter)));
    });

    // ExecutorService.IsTerminated (alias IsShutdown)
    dispatcher.register(EXEC_IS_TERMINATED_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _bool(EXEC_IS_TERMINATED_RESPONSE, await operations.isShutdown(StringCodec.decode(iter)));
    });

    // ExecutorService.CancelOnPartition
    dispatcher.register(EXEC_CANCEL_ON_PART_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const partitionId = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const interrupt = f.content.readUInt8(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + INT_SIZE_IN_BYTES) !== 0;
        const uuid = StringCodec.decode(iter);
        return _bool(EXEC_CANCEL_ON_PART_RESPONSE, await operations.cancelOnPartition(uuid, partitionId, interrupt));
    });

    // ExecutorService.CancelOnMember
    dispatcher.register(EXEC_CANCEL_ON_MEMBER_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const interrupt = f.content.readUInt8(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES - BOOLEAN_SIZE_IN_BYTES) !== 0;
        const uuid = StringCodec.decode(iter);
        const memberUuid = StringCodec.decode(iter);
        return _bool(EXEC_CANCEL_ON_MEMBER_RESPONSE, await operations.cancelOnMember(uuid, memberUuid, interrupt));
    });

    // ExecutorService.SubmitToPartition
    dispatcher.register(EXEC_SUBMIT_TO_PART_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const partitionId = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + UUID_SIZE_IN_BYTES);
        const uuid = StringCodec.decode(iter);
        const callable = DataCodec.decode(iter);
        // For named executor: second string is the name; we don't expose it here
        const name = StringCodec.decode(iter);
        await operations.submitToPartition(name, uuid, callable, partitionId);
        return _empty(EXEC_SUBMIT_TO_PART_RESPONSE);
    });

    // ExecutorService.SubmitToMember
    dispatcher.register(EXEC_SUBMIT_TO_MEMBER_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const uuid = StringCodec.decode(iter);
        const callable = DataCodec.decode(iter);
        const memberUuid = StringCodec.decode(iter);
        const name = StringCodec.decode(iter);
        await operations.submitToMember(name, uuid, callable, memberUuid);
        return _empty(EXEC_SUBMIT_TO_MEMBER_RESPONSE);
    });

    // DurableExecutor ops (simplified — route through same operations interface)

    dispatcher.register(DE_SHUTDOWN_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        await operations.shutdown(StringCodec.decode(iter));
        return _empty(DE_SHUTDOWN_RESPONSE);
    });

    dispatcher.register(DE_IS_SHUTDOWN_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        return _bool(DE_IS_SHUTDOWN_RESPONSE, await operations.isShutdown(StringCodec.decode(iter)));
    });

    // DurableExecutor.SubmitToPartition — request: partitionId(int), name(string), callable(data)
    // Response: sequence(int) — 32-bit per protocol spec (DurableExecutor.yaml id=24 method=3)
    dispatcher.register(DE_SUBMIT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const partitionId = f.content.readInt32LE(RH);
        const name = StringCodec.decode(iter);
        const callable = DataCodec.decode(iter);
        const { sequence } = await operations.durableSubmitToPartition(name, callable, partitionId);
        return _int(DE_SUBMIT_RESPONSE, sequence);
    });

    // DurableExecutor.RetrieveResult — request: name(string), sequence(int); response: Data|null
    dispatcher.register(DE_RETRIEVE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const sequence = f.content.readInt32LE(RH);
        const name = StringCodec.decode(iter);
        const result = await operations.durableRetrieveResult(name, sequence);
        return _nullable(DE_RETRIEVE_RESPONSE, result);
    });

    // DurableExecutor.DisposeResult — request: name(string), sequence(int); response: empty
    dispatcher.register(DE_DISPOSE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const sequence = f.content.readInt32LE(RH);
        const name = StringCodec.decode(iter);
        await operations.durableDisposeResult(name, sequence);
        return _empty(DE_DISPOSE_RESPONSE);
    });

    // DurableExecutor.RetrieveAndDisposeResult — request: name(string), sequence(int); response: Data|null
    dispatcher.register(DE_RETRIEVE_DISPOSE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const sequence = f.content.readInt32LE(RH);
        const name = StringCodec.decode(iter);
        const result = await operations.durableRetrieveResult(name, sequence);
        await operations.durableDisposeResult(name, sequence);
        return _nullable(DE_RETRIEVE_DISPOSE_RESPONSE, result);
    });
}

// ── Response helpers ──────────────────────────────────────────────────────────

import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';

function _empty(t: number): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RESP_H);
    b.fill(0);
    b.writeUInt32LE(t >>> 0, 0);
    msg.add(new CM.Frame(b, CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG));
    msg.setFinal();
    return msg;
}

function _bool(t: number, v: boolean): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RESP_H + BOOLEAN_SIZE_IN_BYTES);
    b.fill(0);
    b.writeUInt32LE(t >>> 0, 0);
    b.writeUInt8(v ? 1 : 0, RESP_H);
    msg.add(new CM.Frame(b, CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG));
    msg.setFinal();
    return msg;
}

function _int(t: number, v: number): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RESP_H + INT_SIZE_IN_BYTES);
    b.fill(0);
    b.writeUInt32LE(t >>> 0, 0);
    b.writeInt32LE(v, RESP_H);
    msg.add(new CM.Frame(b, CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG));
    msg.setFinal();
    return msg;
}

function _nullable(t: number, data: Data | null): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RESP_H);
    b.fill(0);
    b.writeUInt32LE(t >>> 0, 0);
    msg.add(new CM.Frame(b, CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG));
    if (data === null) {
        msg.add(CM.NULL_FRAME);
    } else {
        DataCodec.encode(msg, data);
    }
    msg.setFinal();
    return msg;
}
