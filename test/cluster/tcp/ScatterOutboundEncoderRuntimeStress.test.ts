import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';

type StressSummary = {
    peerCount: number;
    messagesPerPeer: number;
    totalAccepted: number;
    totalEmitted: number;
    totalPartialWrites: number;
    totalDrains: number;
    maxQueuedFrames: number;
    maxPendingBytes: number;
};

const ROOT = resolve(import.meta.dir, '../../..');
const CHILD = resolve(import.meta.dir, 'fixtures/ScatterOutboundEncoderRuntimeStress.child.ts');

describe('ScatterOutboundEncoder runtime stress', () => {
    it('keeps the worker healthy under isolated scatter backlog churn', async () => {
        const proc = Bun.spawn(['bun', 'run', CHILD], {
            cwd: ROOT,
            env: process.env,
            stdout: 'pipe',
            stderr: 'pipe',
        });

        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);

        expect(exitCode).toBe(0);

        expect(stderr).toBe('');

        const summary = JSON.parse(stdout.trim()) as StressSummary;
        expect(summary.peerCount).toBeGreaterThanOrEqual(4);
        expect(summary.messagesPerPeer).toBeGreaterThanOrEqual(200);
        expect(summary.totalAccepted).toBe(summary.peerCount * summary.messagesPerPeer);
        expect(summary.totalEmitted).toBe(summary.totalAccepted);
        expect(summary.totalPartialWrites).toBeGreaterThan(0);
        expect(summary.totalDrains).toBeGreaterThan(0);
        expect(summary.maxPendingBytes).toBeGreaterThan(0);
    }, 30_000);
});
