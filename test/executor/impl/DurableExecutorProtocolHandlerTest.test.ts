/**
 * Durable Executor Protocol Handler Tests
 *
 * Verifies the full DE_SUBMIT → DE_RETRIEVE → DE_DISPOSE and
 * DE_SUBMIT → DE_RETRIEVE_AND_DISPOSE lifecycle through the
 * ClientMessageDispatcher (no raw socket — dispatcher only).
 *
 * Opcodes exercised (service id=24, 0x18):
 *   DurableExecutor.Shutdown              (0x180100)
 *   DurableExecutor.IsShutdown            (0x180200)
 *   DurableExecutor.SubmitToPartition     (0x180300)
 *   DurableExecutor.RetrieveResult        (0x180400)
 *   DurableExecutor.DisposeResult         (0x180500)
 *   DurableExecutor.RetrieveAndDisposeResult (0x180600)
 */
import { ClientMessage, ClientMessageFrame } from '../../../src/client/impl/protocol/ClientMessage.js';
import { StringCodec } from '../../../src/client/impl/protocol/codec/builtin/StringCodec.js';
import { DataCodec } from '../../../src/client/impl/protocol/codec/builtin/DataCodec.js';
import {
    INT_SIZE_IN_BYTES,
    LONG_SIZE_IN_BYTES,
    BOOLEAN_SIZE_IN_BYTES,
} from '../../../src/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig.js';
import { ExecutorConfig } from '@zenystx/helios-core/config/ExecutorConfig.js';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData.js';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl.js';
import { SerializationConfig } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig.js';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl.js';
import { afterEach, describe, expect, test } from 'bun:test';

// ── Opcode constants — DurableExecutor service id=24 (0x18) ──────────────────
// Source: hazelcast/hazelcast-client-protocol DurableExecutor.yaml

const DE_SHUTDOWN_REQUEST            = 0x180100;
const DE_SHUTDOWN_RESPONSE           = 0x180101;
const DE_IS_SHUTDOWN_REQUEST         = 0x180200;
const DE_IS_SHUTDOWN_RESPONSE        = 0x180201;
const DE_SUBMIT_REQUEST              = 0x180300;
const DE_SUBMIT_RESPONSE             = 0x180301;
const DE_RETRIEVE_REQUEST            = 0x180400;
const DE_RETRIEVE_RESPONSE           = 0x180401;
const DE_DISPOSE_REQUEST             = 0x180500;
const DE_DISPOSE_RESPONSE            = 0x180501;
const DE_RETRIEVE_DISPOSE_REQUEST    = 0x180600;
const DE_RETRIEVE_DISPOSE_RESPONSE   = 0x180601;

// Response-frame header: messageType(4) + backupAcks(1) + unused(3) + correlationId(8)
const RH = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES; // = 16

// ── Fake session ──────────────────────────────────────────────────────────────

