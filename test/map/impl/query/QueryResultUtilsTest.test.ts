/**
 * Port of com.hazelcast.map.impl.query.QueryResultUtilsTest
 */
import { describe, it, expect } from 'bun:test';
import { QueryResultUtils } from '@helios/map/impl/query/QueryResultUtils';

describe('QueryResultUtilsTest', () => {
    it('testConstructor — utility class is not instantiable', () => {
        // QueryResultUtils has only static methods; instantiation should throw
        expect(() => {
            // @ts-expect-error — private constructor
            new QueryResultUtils();
        }).toThrow();
    });
});
