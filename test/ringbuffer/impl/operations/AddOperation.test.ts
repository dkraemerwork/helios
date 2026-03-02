/**
 * Port of {@code AddOperationsTest}.
 *
 * Tests AddOperation with FAIL and OVERWRITE overflow policies.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { RingbufferConfig } from '@helios/config/RingbufferConfig';
import { RingbufferContainer } from '@helios/ringbuffer/impl/RingbufferContainer';
import { RingbufferService } from '@helios/ringbuffer/impl/RingbufferService';
import { AddOperation } from '@helios/ringbuffer/impl/operations/AddOperation';
import { OverflowPolicy } from '@helios/ringbuffer/OverflowPolicy';
import { TestNodeEngine } from '@helios/test-support/TestNodeEngine';

const CAPACITY = 10;

let nodeEngine: TestNodeEngine;
let service: RingbufferService;
let container: RingbufferContainer;
const rbName = 'foo';

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

function getAddOperation(policy: OverflowPolicy): AddOperation {
    const item = nodeEngine.toData('item')!;
    const op = new AddOperation(rbName, item, policy);
    op.setPartitionId(service.getRingbufferPartitionId(rbName));
    op.setNodeEngine(nodeEngine);
    return op;
}

function fillContainer(count: number): void {
    for (let k = 0; k < count; k++) {
        container.add(nodeEngine.toData('item')!);
    }
}

describe('AddOperation', () => {
    test('whenFailOverflowPolicy_andNoRemainingCapacity_thenNoBackup', async () => {
        fillContainer(CAPACITY);

        const op = getAddOperation(OverflowPolicy.FAIL);
        await op.run();

        expect(op.shouldBackup()).toBe(false);
        expect(op.shouldNotify()).toBe(false);
        expect(op.getResponse()).toBe(-1);
    });

    test('whenFailOverflowPolicy_andRemainingCapacity_thenBackup', async () => {
        fillContainer(CAPACITY - 1);

        const op = getAddOperation(OverflowPolicy.FAIL);
        await op.run();

        expect(op.shouldBackup()).toBe(true);
        expect(op.shouldNotify()).toBe(true);
        expect(op.getResponse()).toBe(container.tailSequence());
    });

    test('whenOverwritePolicy_andNoRemainingCapacity_thenBackup', async () => {
        fillContainer(CAPACITY);

        const op = getAddOperation(OverflowPolicy.OVERWRITE);
        await op.run();

        expect(op.shouldBackup()).toBe(true);
        expect(op.shouldNotify()).toBe(true);
        expect(op.getResponse()).toBe(container.tailSequence());
    });

    test('whenOverwritePolicy_andRemainingCapacity_thenBackup', async () => {
        fillContainer(CAPACITY - 1);

        const op = getAddOperation(OverflowPolicy.OVERWRITE);
        await op.run();

        expect(op.shouldNotify()).toBe(true);
        expect(op.shouldBackup()).toBe(true);
        expect(op.getResponse()).toBe(container.tailSequence());
    });
});
