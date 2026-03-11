/**
 * Block C — Executor Service Protocol Handlers
 *
 * Registers handlers for all Executor opcodes required by hazelcast-client@5.6.x:
 *
 *   ExecutorService.Shutdown          (0x0a0100)
 *   ExecutorService.IsShutdown        (0x0a0200)
 *   ExecutorService.IsTerminated      (0x0a0300)
 *   ExecutorService.CancelOnPartition (0x0a0400)
 *   ExecutorService.CancelOnMember    (0x0a0500)
 *   ExecutorService.SubmitToPartition (0x0a0600)
 *   ExecutorService.SubmitToMember    (0x0a0700)
 *
 * Also registers DurableExecutor handlers:
 *   DurableExecutor.Shutdown          (0x0f0100)
 *   DurableExecutor.IsShutdown        (0x0f0200)
 *   DurableExecutor.Submit            (0x0f0300)
 *   DurableExecutor.RetrieveAndDispose (0x0f0400)
 *   DurableExecutor.Dispose           (0x0f0500)
 *   DurableExecutor.Retrieve          (0x0f0600)
 */

import type { ClientMessage } from '../../../client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '../../../client/impl/protocol/ClientMessage.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { ExecutorServiceOperations } from './ServiceOperations.js';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES, UUID_SIZE_IN_BYTES } from '../../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '../../../client/impl/protocol/codec/builtin/StringCodec.js';
import { DataCodec } from '../../../client/impl/protocol/codec/builtin/DataCodec.js';

// ── Message type constants ─────────────────────────────────────────────────────

const EXEC_SHUTDOWN_REQUEST         = 0x0a0100; const EXEC_SHUTDOWN_RESPONSE         = 0x0a0101;
const EXEC_IS_SHUTDOWN_REQUEST      = 0x0a0200; const EXEC_IS_SHUTDOWN_RESPONSE      = 0x0a0201;
const EXEC_IS_TERMINATED_REQUEST    = 0x0a0300; const EXEC_IS_TERMINATED_RESPONSE    = 0x0a0301;
const EXEC_CANCEL_ON_PART_REQUEST   = 0x0a0400; const EXEC_CANCEL_ON_PART_RESPONSE   = 0x0a0401;
const EXEC_CANCEL_ON_MEMBER_REQUEST = 0x0a0500; const EXEC_CANCEL_ON_MEMBER_RESPONSE = 0x0a0501;
const EXEC_SUBMIT_TO_PART_REQUEST   = 0x0a0600; const EXEC_SUBMIT_TO_PART_RESPONSE   = 0x0a0601;
const EXEC_SUBMIT_TO_MEMBER_REQUEST = 0x0a0700; const EXEC_SUBMIT_TO_MEMBER_RESPONSE = 0x0a0701;

const DE_SHUTDOWN_REQUEST      = 0x0f0100; const DE_SHUTDOWN_RESPONSE      = 0x0f0101;
const DE_IS_SHUTDOWN_REQUEST   = 0x0f0200; const DE_IS_SHUTDOWN_RESPONSE   = 0x0f0201;
const DE_SUBMIT_REQUEST        = 0x0f0300; const DE_SUBMIT_RESPONSE        = 0x0f0301;
const DE_RETRIEVE_DISPOSE_REQUEST = 0x0f0400; const DE_RETRIEVE_DISPOSE_RESPONSE = 0x0f0401;
const DE_DISPOSE_REQUEST       = 0x0f0500; const DE_DISPOSE_RESPONSE       = 0x0f0501;
const DE_RETRIEVE_REQUEST      = 0x0f0600; const DE_RETRIEVE_RESPONSE      = 0x0f0601;

const RH = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES;

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

    dispatcher.register(DE_SUBMIT_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const partitionId = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const name = StringCodec.decode(iter);
        const callable = DataCodec.decode(iter);
        const uuid = crypto.randomUUID();
        await operations.submitToPartition(name, uuid, callable, partitionId);
        return _long(DE_SUBMIT_RESPONSE, 0n); // sequence = 0
    });

    dispatcher.register(DE_RETRIEVE_DISPOSE_REQUEST, async (msg, _s) => {
        // Retrieve result and dispose — return null (fire-and-forget in this implementation)
        return _nullable(DE_RETRIEVE_DISPOSE_RESPONSE, null);
    });

    dispatcher.register(DE_DISPOSE_REQUEST, async (msg, _s) => {
        return _empty(DE_DISPOSE_RESPONSE);
    });

    dispatcher.register(DE_RETRIEVE_REQUEST, async (msg, _s) => {
        return _nullable(DE_RETRIEVE_RESPONSE, null);
    });
}

// ── Response helpers ──────────────────────────────────────────────────────────

import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';

function _empty(t: number): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg; }
function _bool(t: number, v: boolean): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH + BOOLEAN_SIZE_IN_BYTES); b.fill(0); b.writeUInt32LE(t >>> 0, 0); b.writeUInt8(v ? 1 : 0, RH); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg; }
function _long(t: number, v: bigint): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH + LONG_SIZE_IN_BYTES); b.fill(0); b.writeUInt32LE(t >>> 0, 0); b.writeBigInt64LE(v, RH); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg; }
function _nullable(t: number, data: Data | null): ClientMessage { const msg = CM.createForEncode(); const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0); const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG; msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); if (data === null) { msg.add(CM.NULL_FRAME); } else { DataCodec.encode(msg, data); } msg.setFinal(); return msg; }
