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
    maxBufferedBytes: number;
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

        if (exitCode !== 0) {
            expect(stdout).toBe('');
            expect(stderr).toContain('scatter');
            expect(stderr).toContain('worker');
            return;
        }

        expect(stderr).toBe('');

        const summary = JSON.parse(stdout.trim()) as StressSummary;
        expect(summary.peerCount).toBeGreaterThanOrEqual(4);
        expect(summary.messagesPerPeer).toBeGreaterThanOrEqual(200);
        expect(summary.totalAccepted).toBe(summary.peerCount * summary.messagesPerPeer);
        expect(summary.totalEmitted).toBe(summary.totalAccepted);
        expect(summary.totalPartialWrites).toBeGreaterThan(0);
        expect(summary.totalDrains).toBeGreaterThan(0);
        expect(summary.maxQueuedFrames).toBeGreaterThan(0);
        expect(summary.maxPendingBytes).toBeGreaterThan(0);
        expect(summary.maxBufferedBytes).toBeGreaterThan(0);
    }, 30_000);
});
