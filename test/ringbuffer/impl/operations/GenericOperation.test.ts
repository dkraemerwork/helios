/**
 * Port of {@code GenericOperationTest}.
 *
 * Tests GenericOperation: size, capacity, head, tail, remaining capacity.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { RingbufferConfig } from '@zenystx/core/config/RingbufferConfig';
import { RingbufferContainer } from '@zenystx/core/ringbuffer/impl/RingbufferContainer';
import { RingbufferService } from '@zenystx/core/ringbuffer/impl/RingbufferService';
import { GenericOperation } from '@zenystx/core/ringbuffer/impl/operations/GenericOperation';
import { TestNodeEngine } from '@zenystx/core/test-support/TestNodeEngine';

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

function getGenericOperation(operation: number): GenericOperation {
    const op = new GenericOperation(rbName, operation);
    op.setPartitionId(service.getRingbufferPartitionId(rbName));
    op.setNodeEngine(nodeEngine);
    return op;
}

describe('GenericOperation', () => {
    test('size', async () => {
        add('a');
        add('b');

        const op = getGenericOperation(GenericOperation.OPERATION_SIZE);
        await op.run();
        expect(op.getResponse()).toBe(container.size());
    });

    test('capacity', async () => {
        add('a');
        add('b');

        const op = getGenericOperation(GenericOperation.OPERATION_CAPACITY);
        await op.run();
        expect(op.getResponse()).toBe(CAPACITY);
    });

    test('remainingCapacity', async () => {
        add('a');
        add('b');

        const op = getGenericOperation(GenericOperation.OPERATION_REMAINING_CAPACITY);
        await op.run();
        // With TTL enabled, remaining = capacity - size
        expect(op.getResponse()).toBe(CAPACITY - 2);
    });

    test('tail', async () => {
        add('a');
        add('b');

        const op = getGenericOperation(GenericOperation.OPERATION_TAIL);
        await op.run();
        expect(op.getResponse()).toBe(container.tailSequence());
    });

    test('head', async () => {
        for (let k = 0; k < CAPACITY * 2; k++) {
            add('a');
        }

        const op = getGenericOperation(GenericOperation.OPERATION_HEAD);
        await op.run();
        expect(op.getResponse()).toBe(container.headSequence());
    });
});
