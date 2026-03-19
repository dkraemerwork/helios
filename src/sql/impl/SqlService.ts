/**
 * SQL query engine — Block G / WP8.
 *
 * Port of {@code com.hazelcast.sql.impl.SqlServiceImpl}.
 *
 * Features (WP8 additions):
 * - CREATE/DROP MAPPING → MappingRegistry
 * - GROUP BY + HAVING + aggregate functions (COUNT, SUM, AVG, MIN, MAX)
 * - DISTINCT
 * - OR in WHERE clauses (full condition tree)
 * - Expression engine (arithmetic, functions, CASE, CAST)
 * - SELECT with aliases and computed expressions
 * - Enhanced error codes (SqlErrorCode)
 */
import type { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService.js';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine.js';
import {
    MappingAlreadyExistsError,
    MappingNotFoundError,
    MappingRegistry,
    type MappingConfig,
} from '@zenystx/helios-core/sql/impl/MappingRegistry.js';
import { SqlResult, type SqlRow } from '@zenystx/helios-core/sql/impl/SqlResult.js';
import type { SqlColumnMetadata, SqlColumnType } from '@zenystx/helios-core/sql/impl/SqlRowMetadata.js';
import { SqlRowMetadata } from '@zenystx/helios-core/sql/impl/SqlRowMetadata.js';
import {
    SqlStatement,
    SqlStatementParseError,
    isWhereGroup,
    type AggregateCall,
    type ParsedCreateMappingStatement,
    type ParsedDeleteStatement,
    type ParsedDropMappingStatement,
    type ParsedInsertStatement,
    type ParsedSelectStatement,
    type ParsedUpdateStatement,
    type SelectItem,
    type SqlConditionNode,
    type SqlWhereClause,
} from '@zenystx/helios-core/sql/impl/SqlStatement.js';
import { SqlErrorCode } from '@zenystx/helios-core/sql/impl/SqlTypeSystem.js';
import { AggregateExpression, type AggregateAccumulator } from '@zenystx/helios-core/sql/impl/expression/AggregateExpression.js';
import {
    ColumnExpression,
    FunctionExpression,
    LiteralExpression,
    _compare,
    _equals,
} from '@zenystx/helios-core/sql/impl/expression/Expression.js';

// ── Error types ───────────────────────────────────────────────────────────────

export class SqlExecutionError extends Error {
    constructor(
        message: string,
        public readonly queryId: string,
        public readonly errorCode: SqlErrorCode = SqlErrorCode.GENERIC,
    ) {
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

// ── Active query tracking ─────────────────────────────────────────────────────

interface ActiveQuery {
    readonly queryId: string;
    readonly startTime: number;
    cancelled: boolean;
    timeoutTimer?: ReturnType<typeof setTimeout>;
}

// ── Aggregate result slot ─────────────────────────────────────────────────────

interface AggregateSlot {
    readonly alias: string;
    readonly aggExpr: AggregateExpression;
    accumulator: AggregateAccumulator;
}

// ── SqlService ────────────────────────────────────────────────────────────────

export class SqlService {
    static readonly SERVICE_NAME = 'helios:sql';

    private readonly _nodeEngine: NodeEngine;
    private readonly _containerService: MapContainerService;
    private readonly _defaultPageSize: number;
    private readonly _mappingRegistry = new MappingRegistry();

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

    /** Expose the mapping registry for external access (e.g. handlers). */
    getMappingRegistry(): MappingRegistry {
        return this._mappingRegistry;
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
                case 'CREATE_MAPPING':
                    result = this._executeCreateMapping(parsed, queryId);
                    break;
                case 'DROP_MAPPING':
                    result = this._executeDropMapping(parsed, queryId);
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

    /** Cancel a running query by its query ID. Returns true if cancelled. */
    cancelQuery(queryId: string): boolean {
        const query = this._activeQueries.get(queryId);
        if (!query) return false;
        query.cancelled = true;
        this._cleanupQuery(query);
        return true;
    }

    /** Returns all currently active query IDs. */
    getActiveQueryIds(): string[] {
        return [...this._activeQueries.keys()];
    }

    // ── CREATE MAPPING ────────────────────────────────────────────────────────

    private _executeCreateMapping(
        stmt: ParsedCreateMappingStatement,
        queryId: string,
    ): SqlResult {
        const config: MappingConfig = {
            name: stmt.mappingName,
            type: 'IMap',
            columns: stmt.columns,
            options: stmt.options,
        };

        if (stmt.ifNotExists) {
            this._mappingRegistry.createMappingIfNotExists(config);
        } else {
            try {
                this._mappingRegistry.createMapping(config);
            } catch (e) {
                if (e instanceof MappingAlreadyExistsError) {
                    throw new SqlExecutionError(e.message, queryId, SqlErrorCode.PARSING);
                }
                throw e;
            }
        }

        return new SqlResult(new SqlRowMetadata([]), [], 0, queryId);
    }

    // ── DROP MAPPING ──────────────────────────────────────────────────────────

    private _executeDropMapping(
        stmt: ParsedDropMappingStatement,
        queryId: string,
    ): SqlResult {
        if (stmt.ifExists) {
            this._mappingRegistry.dropMappingIfExists(stmt.mappingName);
        } else {
            try {
                this._mappingRegistry.dropMapping(stmt.mappingName);
            } catch (e) {
                if (e instanceof MappingNotFoundError) {
                    throw new SqlExecutionError(e.message, queryId, SqlErrorCode.PARSING);
                }
                throw e;
            }
        }

        return new SqlResult(new SqlRowMetadata([]), [], 0, queryId);
    }

    // ── SELECT ────────────────────────────────────────────────────────────────

    private _executeSelect(
        stmt: ParsedSelectStatement,
        queryId: string,
        pageSize: number,
        query: ActiveQuery,
    ): SqlResult {
        const allEntries = [...this._containerService.getAllEntries(stmt.mapName)];

        // Determine whether we have aggregates in the select list
        const hasAggregates = stmt.selectItems.some(
            (item) => typeof item.expression !== 'string',
        );
        const hasGroupBy = stmt.groupBy.length > 0;

        // ── Phase 1: scan + WHERE filter ─────────────────────────────────────

        type RawEntry = { row: SqlRow; key: unknown; value: unknown };
        const filtered: RawEntry[] = [];
        let sampleEntry: unknown = null;

        // For aggregate / GROUP BY queries we need ALL fields available for evaluation.
        // For plain projection we can use the declared column list.
        const scanColumns = (hasAggregates || hasGroupBy) ? ['*'] : stmt.columns;

        for (const [kd, vd] of allEntries) {
            if (query.cancelled) throw new SqlTimeoutError(queryId, 0);

            const key = this._nodeEngine.toObject<unknown>(kd);
            const value = this._nodeEngine.toObject<unknown>(vd);

            if (!sampleEntry && value !== null) sampleEntry = value;

            const row = this._buildRow(key, value, scanColumns);

            if (!this._applyConditionTree(row, key, value, stmt.where)) continue;

            filtered.push({ row, key, value });
        }

        let resultRows: SqlRow[];

        if (hasAggregates || hasGroupBy) {
            // ── Phase 2a: GROUP BY + aggregation ─────────────────────────────
            resultRows = this._executeGroupBy(stmt, filtered, queryId, query);
        } else {
            // ── Phase 2b: plain projection ────────────────────────────────────
            resultRows = filtered.map(({ row, key, value }) =>
                this._projectRow(row, key, value, stmt.selectItems),
            );

            // DISTINCT (no aggregation case)
            if (stmt.distinct) {
                resultRows = this._deduplicateRows(resultRows);
            }

            // ORDER BY
            if (stmt.orderBy.length > 0) {
                resultRows.sort((a, b) => {
                    for (const { column, direction } of stmt.orderBy) {
                        const cmp = _compare(a[column], b[column]);
                        if (cmp !== 0) return direction === 'DESC' ? -cmp : cmp;
                    }
                    return 0;
                });
            }
        }

        // ── Phase 3: OFFSET + LIMIT ───────────────────────────────────────────
        const offsetVal = stmt.offset ?? 0;
        const limitedRows = stmt.limit !== null
            ? resultRows.slice(offsetVal, offsetVal + stmt.limit)
            : resultRows.slice(offsetVal);

        const metadata = this._buildMetadata(stmt.selectItems, sampleEntry);
        return new SqlResult(metadata, limitedRows, -1, queryId);
    }

    private _executeGroupBy(
        stmt: ParsedSelectStatement,
        filtered: Array<{ row: SqlRow; key: unknown; value: unknown }>,
        queryId: string,
        query: ActiveQuery,
    ): SqlRow[] {
        // Build aggregate slot descriptors from the select item list
        const aggSlotTemplates: Array<{
            alias: string;
            aggExpr: AggregateExpression;
        }> = [];

        for (const item of stmt.selectItems) {
            if (typeof item.expression !== 'string') {
                const agg = item.expression as AggregateCall;
                const fn = agg.function.toUpperCase() as 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
                const operand = agg.column === '*'
                    ? null
                    : new ColumnExpression(agg.column);
                const distinct = agg.distinct ?? false;
                const alias = item.alias ?? `${agg.function}(${agg.column})`;
                aggSlotTemplates.push({ alias, aggExpr: new AggregateExpression(fn, operand, distinct) });
            }
        }

        // Group rows
        const groups = new Map<string, {
            groupRow: SqlRow;
            key: unknown;
            value: unknown;
            rows: Array<{ row: SqlRow; key: unknown; value: unknown }>;
        }>();

        const noGroupBy = stmt.groupBy.length === 0;

        for (const entry of filtered) {
            if (query.cancelled) throw new SqlTimeoutError(queryId, 0);

            let groupKey: string;
            let groupRowSample: SqlRow;

            if (noGroupBy) {
                groupKey = '__all__';
                groupRowSample = entry.row;
            } else {
                const keyParts = stmt.groupBy.map((col) => {
                    const v = entry.row[col] ?? entry.key;
                    return String(v);
                });
                groupKey = keyParts.join('\x00');
                groupRowSample = entry.row;
            }

            if (!groups.has(groupKey)) {
                groups.set(groupKey, {
                    groupRow: groupRowSample,
                    key: entry.key,
                    value: entry.value,
                    rows: [],
                });
            }
            groups.get(groupKey)!.rows.push(entry);
        }

        // Evaluate aggregates per group
        const resultRows: SqlRow[] = [];

        for (const [, group] of groups) {
            // Create fresh accumulators for this group
            const slots: AggregateSlot[] = aggSlotTemplates.map((t) => ({
                alias: t.alias,
                aggExpr: t.aggExpr,
                accumulator: t.aggExpr.createAccumulator(),
            }));

            for (const entry of group.rows) {
                for (const slot of slots) {
                    slot.aggExpr.feed(slot.accumulator, entry.row, entry.key, entry.value);
                }
            }

            // Build result row
            const resultRow: SqlRow = {};

            // Include GROUP BY columns
            for (const col of stmt.groupBy) {
                resultRow[col] = group.groupRow[col] ?? null;
            }

            // Include aggregate results
            for (const slot of slots) {
                resultRow[slot.alias] = slot.accumulator.getResult();
            }

            // Apply HAVING filter
            if (stmt.having.length > 0) {
                const dummyKey = group.key;
                const dummyValue = group.value;
                if (!this._applyConditionTree(resultRow, dummyKey, dummyValue, stmt.having)) continue;
            }

            resultRows.push(resultRow);
        }

        // ORDER BY on grouped results
        if (stmt.orderBy.length > 0) {
            resultRows.sort((a, b) => {
                for (const { column, direction } of stmt.orderBy) {
                    const cmp = _compare(a[column], b[column]);
                    if (cmp !== 0) return direction === 'DESC' ? -cmp : cmp;
                }
                return 0;
            });
        }

        return resultRows;
    }

    // ── Row projection (SELECT item evaluation) ───────────────────────────────

    private _projectRow(
        row: SqlRow,
        key: unknown,
        value: unknown,
        selectItems: SelectItem[],
    ): SqlRow {
        // Wildcard: return as-is
        if (selectItems.length === 1 && selectItems[0].expression === '*') {
            return row;
        }

        const result: SqlRow = {};
        for (const item of selectItems) {
            const expr = item.expression;
            const alias = item.alias;

            if (typeof expr === 'string') {
                const outKey = alias ?? expr;
                result[outKey] = this._evaluateSimpleExpression(expr, row, key, value);
            }
            // Aggregates in non-grouped context are handled by _executeGroupBy
        }
        return result;
    }

    /**
     * Evaluate a simple column reference or function call string.
     * This is used for non-aggregate SELECT expressions.
     */
    private _evaluateSimpleExpression(
        expr: string,
        row: SqlRow,
        key: unknown,
        value: unknown,
    ): unknown {
        const trimmed = expr.trim();
        const upper = trimmed.toUpperCase();

        // __key / this
        if (upper === '__KEY') return key;
        if (upper === 'THIS') return value;

        // Numeric literal
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            return trimmed.includes('.') ? parseFloat(trimmed) : parseInt(trimmed, 10);
        }

        // String literal
        if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
            (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
            return trimmed.slice(1, -1);
        }

        // Function call: FNNAME(args...) — must have balanced parens
        const parenIdx = trimmed.indexOf('(');
        if (parenIdx > 0 && trimmed.endsWith(')')) {
            const fnName = trimmed.substring(0, parenIdx).trim().toUpperCase();
            const argsStr = trimmed.substring(parenIdx + 1, trimmed.length - 1);
            const argExprs = this._splitTopLevel(argsStr, ',').map((a) => {
                const at = a.trim();
                if (/^\w+$/.test(at)) return new ColumnExpression(at);
                return new LiteralExpression(this._evaluateSimpleExpression(at, row, key, value));
            });
            try {
                const fn = new FunctionExpression(fnName as never, argExprs);
                return fn.evaluate(row, key, value);
            } catch {
                return null;
            }
        }

        // Arithmetic: split on +/-/*/÷/% outside parens (right-to-left for left-assoc)
        // We attempt the split only on tokens that look like binary ops
        for (const op of ['+', '-', '*', '/', '%'] as const) {
            const idx = this._findBinaryOpOutsideParens(trimmed, op);
            if (idx !== -1) {
                const l = this._evaluateSimpleExpression(trimmed.substring(0, idx).trim(), row, key, value);
                const r = this._evaluateSimpleExpression(trimmed.substring(idx + 1).trim(), row, key, value);
                const ln = Number(l);
                const rn = Number(r);
                if (!isNaN(ln) && !isNaN(rn)) {
                    switch (op) {
                        case '+': return ln + rn;
                        case '-': return ln - rn;
                        case '*': return ln * rn;
                        case '/': return rn === 0 ? null : ln / rn;
                        case '%': return rn === 0 ? null : ln % rn;
                    }
                }
                break;
            }
        }

        // Plain column reference
        return new ColumnExpression(trimmed).evaluate(row, key, value);
    }

    /** Find the last occurrence of a binary operator outside parentheses/quotes. */
    private _findBinaryOpOutsideParens(str: string, op: string): number {
        let depth = 0;
        let inString = false;
        let quoteChar = '';
        // Scan right-to-left so we get left-associativity
        for (let i = str.length - 1; i >= 0; i--) {
            const ch = str[i];
            if (inString) {
                if (ch === quoteChar) inString = false;
                continue;
            }
            if (ch === ')') { depth++; continue; }
            if (ch === '(') { depth--; continue; }
            if (depth === 0 && ch === op) return i;
        }
        return -1;
    }

    private _splitTopLevel(str: string, sep: string): string[] {
        const parts: string[] = [];
        let current = '';
        let depth = 0;
        let inString = false;
        let quoteChar = '';

        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            if (inString) {
                if (ch === quoteChar) inString = false;
                current += ch;
            } else if (ch === "'" || ch === '"') {
                inString = true;
                quoteChar = ch;
                current += ch;
            } else if (ch === '(') {
                depth++;
                current += ch;
            } else if (ch === ')') {
                depth--;
                current += ch;
            } else if (depth === 0 && ch === sep) {
                parts.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        parts.push(current);
        return parts;
    }

    // ── INSERT ────────────────────────────────────────────────────────────────

    private _executeInsert(
        stmt: ParsedInsertStatement,
        queryId: string,
        query: ActiveQuery,
    ): SqlResult {
        const keyIdx = stmt.columns.indexOf('__key');
        if (keyIdx === -1) {
            throw new SqlExecutionError('INSERT requires __key column', queryId, SqlErrorCode.DATA_EXCEPTION);
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
            throw new SqlExecutionError('Failed to serialize INSERT values', queryId, SqlErrorCode.DATA_EXCEPTION);
        }

        const partitionId = this._nodeEngine.getPartitionService().getPartitionId(kd);
        const store = this._containerService.getOrCreateRecordStore(stmt.mapName, partitionId);
        store.put(kd, vd, -1, -1);

        return new SqlResult(new SqlRowMetadata([]), [], 1, queryId);
    }

    // ── UPDATE ────────────────────────────────────────────────────────────────

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
            if (!this._applyConditionTree(row, key, value, stmt.where)) continue;

            const updatedValue: Record<string, unknown> = typeof value === 'object' && value !== null
                ? { ...(value as Record<string, unknown>) }
                : {};

            for (const { column, value: newVal } of stmt.assignments) {
                if (column === '__key') continue;
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

        return new SqlResult(new SqlRowMetadata([]), [], updateCount, queryId);
    }

    // ── DELETE ────────────────────────────────────────────────────────────────

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
            if (!this._applyConditionTree(row, key, value, stmt.where)) continue;

            const partitionId = this._nodeEngine.getPartitionService().getPartitionId(kd);
            toDelete.push({ kd, partitionId });
        }

        for (const { kd, partitionId } of toDelete) {
            const store = this._containerService.getOrCreateRecordStore(stmt.mapName, partitionId);
            store.remove(kd);
            deleteCount++;
        }

        return new SqlResult(new SqlRowMetadata([]), [], deleteCount, queryId);
    }

    // ── Condition tree evaluation ─────────────────────────────────────────────

    /**
     * Evaluate the full condition tree (AND/OR nodes + leaf predicates).
     * Returns true if the row passes all conditions.
     */
    private _applyConditionTree(
        row: SqlRow,
        key: unknown,
        value: unknown,
        nodes: SqlConditionNode[],
    ): boolean {
        // No conditions → match all
        if (nodes.length === 0) return true;

        // Top-level is implicitly AND between all top-level nodes
        for (const node of nodes) {
            if (!this._evaluateNode(row, key, value, node)) return false;
        }
        return true;
    }

    private _evaluateNode(
        row: SqlRow,
        key: unknown,
        value: unknown,
        node: SqlConditionNode,
    ): boolean {
        if (isWhereGroup(node)) {
            switch (node.op) {
                case 'AND':
                    return node.clauses.every((c) => this._evaluateNode(row, key, value, c));
                case 'OR':
                    return node.clauses.some((c) => this._evaluateNode(row, key, value, c));
            }
        }
        return this._evaluateWhereClause(row, key, value, node as SqlWhereClause);
    }

    private _evaluateWhereClause(
        row: SqlRow,
        key: unknown,
        value: unknown,
        clause: SqlWhereClause,
    ): boolean {
        let colVal: unknown;
        if (clause.column === '__key') {
            colVal = key;
        } else if (typeof value === 'object' && value !== null) {
            colVal = (value as Record<string, unknown>)[clause.column] ?? row[clause.column];
        } else {
            colVal = row[clause.column];
        }

        switch (clause.operator) {
            case '=':
                return _equals(colVal, clause.value);
            case '!=':
                return !_equals(colVal, clause.value);
            case '<':
                return _compare(colVal, clause.value) < 0;
            case '<=':
                return _compare(colVal, clause.value) <= 0;
            case '>':
                return _compare(colVal, clause.value) > 0;
            case '>=':
                return _compare(colVal, clause.value) >= 0;
            case 'LIKE': {
                if (typeof colVal !== 'string' || typeof clause.value !== 'string') return false;
                return this._likeMatch(colVal, clause.value);
            }
            case 'IN': {
                const vals = clause.values ?? [clause.value];
                return vals.some((v) => _equals(colVal, v));
            }
            case 'BETWEEN': {
                const cmp1 = _compare(colVal, clause.value);
                const cmp2 = _compare(colVal, clause.value2);
                return cmp1 >= 0 && cmp2 <= 0;
            }
            case 'IS NULL':
                return colVal === null || colVal === undefined;
            case 'IS NOT NULL':
                return colVal !== null && colVal !== undefined;
        }
    }

    private _likeMatch(str: string, pattern: string): boolean {
        const regexStr = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/%/g, '.*')
            .replace(/_/g, '.');
        const regex = new RegExp(`^${regexStr}$`, 'i');
        return regex.test(str);
    }

    // ── DISTINCT ──────────────────────────────────────────────────────────────

    private _deduplicateRows(rows: SqlRow[]): SqlRow[] {
        const seen = new Set<string>();
        return rows.filter((row) => {
            const key = JSON.stringify(row, (_, v) =>
                typeof v === 'bigint' ? v.toString() : v,
            );
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    // ── Row building ──────────────────────────────────────────────────────────

    private _buildRow(key: unknown, value: unknown, columns: string[]): SqlRow {
        const row: SqlRow = {};

        if (columns.length === 1 && columns[0] === '*') {
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

    private _buildMetadata(selectItems: SelectItem[], sampleValue: unknown): SqlRowMetadata {
        // Wildcard
        if (selectItems.length === 1 && selectItems[0].expression === '*') {
            const cols: SqlColumnMetadata[] = [{ name: '__key', type: 'OBJECT', nullable: false }];
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

        const cols: SqlColumnMetadata[] = selectItems.map((item) => {
            if (typeof item.expression === 'string') {
                return {
                    name: item.alias ?? item.expression,
                    type: 'OBJECT' as SqlColumnType,
                    nullable: true,
                };
            }
            const agg = item.expression as AggregateCall;
            const name = item.alias ?? `${agg.function}(${agg.column})`;
            const type: SqlColumnType = agg.function === 'COUNT'
                ? 'BIGINT'
                : agg.function === 'AVG'
                    ? 'DOUBLE'
                    : 'OBJECT';
            return { name, type, nullable: true };
        });

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

    // ── Cleanup ───────────────────────────────────────────────────────────────

    private _cleanupQuery(query: ActiveQuery): void {
        if (query.timeoutTimer !== undefined) {
            clearTimeout(query.timeoutTimer);
        }
        this._activeQueries.delete(query.queryId);
    }
}
