/**
 * Port of {@code ReadManyOperationTest}.
 *
 * Tests ReadManyOperation including blocking behavior, min/max size, and filtering.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { RingbufferConfig } from '@helios/config/RingbufferConfig';
import { RingbufferContainer } from '@helios/ringbuffer/impl/RingbufferContainer';
import { RingbufferService } from '@helios/ringbuffer/impl/RingbufferService';
import { ReadManyOperation } from '@helios/ringbuffer/impl/operations/ReadManyOperation';
import { ReadResultSetImpl } from '@helios/ringbuffer/impl/ReadResultSetImpl';
import { CallStatus } from '@helios/spi/impl/operationservice/CallStatus';
import { TestNodeEngine } from '@helios/test-support/TestNodeEngine';

const rbName = 'foo';

let nodeEngine: TestNodeEngine;
let service: RingbufferService;
let container: RingbufferContainer;

beforeEach(() => {
    nodeEngine = new TestNodeEngine();
    service = new RingbufferService(nodeEngine);
    const rbConfig = new RingbufferConfig(rbName).setCapacity(10).setTimeToLiveSeconds(10);
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

function getReadManyOp<T>(start: number, min: number, max: number, filter: ((item: T) => boolean) | null = null): ReadManyOperation<T> {
    const op = new ReadManyOperation<T>(rbName, start, min, max, filter);
    op.setPartitionId(service.getRingbufferPartitionId(rbName));
    op.setNodeEngine(nodeEngine);
    return op;
}

function getResult<T>(op: ReadManyOperation<T>): ReadResultSetImpl<T> {
    return op.getResponse() as ReadResultSetImpl<T>;
}

describe('ReadManyOperation', () => {
    test('whenAtTail', () => {
        add('tail');

        const op = getReadManyOp<string>(container.tailSequence(), 1, 1);
        const status = op.call();
        expect(status).toBe(CallStatus.RESPONSE);

        const response = getResult(op);
        expect(response.toArray()).toEqual(['tail']);
        expect(response.readCount()).toBe(1);
        expect(response.getNextSequenceToReadFrom()).toBe(1);
    });

    test('whenOneAfterTail', () => {
        add('tail');

        const op = getReadManyOp(container.tailSequence() + 1, 1, 1);
        expect(op.call()).toBe(CallStatus.WAIT);

        const response = getResult(op);
        expect(response.readCount()).toBe(0);
        expect(response.getNextSequenceToReadFrom()).toBe(0);
    });

    test('whenTooFarAfterTail', () => {
        add('tail');

        const op = getReadManyOp(container.tailSequence() + 2, 1, 1);
        expect(op.call()).toBe(CallStatus.WAIT);

        const response = getResult(op);
        expect(response.readCount()).toBe(0);
        expect(response.getNextSequenceToReadFrom()).toBe(0);
    });

    test('whenOneAfterTailAndBufferEmpty', () => {
        const op = getReadManyOp(container.tailSequence() + 1, 1, 1);
        expect(op.call()).toBe(CallStatus.WAIT);

        const response = getResult(op);
        expect(response.readCount()).toBe(0);
        expect(response.getNextSequenceToReadFrom()).toBe(0);
        expect(response.isEmpty()).toBe(true);
    });

    test('whenOnTailAndBufferEmpty', () => {
        const op = getReadManyOp(container.tailSequence(), 1, 1);
        expect(op.call()).toBe(CallStatus.WAIT);

        const response = getResult(op);
        expect(response.readCount()).toBe(0);
        expect(response.getNextSequenceToReadFrom()).toBe(0);
    });

    test('whenBeforeTail', () => {
        add('item1');
        add('item2');
        add('item3');

        const op = getReadManyOp<string>(container.tailSequence() - 1, 1, 1);
        expect(op.call()).toBe(CallStatus.RESPONSE);

        const response = getResult(op);
        expect(response.toArray()).toEqual(['item2']);
        expect(response.readCount()).toBe(1);
        expect(response.getNextSequenceToReadFrom()).toBe(2);
        expect(response.size()).toBe(1);
    });

    test('whenAtHead', () => {
        add('item1');
        add('item2');
        add('item3');

        const op = getReadManyOp<string>(container.headSequence(), 1, 1);
        expect(op.call()).toBe(CallStatus.RESPONSE);

        const response = getResult(op);
        expect(response.toArray()).toEqual(['item1']);
        expect(response.readCount()).toBe(1);
        expect(response.getNextSequenceToReadFrom()).toBe(1);
        expect(response.size()).toBe(1);
    });

    test('whenBeforeHead - clamped to head', () => {
        add('item1');
        add('item2');
        add('item3');
        add('item4');
        add('item5');

        container.setHeadSequence(2);

        const op = getReadManyOp<string>(0, 1, 2);
        expect(op.call()).toBe(CallStatus.RESPONSE);

        const response = getResult(op);
        expect(response.readCount()).toBe(2);
        expect(response.toArray()).toEqual(['item3', 'item4']);
        expect(response.getNextSequenceToReadFrom()).toBe(4);
        expect(response.size()).toBe(2);
    });

    test('whenMinimumNumberOfItemsNotAvailable', () => {
        const startSequence = container.tailSequence() + 1;
        const op = getReadManyOp<string>(startSequence, 3, 3);

        expect(op.call()).toBe(CallStatus.WAIT);
        expect(op.sequence).toBe(startSequence);
        expect(getResult(op).isEmpty()).toBe(true);

        add('item1');
        expect(op.call()).toBe(CallStatus.WAIT);
        const response = getResult(op);
        expect(op.sequence).toBe(startSequence + 1);
        expect(response.toArray()).toEqual(['item1']);
        expect(response.getNextSequenceToReadFrom()).toBe(1);

        add('item2');
        expect(op.call()).toBe(CallStatus.WAIT);
        expect(op.sequence).toBe(startSequence + 2);
        expect(response.toArray()).toEqual(['item1', 'item2']);
        expect(response.getNextSequenceToReadFrom()).toBe(2);

        add('item3');
        expect(op.call()).toBe(CallStatus.RESPONSE);
        expect(op.sequence).toBe(startSequence + 3);
        expect(response.toArray()).toEqual(['item1', 'item2', 'item3']);
        expect(response.getNextSequenceToReadFrom()).toBe(3);
    });

    test('whenBelowMinimumAvailable', () => {
        const startSequence = container.tailSequence() + 1;
        const op = getReadManyOp<string>(startSequence, 3, 3);

        add('item1');
        add('item2');

        expect(op.call()).toBe(CallStatus.WAIT);
        const response = getResult(op);
        expect(op.sequence).toBe(startSequence + 2);
        expect(response.toArray()).toEqual(['item1', 'item2']);
        expect(response.getNextSequenceToReadFrom()).toBe(2);

        add('item3');
        expect(op.call()).toBe(CallStatus.RESPONSE);
        expect(op.sequence).toBe(startSequence + 3);
        expect(response.toArray()).toEqual(['item1', 'item2', 'item3']);
        expect(response.getNextSequenceToReadFrom()).toBe(3);
    });

    test('whenMinimumNumberOfItemsAvailable', () => {
        const startSequence = container.tailSequence() + 1;
        const op = getReadManyOp<string>(startSequence, 3, 3);

        add('item1');
        add('item2');
        add('item3');

        expect(op.call()).toBe(CallStatus.RESPONSE);
        const response = getResult(op);
        expect(op.sequence).toBe(startSequence + 3);
        expect(response.toArray()).toEqual(['item1', 'item2', 'item3']);
        expect(response.getNextSequenceToReadFrom()).toBe(3);
    });

    test('whenEnoughItemsAvailable', () => {
        const startSequence = container.tailSequence() + 1;
        const op = getReadManyOp<string>(startSequence, 1, 3);

        add('item1');
        add('item2');
        add('item3');
        add('item4');
        add('item5');

        expect(op.call()).toBe(CallStatus.RESPONSE);
        const response = getResult(op);
        expect(op.sequence).toBe(startSequence + 3);
        expect(response.toArray()).toEqual(['item1', 'item2', 'item3']);
        expect(response.readCount()).toBe(3);
        expect(response.getNextSequenceToReadFrom()).toBe(3);
    });

    test('whenFilterProvidedAndNoItemsAvailable', () => {
        const startSequence = container.tailSequence() + 1;
        const filter = (input: string) => input.startsWith('good');

        const op = getReadManyOp<string>(startSequence, 3, 3, filter);

        expect(op.call()).toBe(CallStatus.WAIT);
        const response = getResult(op);
        expect(op.sequence).toBe(startSequence);
        expect(response.isEmpty()).toBe(true);

        add('bad1');
        expect(op.call()).toBe(CallStatus.WAIT);
        expect(op.sequence).toBe(startSequence + 1);
        expect(response.readCount()).toBe(1);
        expect(response.getNextSequenceToReadFrom()).toBe(1);
        expect(response.size()).toBe(0);

        add('good1');
        expect(op.call()).toBe(CallStatus.WAIT);
        expect(op.sequence).toBe(startSequence + 2);
        expect(response.toArray()).toEqual(['good1']);
        expect(response.readCount()).toBe(2);
        expect(response.getNextSequenceToReadFrom()).toBe(2);

        add('bad2');
        expect(op.call()).toBe(CallStatus.WAIT);
        expect(op.sequence).toBe(startSequence + 3);
        expect(response.toArray()).toEqual(['good1']);
        expect(response.readCount()).toBe(3);

        add('good2');
        expect(op.call()).toBe(CallStatus.WAIT);
        expect(op.sequence).toBe(startSequence + 4);
        expect(response.toArray()).toEqual(['good1', 'good2']);
        expect(response.readCount()).toBe(4);

        add('bad3');
        expect(op.call()).toBe(CallStatus.WAIT);
        expect(op.sequence).toBe(startSequence + 5);
        expect(response.toArray()).toEqual(['good1', 'good2']);
        expect(response.readCount()).toBe(5);

        add('good3');
        expect(op.call()).toBe(CallStatus.RESPONSE);
        expect(op.sequence).toBe(startSequence + 6);
        expect(response.toArray()).toEqual(['good1', 'good2', 'good3']);
        expect(response.readCount()).toBe(6);
        expect(response.getNextSequenceToReadFrom()).toBe(6);
    });

    test('whenFilterProvidedAndAllItemsAvailable', () => {
        const startSequence = container.tailSequence() + 1;
        const filter = (input: string) => input.startsWith('good');

        const op = getReadManyOp<string>(startSequence, 3, 3, filter);

        add('bad1');
        add('good1');
        add('bad2');
        add('good2');
        add('bad3');
        add('good3');

        expect(op.call()).toBe(CallStatus.RESPONSE);
        const response = getResult(op);
        expect(op.sequence).toBe(startSequence + 6);
        expect(response.toArray()).toEqual(['good1', 'good2', 'good3']);
        expect(response.getNextSequenceToReadFrom()).toBe(6);
    });
});
