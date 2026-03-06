import { describe, test, expect } from 'bun:test';
import { RingbufferWaitNotifyKey } from '@zenystx/core/ringbuffer/impl/RingbufferWaitNotifyKey';
import { RingbufferService } from '@zenystx/core/ringbuffer/impl/RingbufferService';
import { DistributedObjectNamespace } from '@zenystx/core/internal/services/DistributedObjectNamespace';
import { MapService } from '@zenystx/core/map/impl/MapService';

function waitNotifyKey(service: string, object: string, partitionId = 0): RingbufferWaitNotifyKey {
    return new RingbufferWaitNotifyKey(new DistributedObjectNamespace(service, object), partitionId);
}

function waitNotifyKeyByName(object: string): RingbufferWaitNotifyKey {
    return waitNotifyKey(RingbufferService.SERVICE_NAME, object);
}

function assertEquality(key1: unknown, key2: unknown, equals: boolean): void {
    if (equals) {
        expect(key1).toEqual(key2);
        expect((key1 as RingbufferWaitNotifyKey).hashCode()).toBe((key2 as RingbufferWaitNotifyKey).hashCode());
    } else {
        expect(key1).not.toEqual(key2);
    }
}

describe('RingbufferWaitNotifyKeyTest', () => {
    test('test_equals', () => {
        assertEquality(waitNotifyKeyByName('peter'), waitNotifyKeyByName('peter'), true);
        assertEquality(waitNotifyKeyByName('peter'), waitNotifyKeyByName('talip'), false);
        assertEquality(waitNotifyKeyByName('peter'), waitNotifyKey(MapService.SERVICE_NAME, 'peter'), false);
        assertEquality(waitNotifyKeyByName('peter'), waitNotifyKey(MapService.SERVICE_NAME, 'talip'), false);
        assertEquality(waitNotifyKeyByName('peter'), '', false);
        assertEquality(waitNotifyKeyByName('peter'), null, false);

        assertEquality(
            waitNotifyKey(RingbufferService.SERVICE_NAME, 'peter', 1),
            waitNotifyKey(MapService.SERVICE_NAME, 'peter', 1),
            false
        );

        assertEquality(
            waitNotifyKey(RingbufferService.SERVICE_NAME, 'peter', 1),
            waitNotifyKey(RingbufferService.SERVICE_NAME, 'peter', 2),
            false
        );

        const key = waitNotifyKeyByName('peter');
        assertEquality(key, key, true);
    });
});