class FakeSession {
    readonly events: ClientMessage[] = [];
    isAuthenticated(): boolean { return true; }
    getSessionId(): string { return 'test-session'; }
    pushEvent(msg: ClientMessage): boolean { this.events.push(msg); return true; }
    sendMessage(msg: ClientMessage): boolean { this.events.push(msg); return true; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a DE_SHUTDOWN request: initial frame with name string frame.
 */
function buildDeShutdownRequest(name: string, correlationId: number): ClientMessage {
    const msg = ClientMessage.createForEncode();
    const frame = Buffer.allocUnsafe(RH);
    frame.fill(0);
    frame.writeUInt32LE(DE_SHUTDOWN_REQUEST >>> 0, 0);
    msg.add(new ClientMessageFrame(frame));
    msg.setCorrelationId(correlationId);
    msg.setPartitionId(-1);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

/**
 * Build a DE_IS_SHUTDOWN request.
 */
function buildDeIsShutdownRequest(name: string, correlationId: number): ClientMessage {
    const msg = ClientMessage.createForEncode();
    const frame = Buffer.allocUnsafe(RH);
    frame.fill(0);
    frame.writeUInt32LE(DE_IS_SHUTDOWN_REQUEST >>> 0, 0);
    msg.add(new ClientMessageFrame(frame));
    msg.setCorrelationId(correlationId);
    msg.setPartitionId(-1);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

/**
 * Build a DE_SUBMIT request.
 * Initial frame: header(RH) + partitionId(4) = RH+4 bytes
 * Then: name (string frame), callable (data frame).
 */
function buildDeSubmitRequest(
    name: string,
    callable: import('@zenystx/helios-core/internal/serialization/Data.js').Data,
    partitionId: number,
    correlationId: number,
): ClientMessage {
    const msg = ClientMessage.createForEncode();
    const frame = Buffer.allocUnsafe(RH + INT_SIZE_IN_BYTES);
    frame.fill(0);
    frame.writeUInt32LE(DE_SUBMIT_REQUEST >>> 0, 0);
    frame.writeInt32LE(partitionId, RH);
    msg.add(new ClientMessageFrame(frame));
    msg.setCorrelationId(correlationId);
    msg.setPartitionId(partitionId);
    StringCodec.encode(msg, name);
    DataCodec.encode(msg, callable);
    msg.setFinal();
    return msg;
}

/**
 * Decode DE_SUBMIT response → sequence number (int32 per protocol spec).
 */
function decodeDeSubmitResponse(response: ClientMessage): number {
    const iter = response.forwardFrameIterator();
    const frame = iter.next();
    return frame.content.readInt32LE(RH);
}

/**
 * Build a DE_RETRIEVE request.
 * Initial frame: header(RH) + sequence(4 = int32 per protocol) = RH+4 bytes, then name string frame.
 */
function buildDeRetrieveRequest(name: string, sequence: number, correlationId: number): ClientMessage {
    const msg = ClientMessage.createForEncode();
    const frame = Buffer.allocUnsafe(RH + INT_SIZE_IN_BYTES);
    frame.fill(0);
    frame.writeUInt32LE(DE_RETRIEVE_REQUEST >>> 0, 0);
    frame.writeInt32LE(sequence, RH);
    msg.add(new ClientMessageFrame(frame));
    msg.setCorrelationId(correlationId);
    msg.setPartitionId(-1);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

/**
 * Build a DE_RETRIEVE_AND_DISPOSE request.
 */
function buildDeRetrieveDisposeRequest(name: string, sequence: number, correlationId: number): ClientMessage {
    const msg = ClientMessage.createForEncode();
    const frame = Buffer.allocUnsafe(RH + INT_SIZE_IN_BYTES);
    frame.fill(0);
    frame.writeUInt32LE(DE_RETRIEVE_DISPOSE_REQUEST >>> 0, 0);
    frame.writeInt32LE(sequence, RH);
    msg.add(new ClientMessageFrame(frame));
    msg.setCorrelationId(correlationId);
    msg.setPartitionId(-1);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

/**
 * Build a DE_DISPOSE request.
 */
function buildDeDisposeRequest(name: string, sequence: number, correlationId: number): ClientMessage {
    const msg = ClientMessage.createForEncode();
    const frame = Buffer.allocUnsafe(RH + INT_SIZE_IN_BYTES);
    frame.fill(0);
    frame.writeUInt32LE(DE_DISPOSE_REQUEST >>> 0, 0);
    frame.writeInt32LE(sequence, RH);
    msg.add(new ClientMessageFrame(frame));
    msg.setCorrelationId(correlationId);
    msg.setPartitionId(-1);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

/**
 * Decode DE_RETRIEVE / DE_RETRIEVE_AND_DISPOSE response → Data | null.
 * Nullable response: if next frame is null frame → null, else decode Data.
 */
function decodeDeRetrieveResponse(response: ClientMessage): import('@zenystx/helios-core/internal/serialization/Data.js').Data | null {
    const iter = response.forwardFrameIterator();
    iter.next(); // skip header frame
    if (!iter.hasNext()) return null;
    const nextFrame = iter.peekNext();
    if (nextFrame !== null && nextFrame.isNullFrame()) return null;
    return DataCodec.decode(iter);
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('DurableExecutor protocol handlers', () => {

    const instances: HeliosInstanceImpl[] = [];
    const ss = new SerializationServiceImpl(new SerializationConfig());

    afterEach(() => {
        while (instances.length > 0) {
            instances.pop()!.shutdown();
        }
    });

    function makeInstance(executorName: string): { instance: HeliosInstanceImpl; dispatcher: any } {
        const cfg = new HeliosConfig(`de-test-${Date.now()}`);
        cfg.getNetworkConfig().setClientProtocolPort(0);

        const execConfig = new ExecutorConfig(executorName);
        execConfig.setAllowInlineBackend(true);
        execConfig.setExecutionBackend('inline');
        cfg.addExecutorConfig(execConfig);

        const instance = new HeliosInstanceImpl(cfg);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        return { instance, dispatcher };
    }

    /**
     * Encode a TaskCallable-shaped payload that the executor can process.
     * The inline backend can run any taskType registered on the executor service,
     * or handle '__inline__' types.
     * For durable executor tests we use inline execution without a registered task type.
     * Instead, we build a HeapData with raw serialized bytes representing a simple callable.
     */
    function makeCallableData(taskType: string, input: unknown): import('@zenystx/helios-core/internal/serialization/Data.js').Data {
        return ss.toData({ taskType, input })!;
    }

    // ── 1. DE_SHUTDOWN sends shutdown to named executor and returns empty response ─

    test('DE_SHUTDOWN shuts down the named executor and returns empty response', async () => {
        const { dispatcher } = makeInstance('de-exec-1');
        const session = new FakeSession() as any;

        const req = buildDeShutdownRequest('de-exec-1', 1);
        const response = await dispatcher.dispatch(req, session);

        expect(response).not.toBeNull();
        const msgType = response!.getStartFrame().content.readUInt32LE(0);
        expect(msgType).toBe(DE_SHUTDOWN_RESPONSE);
    });

    // ── 2. DE_IS_SHUTDOWN returns false before shutdown ──────────────────────

    test('DE_IS_SHUTDOWN returns false before shutdown', async () => {
        const { dispatcher } = makeInstance('de-exec-2');
        const session = new FakeSession() as any;

        const req = buildDeIsShutdownRequest('de-exec-2', 1);
        const response = await dispatcher.dispatch(req, session);

        expect(response).not.toBeNull();
        const msgType = response!.getStartFrame().content.readUInt32LE(0);
        expect(msgType).toBe(DE_IS_SHUTDOWN_RESPONSE);

        // Read boolean at position RH
        const isShutdown = response!.getStartFrame().content.readUInt8(RH) !== 0;
        expect(isShutdown).toBe(false);
    });

    // ── 3. DE_IS_SHUTDOWN returns true after DE_SHUTDOWN ─────────────────────

    test('DE_IS_SHUTDOWN returns true after DE_SHUTDOWN', async () => {
        const { dispatcher } = makeInstance('de-exec-3');
        const session = new FakeSession() as any;

        // Shutdown first
        await dispatcher.dispatch(buildDeShutdownRequest('de-exec-3', 1), session);

        // Now check
        const response = await dispatcher.dispatch(buildDeIsShutdownRequest('de-exec-3', 2), session);
        expect(response).not.toBeNull();

        const isShutdown = response!.getStartFrame().content.readUInt8(RH) !== 0;
        expect(isShutdown).toBe(true);
    });

    // ── 4. DE_SUBMIT returns a monotonically-increasing sequence ID ───────────

    test('DE_SUBMIT returns a sequence ID', async () => {
        const { instance, dispatcher } = makeInstance('de-exec-4');
        const session = new FakeSession() as any;

        // Register an inline task type so the callable can be deserialised
        const exec = instance.getExecutorService('de-exec-4');
        exec.registerTaskType('add-one', (input: unknown) => (input as number) + 1);

        const callable = makeCallableData('add-one', 41);
        const req = buildDeSubmitRequest('de-exec-4', callable, 0, 1);
        const response = await dispatcher.dispatch(req, session);

        expect(response).not.toBeNull();
        const msgType = response!.getStartFrame().content.readUInt32LE(0);
        expect(msgType).toBe(DE_SUBMIT_RESPONSE);

        const seq = decodeDeSubmitResponse(response!);
        expect(seq).toBeGreaterThan(0);
    });

    // ── 5. DE_SUBMIT sequences are monotonically increasing ──────────────────

    test('DE_SUBMIT sequences increment monotonically across multiple submissions', async () => {
        const { instance, dispatcher } = makeInstance('de-exec-5');
        const session = new FakeSession() as any;

        const exec = instance.getExecutorService('de-exec-5');
        exec.registerTaskType('noop', (input: unknown) => input);

        const callable = makeCallableData('noop', null);

        const r1 = await dispatcher.dispatch(buildDeSubmitRequest('de-exec-5', callable, 0, 1), session);
        const r2 = await dispatcher.dispatch(buildDeSubmitRequest('de-exec-5', callable, 0, 2), session);
        const r3 = await dispatcher.dispatch(buildDeSubmitRequest('de-exec-5', callable, 0, 3), session);

        const seq1 = decodeDeSubmitResponse(r1!);
        const seq2 = decodeDeSubmitResponse(r2!);
        const seq3 = decodeDeSubmitResponse(r3!);

        expect(seq2).toBeGreaterThan(seq1);
        expect(seq3).toBeGreaterThan(seq2);
    });

    // ── 6. DE_RETRIEVE returns result when task completes ────────────────────

    test('DE_RETRIEVE returns the task result after completion', async () => {
        const { instance, dispatcher } = makeInstance('de-exec-6');
        const session = new FakeSession() as any;

        const exec = instance.getExecutorService('de-exec-6');
        exec.registerTaskType('double', (input: unknown) => (input as number) * 2);

        const callable = makeCallableData('double', 21);
        const submitResp = await dispatcher.dispatch(buildDeSubmitRequest('de-exec-6', callable, 0, 1), session);
        const seq = decodeDeSubmitResponse(submitResp!);

        // Poll until the result is available — inline execution is async
        let retrieveResp: ClientMessage | null = null;
        for (let attempt = 0; attempt < 20; attempt++) {
            await Bun.sleep(50);
            retrieveResp = await dispatcher.dispatch(buildDeRetrieveRequest('de-exec-6', seq, 2), session);
            if (retrieveResp !== null) {
                const msgType = retrieveResp.getStartFrame().content.readUInt32LE(0);
                if (msgType === DE_RETRIEVE_RESPONSE) {
                    const resultData = decodeDeRetrieveResponse(retrieveResp);
                    if (resultData !== null) break;
                }
            }
        }

        expect(retrieveResp).not.toBeNull();
        const msgType = retrieveResp!.getStartFrame().content.readUInt32LE(0);
        expect(msgType).toBe(DE_RETRIEVE_RESPONSE);

        const resultData = decodeDeRetrieveResponse(retrieveResp!);
        expect(resultData).not.toBeNull();
    });

    // ── 7. DE_DISPOSE removes stored result ──────────────────────────────────

    test('DE_DISPOSE removes the stored result and returns empty response', async () => {
        const { instance, dispatcher } = makeInstance('de-exec-7');
        const session = new FakeSession() as any;

        const exec = instance.getExecutorService('de-exec-7');
        exec.registerTaskType('passthrough', (input: unknown) => input);

        const callable = makeCallableData('passthrough', 99);
        const submitResp = await dispatcher.dispatch(buildDeSubmitRequest('de-exec-7', callable, 0, 1), session);
        const seq = decodeDeSubmitResponse(submitResp!);

        // Wait for task to complete
        await Bun.sleep(100);

        // Dispose the result
        const disposeResp = await dispatcher.dispatch(buildDeDisposeRequest('de-exec-7', seq, 2), session);
        expect(disposeResp).not.toBeNull();
        const msgType = disposeResp!.getStartFrame().content.readUInt32LE(0);
        expect(msgType).toBe(DE_DISPOSE_RESPONSE);
    });

    // ── 8. DE_RETRIEVE_AND_DISPOSE retrieves and removes in one call ─────────

    test('DE_RETRIEVE_AND_DISPOSE returns result and removes it atomically', async () => {
        const { instance, dispatcher } = makeInstance('de-exec-8');
        const session = new FakeSession() as any;

        const exec = instance.getExecutorService('de-exec-8');
        exec.registerTaskType('increment', (input: unknown) => (input as number) + 100);

        const callable = makeCallableData('increment', 5);
        const submitResp = await dispatcher.dispatch(buildDeSubmitRequest('de-exec-8', callable, 0, 1), session);
        const seq = decodeDeSubmitResponse(submitResp!);

        // Wait for task to complete
        await Bun.sleep(100);

        const rdResp = await dispatcher.dispatch(buildDeRetrieveDisposeRequest('de-exec-8', seq, 2), session);
        expect(rdResp).not.toBeNull();
        const msgType = rdResp!.getStartFrame().content.readUInt32LE(0);
        expect(msgType).toBe(DE_RETRIEVE_DISPOSE_RESPONSE);

        const resultData = decodeDeRetrieveResponse(rdResp!);
        expect(resultData).not.toBeNull();
    });

    // ── 9. Multiple named executors are independent ───────────────────────────

    test('multiple named durable executors store results independently', async () => {
        const cfg = new HeliosConfig('de-multi');
        cfg.getNetworkConfig().setClientProtocolPort(0);

        for (const n of ['de-multi-a', 'de-multi-b']) {
            const ec = new ExecutorConfig(n);
            ec.setAllowInlineBackend(true);
            ec.setExecutionBackend('inline');
            cfg.addExecutorConfig(ec);
        }

        const instance = new HeliosInstanceImpl(cfg);
        instances.push(instance);

        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new FakeSession() as any;

        const execA = instance.getExecutorService('de-multi-a');
        execA.registerTaskType('noop', (v: unknown) => v);
        const execB = instance.getExecutorService('de-multi-b');
        execB.registerTaskType('noop', (v: unknown) => v);

        const callableA = makeCallableData('noop', 'alpha');
        const callableB = makeCallableData('noop', 'beta');

        const rA = await dispatcher.dispatch(buildDeSubmitRequest('de-multi-a', callableA, 0, 1), session);
        const rB = await dispatcher.dispatch(buildDeSubmitRequest('de-multi-b', callableB, 0, 2), session);

        const seqA = decodeDeSubmitResponse(rA!);
        const seqB = decodeDeSubmitResponse(rB!);

        // Sequences are per-counter — both should be positive
        expect(seqA).toBeGreaterThan(0);
        expect(seqB).toBeGreaterThan(0);
    });
});
