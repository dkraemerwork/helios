/**
 * Port of {@code com.hazelcast.map.impl.query.QueryResultUtils}.
 *
 * Utility class for transforming QueryResult objects into result sets.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { QueryResult } from '@zenystx/helios-core/map/impl/query/QueryResult';
import type { QueryResultRow } from '@zenystx/helios-core/map/impl/query/QueryResultRow';

export class QueryResultUtils {
    private constructor() {
        throw new Error('QueryResultUtils is a utility class');
    }

    /**
     * Transforms a QueryResult into an array of nullable Data items.
     * Used by projection results where each row's value may be null.
     */
    static toNullableDataList(queryResult: QueryResult): Array<Data | null> {
        const rows: QueryResultRow[] = queryResult.getRows();
        const result: Array<Data | null> = new Array(rows.length);
        for (let i = 0; i < rows.length; i++) {
            result[i] = rows[i].getValue();
        }
        return result;
    }

    /**
     * Transforms a QueryResult into an array of Data items (keys).
     */
    static toKeyDataList(queryResult: QueryResult): Data[] {
        const rows: QueryResultRow[] = queryResult.getRows();
        const result: Data[] = [];
        for (const row of rows) {
            const key = row.getKey();
            if (key !== null) result.push(key);
        }
        return result;
    }

    /**
     * Transforms a QueryResult into an array of Data items (values).
     */
    static toValueDataList(queryResult: QueryResult): Data[] {
        const rows: QueryResultRow[] = queryResult.getRows();
        const result: Data[] = [];
        for (const row of rows) {
            const value = row.getValue();
            if (value !== null) result.push(value);
        }
        return result;
    }

    /**
     * Transforms a QueryResult into an array of entry pairs [key, value].
     */
    static toEntryDataList(queryResult: QueryResult): Array<[Data, Data]> {
        const rows: QueryResultRow[] = queryResult.getRows();
        const result: Array<[Data, Data]> = [];
        for (const row of rows) {
            const key = row.getKey();
            const value = row.getValue();
            if (key !== null && value !== null) result.push([key, value]);
        }
        return result;
    }
}
