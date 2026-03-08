/**
 * Port of {@code com.hazelcast.sql.SqlRowMetadata}.
 *
 * Describes the columns returned by a SQL query result.
 */

export type SqlColumnType =
    | 'VARCHAR'
    | 'BOOLEAN'
    | 'TINYINT'
    | 'SMALLINT'
    | 'INTEGER'
    | 'BIGINT'
    | 'DECIMAL'
    | 'REAL'
    | 'DOUBLE'
    | 'DATE'
    | 'TIME'
    | 'TIMESTAMP'
    | 'TIMESTAMP_WITH_TIME_ZONE'
    | 'OBJECT'
    | 'NULL';

export interface SqlColumnMetadata {
    readonly name: string;
    readonly type: SqlColumnType;
    readonly nullable: boolean;
}

export class SqlRowMetadata {
    private readonly _columns: ReadonlyArray<SqlColumnMetadata>;
    private readonly _nameToIndex: Map<string, number>;

    constructor(columns: SqlColumnMetadata[]) {
        this._columns = [...columns];
        this._nameToIndex = new Map(columns.map((col, idx) => [col.name.toLowerCase(), idx]));
    }

    /** Number of columns in each row. */
    getColumnCount(): number {
        return this._columns.length;
    }

    /** Returns the column descriptor at the given (0-based) index. */
    getColumn(index: number): SqlColumnMetadata {
        if (index < 0 || index >= this._columns.length) {
            throw new RangeError(`Column index out of bounds: ${index} (count=${this._columns.length})`);
        }
        return this._columns[index];
    }

    /** Returns all column descriptors. */
    getColumns(): ReadonlyArray<SqlColumnMetadata> {
        return this._columns;
    }

    /**
     * Find the 0-based index for a column by name (case-insensitive).
     * Returns -1 if not found.
     */
    findColumn(name: string): number {
        return this._nameToIndex.get(name.toLowerCase()) ?? -1;
    }
}
