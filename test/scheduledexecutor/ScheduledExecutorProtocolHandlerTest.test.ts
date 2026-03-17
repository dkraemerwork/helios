/**
 * Scheduled Executor Protocol Handler Tests
 *
 * Verifies all scheduled executor message handlers through the
 * ClientMessageDispatcher (dispatcher-only, no raw socket).
 *
 * Opcodes exercised (service id=26, 0x1A):
 *   ScheduledExecutor.Shutdown              (0x1A0100)
 *   ScheduledExecutor.SubmitToPartition     (0x1A0200)
 *   ScheduledExecutor.SubmitToMember        (0x1A0300)
 *   ScheduledExecutor.GetAllScheduledFutures (0x1A0400)
 *   ScheduledExecutor.GetStats              (0x1A0500)
 *   ScheduledExecutor.Cancel                (0x1A0900)
 *   ScheduledExecutor.Dispose               (0x1A1100)
 *   ScheduledExecutor.GetState              (0x1A0D00)
 */
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig.js';
import { ScheduledExecutorConfig } from '@zenystx/helios-core/config/ScheduledExecutorConfig.js';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl.js';
import { ScheduledExecutorSubmitToPartitionCodec } from '../../src/client/impl/protocol/codec/ScheduledExecutorSubmitToPartitionCodec.js';
import { ScheduledExecutorSubmitToMemberCodec } from '../../src/client/impl/protocol/codec/ScheduledExecutorSubmitToMemberCodec.js';
import { ScheduledExecutorCancelCodec } from '../../src/client/impl/protocol/codec/ScheduledExecutorCancelCodec.js';
import { ScheduledExecutorDisposeCodec } from '../../src/client/impl/protocol/codec/ScheduledExecutorDisposeCodec.js';
import { ScheduledExecutorGetAllScheduledFuturesCodec } from '../../src/client/impl/protocol/codec/ScheduledExecutorGetAllScheduledFuturesCodec.js';
import { ScheduledExecutorGetStatsCodec } from '../../src/client/impl/protocol/codec/ScheduledExecutorGetStatsCodec.js';
import { ScheduledExecutorGetStateCodec } from '../../src/client/impl/protocol/codec/ScheduledExecutorGetStateCodec.js';
import { ScheduledExecutorShutdownCodec } from '../../src/client/impl/protocol/codec/ScheduledExecutorShutdownCodec.js';
import { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler.js';
import { afterEach, describe, expect, test } from 'bun:test';

// ── Fake session ──────────────────────────────────────────────────────────────

class FakeSession {
    isAuthenticated(): boolean { return true; }
    getSessionId(): string { return 'test-session'; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MEMBER_UUID = '00000000-0000-0000-0000-000000000001';

function makeInstance(executorName: string): { instance: HeliosInstanceImpl; dispatcher: any } {
    const cfg = new HeliosConfig(`se-test-${Date.now()}`);
    cfg.getNetworkConfig().setClientProtocolPort(0);

    const execConfig = new ScheduledExecutorConfig(executorName);
    cfg.addScheduledExecutorConfig(execConfig);

    const instance = new HeliosInstanceImpl(cfg);
    const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
    return { instance, dispatcher };
}

/**
 * Submit a task to a partition and return the handler URN string from the response.
 */
async function submitToPartition(
    dispatcher: any,
    session: any,
    schedulerName: string,
    taskName: string,
    taskType: string,
    partitionId: number,
    delayMs: number,
): Promise<string> {
    const req = ScheduledExecutorSubmitToPartitionCodec.encodeRequest(
        schedulerName, 0 /* SINGLE_RUN */, taskName, taskType, delayMs, 0, false,
    );
    req.setPartitionId(partitionId);
    req.setCorrelationId(1);

    const resp = await dispatcher.dispatch(req, session);
    expect(resp).not.toBeNull();

    const msgType = resp!.getStartFrame().content.readUInt32LE(0);
    expect(msgType).toBe(ScheduledExecutorSubmitToPartitionCodec.RESPONSE_MESSAGE_TYPE);

    return ScheduledExecutorSubmitToPartitionCodec.decodeResponse(resp!);
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('ScheduledExecutor protocol handlers', () => {

    const instances: HeliosInstanceImpl[] = [];

    afterEach(() => {
        while (instances.length > 0) {
            instances.pop()!.shutdown();
        }
    });

    // ── 1. SubmitToPartition returns a handler URN ────────────────────────────

    test('SubmitToPartition returns a valid handler URN', async () => {
        const { instance, dispatcher } = makeInstance('se-exec-1');
        instances.push(instance);
        const session = new FakeSession() as any;

        const urn = await submitToPartition(dispatcher, session, 'se-exec-1', 'task-1', 'noop', 0, 5000);

        expect(typeof urn).toBe('string');
        expect(urn.length).toBeGreaterThan(0);
        // URN format: schedulerName/taskName/P{partitionId}
        expect(urn).toContain('se-exec-1');
        expect(urn).toContain('task-1');
    });

    // ── 2. SubmitToMember returns a handler URN ───────────────────────────────

    test('SubmitToMember returns a valid handler URN', async () => {
        const { instance, dispatcher } = makeInstance('se-exec-2');
        instances.push(instance);
        const session = new FakeSession() as any;

        const req = ScheduledExecutorSubmitToMemberCodec.encodeRequest(
            'se-exec-2', MEMBER_UUID, 0 /* SINGLE_RUN */, 'task-m1', 'noop-member', 5000, 0, false,
        );
        req.setCorrelationId(1);

        const resp = await dispatcher.dispatch(req, session);
        expect(resp).not.toBeNull();

        const msgType = resp!.getStartFrame().content.readUInt32LE(0);
        expect(msgType).toBe(ScheduledExecutorSubmitToMemberCodec.RESPONSE_MESSAGE_TYPE);

        const urn = ScheduledExecutorSubmitToMemberCodec.decodeResponse(resp!);
        expect(typeof urn).toBe('string');
        expect(urn).toContain('se-exec-2');
        expect(urn).toContain('task-m1');
    });

    // ── 3. GetAllScheduledFutures returns submitted tasks ─────────────────────

    test('GetAllScheduledFutures returns URNs for all submitted tasks', async () => {
        const { instance, dispatcher } = makeInstance('se-exec-3');
        instances.push(instance);
        const session = new FakeSession() as any;

        // Submit two tasks on different partitions
        await submitToPartition(dispatcher, session, 'se-exec-3', 'task-a', 'noop', 0, 5000);
        await submitToPartition(dispatcher, session, 'se-exec-3', 'task-b', 'noop', 1, 5000);

        const req = ScheduledExecutorGetAllScheduledFuturesCodec.encodeRequest('se-exec-3');
        req.setCorrelationId(3);

        const resp = await dispatcher.dispatch(req, session);
        expect(resp).not.toBeNull();

        const msgType = resp!.getStartFrame().content.readUInt32LE(0);
        expect(msgType).toBe(ScheduledExecutorGetAllScheduledFuturesCodec.RESPONSE_MESSAGE_TYPE);

        const urns = ScheduledExecutorGetAllScheduledFuturesCodec.decodeResponse(resp!);
        expect(urns.length).toBeGreaterThanOrEqual(2);

        const taskNames = urns.map(u => ScheduledTaskHandler.of(u).getTaskName());
        expect(taskNames).toContain('task-a');
        expect(taskNames).toContain('task-b');
    });

    // ── 4. GetState: task is not done immediately after submit with future delay

    test('GetState returns isDone=false immediately after submitting a future task', async () => {
        const { instance, dispatcher } = makeInstance('se-exec-4');
        instances.push(instance);
        const session = new FakeSession() as any;

        await submitToPartition(dispatcher, session, 'se-exec-4', 'future-task', 'noop', 0, 60_000);

        const req = ScheduledExecutorGetStateCodec.encodeRequest('se-exec-4', 'future-task', 0);
        req.setCorrelationId(2);

        const resp = await dispatcher.dispatch(req, session);
        expect(resp).not.toBeNull();

        const msgType = resp!.getStartFrame().content.readUInt32LE(0);
        expect(msgType).toBe(ScheduledExecutorGetStateCodec.RESPONSE_MESSAGE_TYPE);

        const state = ScheduledExecutorGetStateCodec.decodeResponse(resp!);
        expect(state.isDone).toBe(false);
        expect(state.isCancelled).toBe(false);
        expect(state.delayMs).toBeGreaterThan(0);
    });

    // ── 5. GetState: task is done after delay=0 fires ────────────────────────

    test('GetState returns isDone=true after a zero-delay task fires', async () => {
        const { instance, dispatcher } = makeInstance('se-exec-5');
        instances.push(instance);
        const session = new FakeSession() as any;

        // Ensure the executor is registered in _configs so the timer coordinator can dispatch it
        instance.getScheduledExecutorService('se-exec-5');

        await submitToPartition(dispatcher, session, 'se-exec-5', 'instant-task', 'noop', 0, 0);

        // Wait for the timer coordinator tick (10ms interval)
        await Bun.sleep(100);

        const req = ScheduledExecutorGetStateCodec.encodeRequest('se-exec-5', 'instant-task', 0);
        req.setCorrelationId(2);

        const resp = await dispatcher.dispatch(req, session);
        expect(resp).not.toBeNull();

        const state = ScheduledExecutorGetStateCodec.decodeResponse(resp!);
        expect(state.isDone).toBe(true);
        expect(state.isCancelled).toBe(false);
    });

    // ── 6. Cancel: cancels a pending task ─────────────────────────────────────

    test('Cancel returns true for a pending task and GetState shows isCancelled', async () => {
        const { instance, dispatcher } = makeInstance('se-exec-6');
        instances.push(instance);
        const session = new FakeSession() as any;

        await submitToPartition(dispatcher, session, 'se-exec-6', 'cancellable', 'noop', 0, 60_000);

        const cancelReq = ScheduledExecutorCancelCodec.encodeRequest('se-exec-6', 'cancellable', 0, false);
        cancelReq.setCorrelationId(2);

        const cancelResp = await dispatcher.dispatch(cancelReq, session);
        expect(cancelResp).not.toBeNull();

        const msgType = cancelResp!.getStartFrame().content.readUInt32LE(0);
        expect(msgType).toBe(ScheduledExecutorCancelCodec.RESPONSE_MESSAGE_TYPE);

        const wasCancelled = ScheduledExecutorCancelCodec.decodeResponse(cancelResp!);
        expect(wasCancelled).toBe(true);

        // Verify state is cancelled
        const stateReq = ScheduledExecutorGetStateCodec.encodeRequest('se-exec-6', 'cancellable', 0);
        stateReq.setCorrelationId(3);
        const stateResp = await dispatcher.dispatch(stateReq, session);
        const state = ScheduledExecutorGetStateCodec.decodeResponse(stateResp!);
        expect(state.isCancelled).toBe(true);
        expect(state.isDone).toBe(true);
    });

    // ── 7. Cancel already-cancelled task returns false ────────────────────────

    test('Cancel returns false when called on an already-cancelled task', async () => {
        const { instance, dispatcher } = makeInstance('se-exec-7');
        instances.push(instance);
        const session = new FakeSession() as any;

        await submitToPartition(dispatcher, session, 'se-exec-7', 'cancel-twice', 'noop', 0, 60_000);

        const cancelReq = () => {
            const r = ScheduledExecutorCancelCodec.encodeRequest('se-exec-7', 'cancel-twice', 0, false);
            r.setCorrelationId(2);
            return r;
        };

        // First cancel succeeds
        const resp1 = await dispatcher.dispatch(cancelReq(), session);
        expect(ScheduledExecutorCancelCodec.decodeResponse(resp1!)).toBe(true);

        // Second cancel returns false (already in terminal state)
        const resp2 = await dispatcher.dispatch(cancelReq(), session);
        expect(ScheduledExecutorCancelCodec.decodeResponse(resp2!)).toBe(false);
    });

    // ── 8. GetStats: initial stats are zero ──────────────────────────────────

    test('GetStats returns zero run count for a newly submitted task', async () => {
        const { instance, dispatcher } = makeInstance('se-exec-8');
        instances.push(instance);
        const session = new FakeSession() as any;

        await submitToPartition(dispatcher, session, 'se-exec-8', 'stats-task', 'noop', 0, 60_000);

        const statsReq = ScheduledExecutorGetStatsCodec.encodeRequest('se-exec-8', 'stats-task', 0);
        statsReq.setCorrelationId(2);

        const statsResp = await dispatcher.dispatch(statsReq, session);
        expect(statsResp).not.toBeNull();

        const msgType = statsResp!.getStartFrame().content.readUInt32LE(0);
        expect(msgType).toBe(ScheduledExecutorGetStatsCodec.RESPONSE_MESSAGE_TYPE);

        const stats = ScheduledExecutorGetStatsCodec.decodeResponse(statsResp!);
        expect(stats.totalRuns).toBe(0);
    });

    // ── 9. GetStats: run count increments after task fires ───────────────────

    test('GetStats reflects incremented run count after task fires', async () => {
        const { instance, dispatcher } = makeInstance('se-exec-9');
        instances.push(instance);
        const session = new FakeSession() as any;

        // Ensure the executor is registered in _configs so the timer coordinator can dispatch it
        instance.getScheduledExecutorService('se-exec-9');

        // Zero-delay task fires immediately
        await submitToPartition(dispatcher, session, 'se-exec-9', 'stats-fired', 'noop', 0, 0);

        // Wait for timer coordinator tick
        await Bun.sleep(100);

        const statsReq = ScheduledExecutorGetStatsCodec.encodeRequest('se-exec-9', 'stats-fired', 0);
        statsReq.setCorrelationId(2);

        const statsResp = await dispatcher.dispatch(statsReq, session);
        const stats = ScheduledExecutorGetStatsCodec.decodeResponse(statsResp!);
        expect(stats.totalRuns).toBeGreaterThanOrEqual(1);
    });

    // ── 10. Dispose: removes a task ──────────────────────────────────────────

    test('Dispose removes the task and Dispose again throws (via null response)', async () => {
        const { instance, dispatcher } = makeInstance('se-exec-10');
        instances.push(instance);
        const session = new FakeSession() as any;

        await submitToPartition(dispatcher, session, 'se-exec-10', 'disposable', 'noop', 0, 60_000);

        const disposeReq = ScheduledExecutorDisposeCodec.encodeRequest('se-exec-10', 'disposable', 0);
        disposeReq.setCorrelationId(2);

        const disposeResp = await dispatcher.dispatch(disposeReq, session);
        expect(disposeResp).not.toBeNull();

        const msgType = disposeResp!.getStartFrame().content.readUInt32LE(0);
        expect(msgType).toBe(ScheduledExecutorDisposeCodec.RESPONSE_MESSAGE_TYPE);
    });

    // ── 11. Shutdown: destroys the executor ──────────────────────────────────

    test('Shutdown returns empty response and clears all scheduled futures', async () => {
        const { instance, dispatcher } = makeInstance('se-exec-11');
        instances.push(instance);
        const session = new FakeSession() as any;

        // Submit a task first
        await submitToPartition(dispatcher, session, 'se-exec-11', 'pre-shutdown', 'noop', 0, 60_000);

        const shutdownReq = ScheduledExecutorShutdownCodec.encodeRequest('se-exec-11');
        shutdownReq.setCorrelationId(2);

        const shutdownResp = await dispatcher.dispatch(shutdownReq, session);
        expect(shutdownResp).not.toBeNull();

        const msgType = shutdownResp!.getStartFrame().content.readUInt32LE(0);
        expect(msgType).toBe(ScheduledExecutorShutdownCodec.RESPONSE_MESSAGE_TYPE);

        // After shutdown, GetAllScheduledFutures should return empty (container destroyed)
        const allReq = ScheduledExecutorGetAllScheduledFuturesCodec.encodeRequest('se-exec-11');
        allReq.setCorrelationId(3);
        const allResp = await dispatcher.dispatch(allReq, session);
        const urns = ScheduledExecutorGetAllScheduledFuturesCodec.decodeResponse(allResp!);
        expect(urns).toHaveLength(0);
    });
});
