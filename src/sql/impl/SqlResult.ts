/**
 * Port of {@code com.hazelcast.sql.SqlResult}.
 *
 * Cursor-based result set for SQL queries.
 *
 * Provides:
 * - Iterator/async iterator interface for row consumption
 * - getRowMetadata() — column names and types
 * - close() — release resources and cancel any ongoing query
 * - isUpdateCount() — true for DML statements (INSERT/UPDATE/DELETE)
 * - getUpdateCount() — number of rows affected by DML
 */
import type { SqlRowMetadata } from '@zenystx/helios-core/sql/impl/SqlRowMetadata.js';

/** A single row of SQL results — maps column name to value. */
export type SqlRow = Record<string, unknown>;

export class SqlResult implements Iterable<SqlRow>, AsyncIterable<SqlRow> {
    private readonly _metadata: SqlRowMetadata;
    private readonly _rows: SqlRow[];
    private readonly _updateCount: number;
    private readonly _queryId: string;
    private _closed = false;
    private _cursor = 0;
    private _onClose?: () => void;

    constructor(
        metadata: SqlRowMetadata,
        rows: SqlRow[],
        updateCount: number,
        queryId: string,
        onClose?: () => void,
    ) {
        this._metadata = metadata;
        this._rows = rows;
        this._updateCount = updateCount;
        this._queryId = queryId;
        this._onClose = onClose;
    }

    /** Returns the column metadata for this result set. */
    getRowMetadata(): SqlRowMetadata {
        return this._metadata;
    }

    /** Returns the query ID that produced this result. */
    getQueryId(): string {
        return this._queryId;
    }

    /** True if this result represents a DML update count (not a SELECT result). */
    isUpdateCount(): boolean {
        return this._updateCount >= 0;
    }

    /**
     * For DML statements, returns the number of rows affected.
     * For SELECT statements, returns -1.
     */
    getUpdateCount(): number {
        return this._updateCount;
    }

    /** Number of rows in this result (for SELECT). */
    rowCount(): number {
        return this._rows.length;
    }

    remainingRowCount(): number {
        return this._rows.length - this._cursor;
    }

    hasMoreRows(): boolean {
        return this.remainingRowCount() > 0;
    }

    /** True if the cursor has been closed. */
    isClosed(): boolean {
        return this._closed;
    }

    /**
     * Close the cursor and release all resources.
     * After closing, iteration will stop and no more rows can be fetched.
     */
    close(): void {
        if (this._closed) return;
        this._closed = true;
        this._onClose?.();
        this._onClose = undefined;
    }

    // ── Synchronous iterator ───────────────────────────────────────────────

    [Symbol.iterator](): Iterator<SqlRow> {
        this._checkOpen();
        return this._syncIterator();
    }

    private *_syncIterator(): Iterator<SqlRow> {
        while (!this._closed && this._cursor < this._rows.length) {
            yield this._rows[this._cursor++];
        }
    }

    // ── Async iterator ─────────────────────────────────────────────────────

    [Symbol.asyncIterator](): AsyncIterator<SqlRow> {
        this._checkOpen();
        let cursor = this._cursor;
        const rows = this._rows;
        const self = this;

        return {
            async next(): Promise<IteratorResult<SqlRow>> {
                if (self._closed || cursor >= rows.length) {
                    return { value: undefined as unknown as SqlRow, done: true };
                }
                return { value: rows[cursor++], done: false };
            },
        };
    }

    // ── Convenience fetch methods ──────────────────────────────────────────

    /**
     * Fetch all remaining rows as an array.
     * Consumes the cursor.
     */
    toArray(): SqlRow[] {
        this._checkOpen();
        const result = this._rows.slice(this._cursor);
        this._cursor = this._rows.length;
        return result;
    }

    /**
     * Fetch the next page of rows (at most `size` rows).
     * Returns an empty array when exhausted.
     */
    fetchPage(size: number): SqlRow[] {
        this._checkOpen();
        const page = this._rows.slice(this._cursor, this._cursor + size);
        this._cursor += page.length;
        return page;
    }

    private _checkOpen(): void {
        if (this._closed) {
            throw new Error('SqlResult is already closed');
        }
    }
}
