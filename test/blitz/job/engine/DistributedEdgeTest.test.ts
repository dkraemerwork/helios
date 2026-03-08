import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { BlitzService } from '@zenystx/helios-blitz/BlitzService';
import { AsyncChannel } from '@zenystx/helios-core/job/engine/AsyncChannel';
import { DistributedEdgeSender } from '@zenystx/helios-core/job/engine/DistributedEdgeSender';
import { DistributedEdgeReceiver } from '@zenystx/helios-core/job/engine/DistributedEdgeReceiver';
import type { ProcessorItem } from '@zenystx/helios-core/job/engine/ProcessorItem';
import { EdgeType } from '@zenystx/helios-core/job/PipelineDescriptor';
import { ProcessingGuarantee } from '@zenystx/helios-core/job/JobConfig';
import type { NatsConnection } from '@nats-io/transport-node';

describe('DistributedEdge — NATS sender/receiver', () => {
    let blitz: BlitzService;
    let nc: NatsConnection;

    beforeAll(async () => {
        blitz = await BlitzService.start();
        nc = blitz.nc;
    });

    afterAll(async () => {
        await blitz.shutdown();
    });

    function dataItem(value: unknown, key?: string): ProcessorItem {
        return { type: 'data', value, key, timestamp: Date.now() };
    }

    function barrierItem(snapshotId: string): ProcessorItem {
        return { type: 'barrier', snapshotId };
    }

    describe('unicast round-robin', () => {
        it('sends and receives data items via NATS unicast', async () => {
            const outbox = new AsyncChannel<ProcessorItem>(16);
            const inbox = new AsyncChannel<ProcessorItem>(16);
            const subject = `test.unicast.${crypto.randomUUID()}`;

            const receiver = new DistributedEdgeReceiver({
                nc,
                subjects: [subject],
                inbox,
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            await receiver.start();

            const sender = new DistributedEdgeSender({
                nc,
                outbox,
                memberSubjects: [subject],
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            sender.start();

            await outbox.send(dataItem('hello'));
            await outbox.send(dataItem('world'));

            const received1 = await inbox.receive();
            const received2 = await inbox.receive();

            expect(received1.type).toBe('data');
            expect((received1 as any).value).toBe('hello');
            expect(received2.type).toBe('data');
            expect((received2 as any).value).toBe('world');

            await sender.stop();
            await receiver.stop();
        });

        it('round-robins across multiple member subjects', async () => {
            const outbox = new AsyncChannel<ProcessorItem>(16);
            const inbox1 = new AsyncChannel<ProcessorItem>(16);
            const inbox2 = new AsyncChannel<ProcessorItem>(16);
            const subj1 = `test.rr1.${crypto.randomUUID()}`;
            const subj2 = `test.rr2.${crypto.randomUUID()}`;

            const recv1 = new DistributedEdgeReceiver({
                nc, subjects: [subj1], inbox: inbox1,
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            const recv2 = new DistributedEdgeReceiver({
                nc, subjects: [subj2], inbox: inbox2,
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            await recv1.start();
            await recv2.start();

            const sender = new DistributedEdgeSender({
                nc, outbox,
                memberSubjects: [subj1, subj2],
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            sender.start();

            // Send 4 items — should alternate between subj1 and subj2
            for (let i = 0; i < 4; i++) {
                await outbox.send(dataItem(`item-${i}`));
            }

            const r1a = await inbox1.receive();
            const r1b = await inbox1.receive();
            const r2a = await inbox2.receive();
            const r2b = await inbox2.receive();

            const allValues = [r1a, r1b, r2a, r2b].map((r) => (r as any).value).sort();
            expect(allValues).toEqual(['item-0', 'item-1', 'item-2', 'item-3']);
            // Each inbox should have exactly 2
            expect([r1a, r1b].length).toBe(2);
            expect([r2a, r2b].length).toBe(2);

            await sender.stop();
            await recv1.stop();
            await recv2.stop();
        });
    });

    describe('partitioned by key hash', () => {
        it('routes items with same key to the same member subject', async () => {
            const outbox = new AsyncChannel<ProcessorItem>(16);
            const inbox1 = new AsyncChannel<ProcessorItem>(16);
            const inbox2 = new AsyncChannel<ProcessorItem>(16);
            const subj1 = `test.part1.${crypto.randomUUID()}`;
            const subj2 = `test.part2.${crypto.randomUUID()}`;

            const recv1 = new DistributedEdgeReceiver({
                nc, subjects: [subj1], inbox: inbox1,
                edgeType: EdgeType.DISTRIBUTED_PARTITIONED,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            const recv2 = new DistributedEdgeReceiver({
                nc, subjects: [subj2], inbox: inbox2,
                edgeType: EdgeType.DISTRIBUTED_PARTITIONED,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            await recv1.start();
            await recv2.start();

            const sender = new DistributedEdgeSender({
                nc, outbox,
                memberSubjects: [subj1, subj2],
                edgeType: EdgeType.DISTRIBUTED_PARTITIONED,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            sender.start();

            // Send items with two distinct keys — each key should consistently go to the same subject
            await outbox.send(dataItem('a1', 'keyA'));
            await outbox.send(dataItem('a2', 'keyA'));
            await outbox.send(dataItem('b1', 'keyB'));
            await outbox.send(dataItem('b2', 'keyB'));

            // Collect all received items from both inboxes
            const drainWithTimeout = async (ch: AsyncChannel<ProcessorItem>, count: number): Promise<ProcessorItem[]> => {
                const items: ProcessorItem[] = [];
                for (let i = 0; i < count; i++) {
                    const item = await Promise.race([
                        ch.receive(),
                        new Promise<null>((r) => setTimeout(() => r(null), 2000)),
                    ]);
                    if (item === null) break;
                    items.push(item);
                }
                return items;
            };

            // Wait a bit for delivery
            await new Promise((r) => setTimeout(r, 500));

            const from1 = await drainWithTimeout(inbox1, 4);
            const from2 = await drainWithTimeout(inbox2, 4);

            // All 4 items should be received
            expect(from1.length + from2.length).toBe(4);

            // Items with keyA should all be in the same inbox
            const keyAItems1 = from1.filter((i) => i.type === 'data' && (i as any).key === 'keyA');
            const keyAItems2 = from2.filter((i) => i.type === 'data' && (i as any).key === 'keyA');
            // One of them should have all keyA items
            expect(keyAItems1.length === 2 || keyAItems2.length === 2).toBe(true);

            // Items with keyB should all be in the same inbox
            const keyBItems1 = from1.filter((i) => i.type === 'data' && (i as any).key === 'keyB');
            const keyBItems2 = from2.filter((i) => i.type === 'data' && (i as any).key === 'keyB');
            expect(keyBItems1.length === 2 || keyBItems2.length === 2).toBe(true);

            await sender.stop();
            await recv1.stop();
            await recv2.stop();
        });
    });

    describe('broadcast', () => {
        it('broadcasts items to all member subjects', async () => {
            const outbox = new AsyncChannel<ProcessorItem>(16);
            const inbox1 = new AsyncChannel<ProcessorItem>(16);
            const inbox2 = new AsyncChannel<ProcessorItem>(16);
            const broadcastSubj = `test.broadcast.${crypto.randomUUID()}`;

            const recv1 = new DistributedEdgeReceiver({
                nc, subjects: [broadcastSubj], inbox: inbox1,
                edgeType: EdgeType.DISTRIBUTED_BROADCAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            const recv2 = new DistributedEdgeReceiver({
                nc, subjects: [broadcastSubj], inbox: inbox2,
                edgeType: EdgeType.DISTRIBUTED_BROADCAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            await recv1.start();
            await recv2.start();

            const sender = new DistributedEdgeSender({
                nc, outbox,
                memberSubjects: [broadcastSubj],
                broadcastSubject: broadcastSubj,
                edgeType: EdgeType.DISTRIBUTED_BROADCAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            sender.start();

            await outbox.send(dataItem('bcast-1'));
            await outbox.send(dataItem('bcast-2'));

            // Both receivers should get both items
            const r1a = await inbox1.receive();
            const r1b = await inbox1.receive();
            const r2a = await inbox2.receive();
            const r2b = await inbox2.receive();

            expect((r1a as any).value).toBe('bcast-1');
            expect((r1b as any).value).toBe('bcast-2');
            expect((r2a as any).value).toBe('bcast-1');
            expect((r2b as any).value).toBe('bcast-2');

            await sender.stop();
            await recv1.stop();
            await recv2.stop();
        });
    });

    describe('allToOne', () => {
        it('sends all items to a single target subject', async () => {
            const outbox = new AsyncChannel<ProcessorItem>(16);
            const inbox = new AsyncChannel<ProcessorItem>(16);
            const subject = `test.alltoone.${crypto.randomUUID()}`;

            const receiver = new DistributedEdgeReceiver({
                nc, subjects: [subject], inbox,
                edgeType: EdgeType.ALL_TO_ONE,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            await receiver.start();

            const sender = new DistributedEdgeSender({
                nc, outbox,
                memberSubjects: [subject],
                edgeType: EdgeType.ALL_TO_ONE,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            sender.start();

            await outbox.send(dataItem('ato-1'));
            await outbox.send(dataItem('ato-2'));
            await outbox.send(dataItem('ato-3'));

            const r1 = await inbox.receive();
            const r2 = await inbox.receive();
            const r3 = await inbox.receive();

            expect((r1 as any).value).toBe('ato-1');
            expect((r2 as any).value).toBe('ato-2');
            expect((r3 as any).value).toBe('ato-3');

            await sender.stop();
            await receiver.stop();
        });
    });

    describe('barrier passthrough via NATS headers', () => {
        it('transmits barriers as NATS messages with blitz-barrier headers', async () => {
            const outbox = new AsyncChannel<ProcessorItem>(16);
            const inbox = new AsyncChannel<ProcessorItem>(16);
            const subject = `test.barrier.${crypto.randomUUID()}`;

            const receiver = new DistributedEdgeReceiver({
                nc, subjects: [subject], inbox,
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            await receiver.start();

            const sender = new DistributedEdgeSender({
                nc, outbox,
                memberSubjects: [subject],
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            sender.start();

            await outbox.send(dataItem('before-barrier'));
            await outbox.send(barrierItem('snap-42'));
            await outbox.send(dataItem('after-barrier'));

            const r1 = await inbox.receive();
            const r2 = await inbox.receive();
            const r3 = await inbox.receive();

            expect(r1.type).toBe('data');
            expect((r1 as any).value).toBe('before-barrier');
            expect(r2.type).toBe('barrier');
            expect((r2 as any).snapshotId).toBe('snap-42');
            expect(r3.type).toBe('data');
            expect((r3 as any).value).toBe('after-barrier');

            await sender.stop();
            await receiver.stop();
        });

        it('broadcasts barriers to all member subjects', async () => {
            const outbox = new AsyncChannel<ProcessorItem>(16);
            const inbox1 = new AsyncChannel<ProcessorItem>(16);
            const inbox2 = new AsyncChannel<ProcessorItem>(16);
            const subj1 = `test.barr-bc1.${crypto.randomUUID()}`;
            const subj2 = `test.barr-bc2.${crypto.randomUUID()}`;

            const recv1 = new DistributedEdgeReceiver({
                nc, subjects: [subj1], inbox: inbox1,
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            const recv2 = new DistributedEdgeReceiver({
                nc, subjects: [subj2], inbox: inbox2,
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            await recv1.start();
            await recv2.start();

            const sender = new DistributedEdgeSender({
                nc, outbox,
                memberSubjects: [subj1, subj2],
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            sender.start();

            // Barriers are always broadcast to ALL member subjects regardless of edge type
            await outbox.send(barrierItem('snap-99'));

            const r1 = await inbox1.receive();
            const r2 = await inbox2.receive();

            expect(r1.type).toBe('barrier');
            expect((r1 as any).snapshotId).toBe('snap-99');
            expect(r2.type).toBe('barrier');
            expect((r2 as any).snapshotId).toBe('snap-99');

            await sender.stop();
            await recv1.stop();
            await recv2.stop();
        });
    });

    describe('JetStream vs core NATS selection', () => {
        it('uses core NATS for NONE processing guarantee', async () => {
            const outbox = new AsyncChannel<ProcessorItem>(16);
            const inbox = new AsyncChannel<ProcessorItem>(16);
            const subject = `test.core.${crypto.randomUUID()}`;

            const receiver = new DistributedEdgeReceiver({
                nc, subjects: [subject], inbox,
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            await receiver.start();
            // Should use core NATS (subscription-based, not JetStream consumer)
            expect(receiver.isJetStream).toBe(false);

            const sender = new DistributedEdgeSender({
                nc, outbox,
                memberSubjects: [subject],
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            expect(sender.isJetStream).toBe(false);

            await receiver.stop();
        });

        it('uses JetStream for AT_LEAST_ONCE processing guarantee', async () => {
            const outbox = new AsyncChannel<ProcessorItem>(16);
            const inbox = new AsyncChannel<ProcessorItem>(16);
            const streamName = `TESTALS${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
            const subject = `test.als.${crypto.randomUUID()}`;

            const receiver = new DistributedEdgeReceiver({
                nc, subjects: [subject], inbox,
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.AT_LEAST_ONCE,
                streamName,
            });
            await receiver.start();
            expect(receiver.isJetStream).toBe(true);

            const sender = new DistributedEdgeSender({
                nc, outbox,
                memberSubjects: [subject],
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.AT_LEAST_ONCE,
                streamName,
            });
            expect(sender.isJetStream).toBe(true);

            // Verify round-trip through JetStream
            sender.start();
            await outbox.send(dataItem('js-item'));
            const received = await inbox.receive();
            expect((received as any).value).toBe('js-item');

            await sender.stop();
            await receiver.stop();

            // Clean up stream
            try {
                const jsm = await blitz.getJsm();
                await jsm.streams.delete(streamName);
            } catch { /* may not exist */ }
        });

        it('uses JetStream for EXACTLY_ONCE processing guarantee', async () => {
            const outbox = new AsyncChannel<ProcessorItem>(16);
            const inbox = new AsyncChannel<ProcessorItem>(16);
            const streamName = `TESTEO${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
            const subject = `test.eo.${crypto.randomUUID()}`;

            const receiver = new DistributedEdgeReceiver({
                nc, subjects: [subject], inbox,
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.EXACTLY_ONCE,
                streamName,
            });
            await receiver.start();
            expect(receiver.isJetStream).toBe(true);

            const sender = new DistributedEdgeSender({
                nc, outbox,
                memberSubjects: [subject],
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.EXACTLY_ONCE,
                streamName,
            });
            expect(sender.isJetStream).toBe(true);

            sender.start();
            await outbox.send(dataItem('eo-item'));
            const received = await inbox.receive();
            expect((received as any).value).toBe('eo-item');

            await sender.stop();
            await receiver.stop();

            try {
                const jsm = await blitz.getJsm();
                await jsm.streams.delete(streamName);
            } catch { /* may not exist */ }
        });
    });

    describe('backpressure', () => {
        it('backpressure from full inbox pauses receiver consumption', async () => {
            const outbox = new AsyncChannel<ProcessorItem>(16);
            // Tiny inbox — fills up quickly
            const inbox = new AsyncChannel<ProcessorItem>(2);
            const subject = `test.bp.${crypto.randomUUID()}`;

            const receiver = new DistributedEdgeReceiver({
                nc, subjects: [subject], inbox,
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            await receiver.start();

            const sender = new DistributedEdgeSender({
                nc, outbox,
                memberSubjects: [subject],
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            sender.start();

            // Send several items
            for (let i = 0; i < 5; i++) {
                await outbox.send(dataItem(`bp-${i}`));
            }

            // Give time for NATS delivery
            await new Promise((r) => setTimeout(r, 300));

            // Drain inbox — should get all items eventually (receiver buffers or retries)
            const results: ProcessorItem[] = [];
            for (let i = 0; i < 5; i++) {
                const item = await Promise.race([
                    inbox.receive(),
                    new Promise<null>((r) => setTimeout(() => r(null), 3000)),
                ]);
                if (item === null) break;
                results.push(item);
            }

            expect(results.length).toBe(5);
            for (let i = 0; i < 5; i++) {
                expect((results[i] as any).value).toBe(`bp-${i}`);
            }

            await sender.stop();
            await receiver.stop();
        });
    });

    describe('real NATS verification', () => {
        it('sender publishes to real NATS — not an in-memory shortcut', async () => {
            const outbox = new AsyncChannel<ProcessorItem>(16);
            const subject = `test.realnats.${crypto.randomUUID()}`;

            // Subscribe via raw NATS to verify real messages flow
            let rawReceived = false;
            const sub = nc.subscribe(subject);
            (async () => {
                for await (const _msg of sub) {
                    rawReceived = true;
                    break;
                }
            })();

            const sender = new DistributedEdgeSender({
                nc, outbox,
                memberSubjects: [subject],
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            sender.start();

            await outbox.send(dataItem('verify-real'));
            await new Promise((r) => setTimeout(r, 500));

            expect(rawReceived).toBe(true);

            sub.unsubscribe();
            await sender.stop();
        });

        it('receiver reads from real NATS subscriptions', async () => {
            const inbox = new AsyncChannel<ProcessorItem>(16);
            const subject = `test.realrecv.${crypto.randomUUID()}`;

            const receiver = new DistributedEdgeReceiver({
                nc, subjects: [subject], inbox,
                edgeType: EdgeType.DISTRIBUTED_UNICAST,
                processingGuarantee: ProcessingGuarantee.NONE,
            });
            await receiver.start();

            // Publish raw NATS message — receiver should pick it up
            const payload = JSON.stringify({ type: 'data', value: 'raw-publish', timestamp: Date.now() });
            nc.publish(subject, new TextEncoder().encode(payload));

            const received = await inbox.receive();
            expect(received.type).toBe('data');
            expect((received as any).value).toBe('raw-publish');

            await receiver.stop();
        });
    });
});
