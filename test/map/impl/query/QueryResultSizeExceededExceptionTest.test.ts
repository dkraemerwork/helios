/**
 * Port of com.hazelcast.map.impl.query.QueryResultSizeExceededExceptionTest
 */
import { QueryResultSizeExceededException } from '@zenystx/helios-core/map/QueryResultSizeExceededException';
import { describe, expect, it } from 'bun:test';

describe('QueryResultSizeExceededExceptionTest', () => {
    it('testStringConstructor', () => {
        const exception = new QueryResultSizeExceededException();
        const expectedMessage = exception.message;

        // Simulate creating via string constructor (like ClientInvocationServiceSupport does)
        const actual = new QueryResultSizeExceededException(expectedMessage);

        expect(actual.message).toBe(expectedMessage);
    });
});
