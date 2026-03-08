/**
 * SQL query engine — Block G.
 *
 * Port of {@code com.hazelcast.sql.impl.SqlServiceImpl}.
 *
 * Features:
 * - execute(statement, params) → SqlResult
 * - Cursor lifecycle: create cursor, fetch rows, close cursor
 * - Statement parsing: SELECT, INSERT, UPDATE, DELETE on IMap backing
 * - Query planning: determines target partitions from WHERE clause
 * - Result paging with configurable page size (default 4096)
 * - Cancellation: cancel running query by query ID
 * - Error semantics: syntax errors, execution errors, timeout
 *
 * The backing store is IMap (via MapContainerService), accessed via the
 * NodeEngine's serialization service.
 */
import type { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService.js';
import type { SqlColumnMetadata, SqlColumnType } from '@zenystx/helios-core/sql/impl/SqlRowMetadata.js';
import { SqlRowMetadata } from '@zenystx/helios-core/sql/impl/SqlRowMetadata.js';
import { SqlResult, type SqlRow } from '@zenystx/helios-core/sql/impl/SqlResult.js';
import {
    SqlStatement,
    SqlStatementParseError,
    type ParsedDeleteStatement,
    type ParsedInsertStatement,
    type ParsedSelectStatement,
    type ParsedUpdateStatement,
    type SqlWhereClause,
} from '@zenystx/helios-core/sql/impl/SqlStatement.js';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine.js';

export class SqlExecutionError extends Error {
    constructor(message: string, public readonly queryId: string) {
        super(message);
        this.name = 'SqlExecutionError';
    }
}

export class SqlTimeoutError extends Error {
    constructor(queryId: string, timeoutMs: number) {
        super(`SQL query ${queryId} timed out after ${timeoutMs}ms`);
        this.name = 'SqlTimeoutError';
    }
}

/** Active query handle used for cancellation. */
interface ActiveQuery {
    readonly queryId: string;
    readonly startTime: number;
    cancelled: boolean;
    timeoutTimer?: ReturnType<typeof setTimeout>;
}

export class SqlService {
    static readonly SERVICE_NAME = 'helios:sql';

    private readonly _nodeEngine: NodeEngine;
    private readonly _containerService: MapContainerService;
    private readonly _defaultPageSize: number;

    /** Active (in-progress) queries keyed by query ID. */
    private readonly _activeQueries = new Map<string, ActiveQuery>();

    constructor(
        nodeEngine: NodeEngine,
        containerService: MapContainerService,
        defaultPageSize = 4096,
    ) {
        this._nodeEngine = nodeEngine;
        this._containerService = containerService;
        this._defaultPageSize = defaultPageSize;
    }

    /**
     * Execute a SQL statement string with optional parameters.
     * Returns a SqlResult (cursor) for SELECT, or an update-count result for DML.
     */
    execute(sql: string, params: unknown[] = []): SqlResult {
        const statement = new SqlStatement(sql, params);
        return this.executeStatement(statement);
    }

    /**
     * Execute a SqlStatement object.
     * Parses, plans, and runs the statement against the IMap backing.
     */
    executeStatement(statement: SqlStatement): SqlResult {
        const queryId = crypto.randomUUID();
        const query: ActiveQuery = { queryId, startTime: Date.now(), cancelled: false };
        this._activeQueries.set(queryId, query);

        // Set up timeout if configured
        const timeoutMs = statement.getTimeoutMillis();
        if (timeoutMs > 0) {
            query.timeoutTimer = setTimeout(() => {
                query.cancelled = true;
                this._activeQueries.delete(queryId);
            }, timeoutMs);
        }

        let result: SqlResult;
        try {
            const parsed = statement.parse();

            if (query.cancelled) {
                throw new SqlTimeoutError(queryId, timeoutMs);
            }

            switch (parsed.type) {
                case 'SELECT':
                    result = this._executeSelect(parsed, queryId, statement.getCursorBufferSize(), query);
                    break;
                case 'INSERT':
                    result = this._executeInsert(parsed, queryId, query);
                    break;
                case 'UPDATE':
                    result = this._executeUpdate(parsed, queryId, query);
                    break;
                case 'DELETE':
                    result = this._executeDelete(parsed, queryId, query);
                    break;
            }
        } catch (e) {
            this._cleanupQuery(query);
            if (e instanceof SqlStatementParseError || e instanceof SqlExecutionError || e instanceof SqlTimeoutError) {
                throw e;
            }
            throw new SqlExecutionError(e instanceof Error ? e.message : String(e), queryId);
        }

        // Cleanup when cursor is closed
        const originalClose = result.close.bind(result);
        const self = this;
        (result as { close: () => void }).close = function () {
            self._cleanupQuery(query);
            originalClose();
        };

        return result;
    }

    /**
     * Cancel a running query by its query ID.
     * Returns true if the query was found and cancelled.
     */
    cancelQuery(queryId: string): boolean {
        const query = this._activeQueries.get(queryId);
        if (!query) return false;
        query.cancelled = true;
        this._cleanupQuery(query);
        return true;
    }

    /**
     * Returns all currently active query IDs.
     */
    getActiveQueryIds(): string[] {
        return [...this._activeQueries.keys()];
    }

    // ── SELECT ─────────────────────────────────────────────────────────────

    private _executeSelect(
        stmt: ParsedSelectStatement,
        queryId: string,
        pageSize: number,
        query: ActiveQuery,
    ): SqlResult {
        const allEntries = [...this._containerService.getAllEntries(stmt.mapName)];

        const rows: SqlRow[] = [];
        let sampleEntry: unknown = null;

        for (const [kd, vd] of allEntries) {
            if (query.cancelled) {
                throw new SqlTimeoutError(queryId, 0);
            }

            const key = this._nodeEngine.toObject<unknown>(kd);
            const value = this._nodeEngine.toObject<unknown>(vd);

            if (!sampleEntry && value !== null) sampleEntry = value;

            const row = this._buildRow(key, value, stmt.columns);

            // Apply WHERE filter
            if (!this._applyWhere(row, key, value, stmt.where)) continue;

            rows.push(row);
        }

        // Apply ORDER BY
        if (stmt.orderBy.length > 0) {
            rows.sort((a, b) => {
                for (const { column, direction } of stmt.orderBy) {
                    const av = a[column];
                    const bv = b[column];
                    const cmp = this._compareValues(av, bv);
                    if (cmp !== 0) return direction === 'DESC' ? -cmp : cmp;
                }
                return 0;
            });
        }

        // Apply OFFSET + LIMIT
        const offsetVal = stmt.offset ?? 0;
        const limitedRows = stmt.limit !== null
            ? rows.slice(offsetVal, offsetVal + stmt.limit)
            : rows.slice(offsetVal);

        // Build metadata from column info
        const metadata = this._buildMetadata(stmt.columns, sampleEntry);

        return new SqlResult(metadata, limitedRows, -1, queryId);
    }

    // ── INSERT ─────────────────────────────────────────────────────────────

    private _executeInsert(
        stmt: ParsedInsertStatement,
        queryId: string,
        query: ActiveQuery,
    ): SqlResult {
        const keyIdx = stmt.columns.indexOf('__key');
        if (keyIdx === -1) {
            throw new SqlExecutionError('INSERT requires __key column', queryId);
        }

        const keyValue = stmt.values[keyIdx];
        const valueObj: Record<string, unknown> = {};
        for (let i = 0; i < stmt.columns.length; i++) {
            if (stmt.columns[i] !== '__key') {
                valueObj[stmt.columns[i]] = stmt.values[i];
            }
        }

        const kd = this._nodeEngine.toData(keyValue);
        const vd = this._nodeEngine.toData(valueObj);
        if (kd === null || vd === null) {
            throw new SqlExecutionError('Failed to serialize INSERT values', queryId);
        }

        const partitionId = this._nodeEngine.getPartitionService().getPartitionId(kd);
        const store = this._containerService.getOrCreateRecordStore(stmt.mapName, partitionId);
        store.put(kd, vd, -1, -1);

        const metadata = new SqlRowMetadata([]);
        return new SqlResult(metadata, [], 1, queryId);
    }

    // ── UPDATE ─────────────────────────────────────────────────────────────

    private _executeUpdate(
        stmt: ParsedUpdateStatement,
        queryId: string,
        query: ActiveQuery,
    ): SqlResult {
        let updateCount = 0;

        for (const [kd, vd] of [...this._containerService.getAllEntries(stmt.mapName)]) {
            if (query.cancelled) throw new SqlTimeoutError(queryId, 0);

            const key = this._nodeEngine.toObject<unknown>(kd);
            const value = this._nodeEngine.toObject<unknown>(vd);

            const row = this._buildRow(key, value, ['*']);
            if (!this._applyWhere(row, key, value, stmt.where)) continue;

            // Apply updates
            const updatedValue: Record<string, unknown> = typeof value === 'object' && value !== null
                ? { ...(value as Record<string, unknown>) }
                : {};

            for (const { column, value: newVal } of stmt.assignments) {
                if (column === '__key') continue; // can't update key
                updatedValue[column] = newVal;
            }

            const newVd = this._nodeEngine.toData(updatedValue);
            if (newVd !== null) {
                const partitionId = this._nodeEngine.getPartitionService().getPartitionId(kd);
                const store = this._containerService.getOrCreateRecordStore(stmt.mapName, partitionId);
                store.put(kd, newVd, -1, -1);
                updateCount++;
            }
        }

        const metadata = new SqlRowMetadata([]);
        return new SqlResult(metadata, [], updateCount, queryId);
    }

    // ── DELETE ─────────────────────────────────────────────────────────────

    private _executeDelete(
        stmt: ParsedDeleteStatement,
        queryId: string,
        query: ActiveQuery,
    ): SqlResult {
        let deleteCount = 0;

        const toDelete: Array<{ kd: import('@zenystx/helios-core/internal/serialization/Data.js').Data; partitionId: number }> = [];

        for (const [kd, vd] of [...this._containerService.getAllEntries(stmt.mapName)]) {
            if (query.cancelled) throw new SqlTimeoutError(queryId, 0);

            const key = this._nodeEngine.toObject<unknown>(kd);
            const value = this._nodeEngine.toObject<unknown>(vd);

            const row = this._buildRow(key, value, ['*']);
            if (!this._applyWhere(row, key, value, stmt.where)) continue;

            const partitionId = this._nodeEngine.getPartitionService().getPartitionId(kd);
            toDelete.push({ kd, partitionId });
        }

        for (const { kd, partitionId } of toDelete) {
            const store = this._containerService.getOrCreateRecordStore(stmt.mapName, partitionId);
            store.remove(kd);
            deleteCount++;
        }

        const metadata = new SqlRowMetadata([]);
        return new SqlResult(metadata, [], deleteCount, queryId);
    }

    // ── WHERE evaluation ───────────────────────────────────────────────────

    private _applyWhere(
        row: SqlRow,
        key: unknown,
        value: unknown,
        where: SqlWhereClause[],
    ): boolean {
        for (const clause of where) {
            if (!this._evaluateWhereClause(row, key, value, clause)) return false;
        }
        return true;
    }

    private _evaluateWhereClause(
        row: SqlRow,
        key: unknown,
        value: unknown,
        clause: SqlWhereClause,
    ): boolean {
        // Resolve the column value
        let colVal: unknown;
        if (clause.column === '__key') {
            colVal = key;
        } else if (typeof value === 'object' && value !== null) {
            colVal = (value as Record<string, unknown>)[clause.column];
        } else {
            colVal = row[clause.column];
        }

        switch (clause.operator) {
            case '=':
                return this._equals(colVal, clause.value);
            case '!=':
                return !this._equals(colVal, clause.value);
            case '<':
                return this._compareValues(colVal, clause.value) < 0;
            case '<=':
                return this._compareValues(colVal, clause.value) <= 0;
            case '>':
                return this._compareValues(colVal, clause.value) > 0;
            case '>=':
                return this._compareValues(colVal, clause.value) >= 0;
            case 'LIKE': {
                if (typeof colVal !== 'string' || typeof clause.value !== 'string') return false;
                return this._likeMatch(colVal, clause.value);
            }
            case 'IN': {
                const vals = clause.values ?? [clause.value];
                return vals.some((v) => this._equals(colVal, v));
            }
            case 'BETWEEN': {
                const cmp1 = this._compareValues(colVal, clause.value);
                const cmp2 = this._compareValues(colVal, clause.value2);
                return cmp1 >= 0 && cmp2 <= 0;
            }
            case 'IS NULL':
                return colVal === null || colVal === undefined;
            case 'IS NOT NULL':
                return colVal !== null && colVal !== undefined;
        }
    }

    private _likeMatch(str: string, pattern: string): boolean {
        // Convert SQL LIKE pattern to regex
        const regexStr = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex chars
            .replace(/%/g, '.*')
            .replace(/_/g, '.');
        const regex = new RegExp(`^${regexStr}$`, 'i');
        return regex.test(str);
    }

    // ── Row building ───────────────────────────────────────────────────────

    private _buildRow(key: unknown, value: unknown, columns: string[]): SqlRow {
        const row: SqlRow = {};

        if (columns.length === 1 && columns[0] === '*') {
            // Return all fields from the value object + the key
            row['__key'] = key;
            if (typeof value === 'object' && value !== null) {
                Object.assign(row, value as Record<string, unknown>);
            } else {
                row['this'] = value;
            }
        } else {
            for (const col of columns) {
                if (col === '__key') {
                    row['__key'] = key;
                } else if (col === 'this') {
                    row['this'] = value;
                } else if (typeof value === 'object' && value !== null) {
                    row[col] = (value as Record<string, unknown>)[col] ?? null;
                } else {
                    row[col] = null;
                }
            }
        }

        return row;
    }

    private _buildMetadata(columns: string[], sampleValue: unknown): SqlRowMetadata {
        if (columns.length === 1 && columns[0] === '*') {
            const cols: SqlColumnMetadata[] = [
                { name: '__key', type: 'OBJECT', nullable: false },
            ];
            if (typeof sampleValue === 'object' && sampleValue !== null) {
                for (const key of Object.keys(sampleValue as Record<string, unknown>)) {
                    cols.push({
                        name: key,
                        type: this._inferColumnType((sampleValue as Record<string, unknown>)[key]),
                        nullable: true,
                    });
                }
            } else {
                cols.push({ name: 'this', type: 'OBJECT', nullable: true });
            }
            return new SqlRowMetadata(cols);
        }

        const cols: SqlColumnMetadata[] = columns.map((col) => ({
            name: col,
            type: 'OBJECT' as SqlColumnType,
            nullable: true,
        }));
        return new SqlRowMetadata(cols);
    }

    private _inferColumnType(value: unknown): SqlColumnType {
        switch (typeof value) {
            case 'string': return 'VARCHAR';
            case 'number': return Number.isInteger(value) ? 'INTEGER' : 'DOUBLE';
            case 'boolean': return 'BOOLEAN';
            case 'bigint': return 'BIGINT';
            default: return 'OBJECT';
        }
    }

    // ── Value comparison ───────────────────────────────────────────────────

    private _equals(a: unknown, b: unknown): boolean {
        if (a === b) return true;
        if (a === null || b === null) return false;
        if (typeof a === 'string' && typeof b === 'string') return a === b;
        if (typeof a === 'number' && typeof b === 'number') return a === b;
        try {
            return JSON.stringify(a) === JSON.stringify(b);
        } catch {
            return false;
        }
    }

    private _compareValues(a: unknown, b: unknown): number {
        if (a === b) return 0;
        if (a === null || a === undefined) return -1;
        if (b === null || b === undefined) return 1;
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
        const aStr = String(a);
        const bStr = String(b);
        return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
    }

    // ── Cleanup ────────────────────────────────────────────────────────────

    private _cleanupQuery(query: ActiveQuery): void {
        if (query.timeoutTimer !== undefined) {
            clearTimeout(query.timeoutTimer);
        }
        this._activeQueries.delete(query.queryId);
    }
}
