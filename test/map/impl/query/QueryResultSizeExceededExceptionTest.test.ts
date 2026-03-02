/**
 * Port of com.hazelcast.map.impl.query.QueryResultSizeExceededExceptionTest
 */
import { describe, it, expect } from 'bun:test';
import { QueryResultSizeExceededException } from '@helios/map/QueryResultSizeExceededException';

describe('QueryResultSizeExceededExceptionTest', () => {
    it('testStringConstructor', () => {
        const exception = new QueryResultSizeExceededException();
        const expectedMessage = exception.message;

        // Simulate creating via string constructor (like ClientInvocationServiceSupport does)
        const actual = new QueryResultSizeExceededException(expectedMessage);

        expect(actual.message).toBe(expectedMessage);
    });
});
