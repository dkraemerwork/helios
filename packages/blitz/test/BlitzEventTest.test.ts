/**
 * BlitzEvent unit tests — no NATS server required.
 */
import { describe, it, expect } from 'bun:test';
import { BlitzEvent } from '../src/BlitzEvent.ts';

describe('BlitzEvent', () => {
    it('has NATS_RECONNECTING value', () => {
        expect(BlitzEvent.NATS_RECONNECTING).toBeDefined();
    });

    it('has NATS_RECONNECTED value', () => {
        expect(BlitzEvent.NATS_RECONNECTED).toBeDefined();
    });

    it('has PIPELINE_ERROR value', () => {
        expect(BlitzEvent.PIPELINE_ERROR).toBeDefined();
    });

    it('has PIPELINE_CANCELLED value', () => {
        expect(BlitzEvent.PIPELINE_CANCELLED).toBeDefined();
    });

    it('all four enum members are distinct', () => {
        const values = new Set([
            BlitzEvent.NATS_RECONNECTING,
            BlitzEvent.NATS_RECONNECTED,
            BlitzEvent.PIPELINE_ERROR,
            BlitzEvent.PIPELINE_CANCELLED,
        ]);
        expect(values.size).toBe(4);
    });
});
