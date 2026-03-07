/**
 * Port of com.hazelcast.map.impl.query.QueryResultUtilsTest
 */
import { QueryResultUtils } from '@zenystx/helios-core/map/impl/query/QueryResultUtils';
import { describe, expect, it } from 'bun:test';

describe('QueryResultUtilsTest', () => {
    it('testConstructor — utility class is not instantiable', () => {
        // QueryResultUtils has only static methods; instantiation should throw
        expect(() => {
            // @ts-expect-error — private constructor
            new QueryResultUtils();
        }).toThrow();
    });
});
