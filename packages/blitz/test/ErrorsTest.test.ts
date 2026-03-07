/**
 * Blitz error hierarchy unit tests — no NATS server required.
 */
import { describe, expect, it } from 'bun:test';
import { BlitzError } from '../src/errors/BlitzError.ts';
import { DeadLetterError } from '../src/errors/DeadLetterError.ts';
import { NakError } from '../src/errors/NakError.ts';
import { PipelineError } from '../src/errors/PipelineError.ts';

describe('BlitzError', () => {
    it('is an Error subclass', () => {
        const err = new BlitzError('test message');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(BlitzError);
    });

    it('has correct name', () => {
        const err = new BlitzError('test');
        expect(err.name).toBe('BlitzError');
    });

    it('stores message', () => {
        const err = new BlitzError('something went wrong');
        expect(err.message).toBe('something went wrong');
    });

    it('accepts optional cause', () => {
        const cause = new Error('root cause');
        const err = new BlitzError('wrapped', { cause });
        expect(err.cause).toBe(cause);
    });
});

describe('NakError', () => {
    it('is a BlitzError subclass', () => {
        const err = new NakError('nak');
        expect(err).toBeInstanceOf(BlitzError);
        expect(err).toBeInstanceOf(NakError);
    });

    it('has correct name', () => {
        const err = new NakError('nak');
        expect(err.name).toBe('NakError');
    });

    it('stores message', () => {
        const err = new NakError('message nak-ed');
        expect(err.message).toBe('message nak-ed');
    });

    it('accepts optional cause', () => {
        const cause = new Error('upstream');
        const err = new NakError('nak after retries', { cause });
        expect(err.cause).toBe(cause);
    });
});

describe('DeadLetterError', () => {
    it('is a BlitzError subclass', () => {
        const err = new DeadLetterError('dl');
        expect(err).toBeInstanceOf(BlitzError);
        expect(err).toBeInstanceOf(DeadLetterError);
    });

    it('has correct name', () => {
        const err = new DeadLetterError('dl');
        expect(err.name).toBe('DeadLetterError');
    });

    it('stores message', () => {
        const err = new DeadLetterError('sent to dead-letter');
        expect(err.message).toBe('sent to dead-letter');
    });
});

describe('PipelineError', () => {
    it('is a BlitzError subclass', () => {
        const err = new PipelineError('pipeline', 'my-pipeline');
        expect(err).toBeInstanceOf(BlitzError);
        expect(err).toBeInstanceOf(PipelineError);
    });

    it('has correct name', () => {
        const err = new PipelineError('pipeline failed', 'my-pipeline');
        expect(err.name).toBe('PipelineError');
    });

    it('stores pipelineName', () => {
        const err = new PipelineError('pipeline failed', 'order-processing');
        expect(err.pipelineName).toBe('order-processing');
    });

    it('stores message', () => {
        const err = new PipelineError('something went wrong', 'my-pipeline');
        expect(err.message).toBe('something went wrong');
    });
});
