/**
 * Port of {@code ReadOneOperationTest}.
 *
 * Tests ReadOneOperation: wait semantics, stale sequences, and item retrieval.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { RingbufferConfig } from '@helios/config/RingbufferConfig';
import { RingbufferContainer } from '@helios/ringbuffer/impl/RingbufferContainer';
import { RingbufferService } from '@helios/ringbuffer/impl/RingbufferService';
import { ReadOneOperation } from '@helios/ringbuffer/impl/operations/ReadOneOperation';
import { StaleSequenceException } from '@helios/ringbuffer/StaleSequenceException';
import { TestNodeEngine } from '@helios/test-support/TestNodeEngine';

const CAPACITY = 10;
const rbName = 'foo';

let nodeEngine: TestNodeEngine;
let service: RingbufferService;
let container: RingbufferContainer;

beforeEach(() => {
    nodeEngine = new TestNodeEngine();
    service = new RingbufferService(nodeEngine);
    const rbConfig = new RingbufferConfig(rbName).setCapacity(CAPACITY).setTimeToLiveSeconds(10);
    service.addRingbufferConfig(rbConfig);
    nodeEngine.registerService(RingbufferService.SERVICE_NAME, service);

    const ns = RingbufferService.getRingbufferNamespace(rbName);
    container = service.getOrCreateContainer(
        service.getRingbufferPartitionId(rbName),
        ns,
        rbConfig,
    );
});

function add(item: string): void {
    container.add(nodeEngine.toData(item)!);
}

function getReadOneOperation(seq: number): ReadOneOperation {
    const op = new ReadOneOperation(rbName, seq);
    op.setPartitionId(service.getRingbufferPartitionId(rbName));
    op.setNodeEngine(nodeEngine);
    return op;
}

describe('ReadOneOperation', () => {
    test('whenAtTail', async () => {
        add('tail');

        const op = getReadOneOperation(container.tailSequence());
        expect(op.shouldWait()).toBe(false);

        await op.run();
        const result = op.getResponse();
        expect(nodeEngine.toObject<string>(result)).toBe('tail');
    });

    test('whenOneAfterTail', () => {
        add('tail');

        const op = getReadOneOperation(container.tailSequence() + 1);
        expect(op.shouldWait()).toBe(true);
    });

    test('whenTooFarAfterTail', async () => {
        add('tail');

        const op = getReadOneOperation(container.tailSequence() + 2);
        op.shouldWait(); // does not throw
        await expect(op.beforeRun()).rejects.toThrow();
    });

    test('whenOneAfterTailAndBufferEmpty', () => {
        const op = getReadOneOperation(container.tailSequence() + 1);
        expect(op.shouldWait()).toBe(true);
    });

    test('whenOnTailAndBufferEmpty', async () => {
        // tailSequence = -1 initially; sequence = -1 is stale
        const op = getReadOneOperation(container.tailSequence());
        op.shouldWait(); // does not throw
        await expect(op.beforeRun()).rejects.toThrow(StaleSequenceException);
    });

    test('whenBeforeTail', async () => {
        add('item1');
        add('item2');
        add('item3');

        const op = getReadOneOperation(container.tailSequence() - 1);
        expect(op.shouldWait()).toBe(false);

        await op.run();
        expect(nodeEngine.toObject<string>(op.getResponse())).toBe('item2');
    });

    test('whenAtHead', async () => {
        add('item1');
        add('item2');
        add('item3');

        const op = getReadOneOperation(container.headSequence());
        expect(op.shouldWait()).toBe(false);

        await op.run();
        expect(nodeEngine.toObject<string>(op.getResponse())).toBe('item1');
    });

    test('whenBeforeHead', async () => {
        add('item1');
        add('item2');
        add('item3');

        const oldHead = container.headSequence();
        // Move head forward
        container.setHeadSequence(container.tailSequence());

        const op = getReadOneOperation(oldHead);
        op.shouldWait(); // does not throw
        await expect(op.beforeRun()).rejects.toThrow(StaleSequenceException);
    });
});
