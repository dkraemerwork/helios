/**
 * Port of com.hazelcast.cluster.impl.VectorClockTest
 */
import { VectorClock } from '@zenystx/helios-core/cluster/impl/VectorClock';
import { beforeAll, describe, expect, test } from 'bun:test';

describe('VectorClockTest', () => {
    let uuidParams: string[];

    beforeAll(() => {
        uuidParams = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    });

    function vectorClock(...params: unknown[]): VectorClock {
        const clock = new VectorClock();
        for (let i = 0; i < params.length; ) {
            clock.setReplicaTimestamp(params[i++] as string, params[i++] as number);
        }
        return clock;
    }

    function assertMerged(from: VectorClock, to: VectorClock, expected: VectorClock): void {
        to.merge(from);
        expect(to.equals(expected)).toBe(true);
    }

    test('testEquals', () => {
        const clock = vectorClock(uuidParams[0], 1, uuidParams[1], 2);
        expect(clock.equals(vectorClock(uuidParams[0], 1, uuidParams[1], 2))).toBe(true);
        expect(clock.equals(new VectorClock(clock))).toBe(true);
    });

    test('testIsAfter', () => {
        expect(vectorClock().isAfter(vectorClock())).toBe(false);
        expect(vectorClock(uuidParams[0], 1).isAfter(vectorClock())).toBe(true);
        expect(vectorClock(uuidParams[0], 1).isAfter(vectorClock(uuidParams[0], 1))).toBe(false);
        expect(vectorClock(uuidParams[0], 1).isAfter(vectorClock(uuidParams[1], 1))).toBe(false);
        expect(vectorClock(uuidParams[0], 1, uuidParams[1], 1).isAfter(vectorClock(uuidParams[0], 1))).toBe(true);
        expect(vectorClock(uuidParams[0], 1).isAfter(vectorClock(uuidParams[0], 1, uuidParams[1], 1))).toBe(false);
        expect(vectorClock(uuidParams[0], 2).isAfter(vectorClock(uuidParams[0], 1))).toBe(true);
        expect(vectorClock(uuidParams[0], 2).isAfter(vectorClock(uuidParams[0], 1, uuidParams[1], 1))).toBe(false);
        expect(vectorClock(uuidParams[0], 2, uuidParams[1], 1).isAfter(vectorClock(uuidParams[0], 1, uuidParams[1], 1))).toBe(true);
    });

    test('testMerge', () => {
        assertMerged(
            vectorClock(uuidParams[0], 1),
            vectorClock(),
            vectorClock(uuidParams[0], 1));
        assertMerged(
            vectorClock(uuidParams[0], 1),
            vectorClock(uuidParams[0], 2),
            vectorClock(uuidParams[0], 2));
        assertMerged(
            vectorClock(uuidParams[0], 2),
            vectorClock(uuidParams[0], 1),
            vectorClock(uuidParams[0], 2));
        assertMerged(
            vectorClock(uuidParams[0], 3, uuidParams[1], 1),
            vectorClock(uuidParams[0], 1, uuidParams[1], 2, uuidParams[2], 3),
            vectorClock(uuidParams[0], 3, uuidParams[1], 2, uuidParams[2], 3));
    });

    test('testIsEmpty', () => {
        expect(vectorClock().isEmpty()).toBe(true);
        expect(vectorClock(uuidParams[0], 1).isEmpty()).toBe(false);
    });
});
