/**
 * Port of {@code com.hazelcast.sql.SqlStatement}.
 *
 * Represents a parsed SQL statement with parameters and query metadata.
 *
 * Supports:
 * - SELECT … FROM <mapName> [WHERE <conditions>] [ORDER BY …] [LIMIT n]
 * - INSERT INTO <mapName> (keys) VALUES (values)
 * - UPDATE <mapName> SET col = val [WHERE …]
 * - DELETE FROM <mapName> [WHERE …]
 */

export type SqlStatementType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

export interface SqlWhereClause {
    readonly column: string;
    readonly operator: '=' | '!=' | '<' | '<=' | '>' | '>=' | 'LIKE' | 'IN' | 'BETWEEN' | 'IS NULL' | 'IS NOT NULL';
    readonly value: unknown;
    readonly value2?: unknown;  // used by BETWEEN
    readonly values?: unknown[];  // used by IN
}

export interface SqlOrderByClause {
    readonly column: string;
    readonly direction: 'ASC' | 'DESC';
}

export interface ParsedSelectStatement {
    readonly type: 'SELECT';
    readonly mapName: string;
    readonly columns: string[];  // ['*'] means all
    readonly where: SqlWhereClause[];
    readonly orderBy: SqlOrderByClause[];
    readonly limit: number | null;
    readonly offset: number | null;
}

export interface ParsedInsertStatement {
    readonly type: 'INSERT';
    readonly mapName: string;
    readonly columns: string[];
    readonly values: unknown[];
}

export interface ParsedUpdateStatement {
    readonly type: 'UPDATE';
    readonly mapName: string;
    readonly assignments: Array<{ column: string; value: unknown }>;
    readonly where: SqlWhereClause[];
}

export interface ParsedDeleteStatement {
    readonly type: 'DELETE';
    readonly mapName: string;
    readonly where: SqlWhereClause[];
}

export type ParsedStatement =
    | ParsedSelectStatement
    | ParsedInsertStatement
    | ParsedUpdateStatement
    | ParsedDeleteStatement;

export class SqlStatementParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SqlStatementParseError';
    }
}

export class SqlStatement {
    private readonly _sql: string;
    private readonly _params: unknown[];
    private _timeoutMillis = 0;
    private _cursorBufferSize = 4096;

    constructor(sql: string, params: unknown[] = []) {
        this._sql = sql;
        this._params = [...params];
    }

    getSql(): string { return this._sql; }
    getParameters(): unknown[] { return [...this._params]; }
    getTimeoutMillis(): number { return this._timeoutMillis; }
    getCursorBufferSize(): number { return this._cursorBufferSize; }

    setTimeoutMillis(ms: number): this {
        if (ms < 0) throw new RangeError('timeout must be >= 0');
        this._timeoutMillis = ms;
        return this;
    }

    setCursorBufferSize(size: number): this {
        if (size <= 0) throw new RangeError('cursorBufferSize must be > 0');
        this._cursorBufferSize = size;
        return this;
    }

    addParameter(value: unknown): this {
        this._params.push(value);
        return this;
    }

    /** Parse the SQL string into a structured AST for execution. */
    parse(): ParsedStatement {
        const sql = this._sql.trim();
        const upper = sql.toUpperCase();

        if (upper.startsWith('SELECT')) {
            return this._parseSelect(sql, upper);
        }
        if (upper.startsWith('INSERT')) {
            return this._parseInsert(sql, upper);
        }
        if (upper.startsWith('UPDATE')) {
            return this._parseUpdate(sql, upper);
        }
        if (upper.startsWith('DELETE')) {
            return this._parseDelete(sql, upper);
        }

        throw new SqlStatementParseError(`Unsupported SQL statement type: ${sql.substring(0, 20)}`);
    }

    private _parseSelect(sql: string, upper: string): ParsedSelectStatement {
        // SELECT <cols> FROM <map> [WHERE ...] [ORDER BY ...] [LIMIT n] [OFFSET n]
        const fromMatch = upper.indexOf('FROM');
        if (fromMatch === -1) throw new SqlStatementParseError('SELECT missing FROM clause');

        const colsPart = sql.substring(6, fromMatch).trim();
        const columns = colsPart === '*' ? ['*'] : colsPart.split(',').map((c) => c.trim());

        const afterFrom = sql.substring(fromMatch + 4).trim();
        const { mapName, remainder } = this._extractIdentifier(afterFrom);

        const where = this._parseWhere(remainder);
        const orderBy = this._parseOrderBy(remainder);
        const limit = this._parseLimit(remainder);
        const offset = this._parseOffset(remainder);

        return { type: 'SELECT', mapName, columns, where, orderBy, limit, offset };
    }

    private _parseInsert(sql: string, upper: string): ParsedInsertStatement {
        // INSERT INTO <map> (col1, col2) VALUES (v1, v2)
        const intoIdx = upper.indexOf('INTO');
        if (intoIdx === -1) throw new SqlStatementParseError('INSERT missing INTO');
        const afterInto = sql.substring(intoIdx + 4).trim();
        const { mapName, remainder } = this._extractIdentifier(afterInto);

        const colStart = remainder.indexOf('(');
        const colEnd = remainder.indexOf(')');
        if (colStart === -1 || colEnd === -1) throw new SqlStatementParseError('INSERT missing column list');
        const columns = remainder.substring(colStart + 1, colEnd).split(',').map((c) => c.trim());

        const valIdx = remainder.toUpperCase().indexOf('VALUES');
        if (valIdx === -1) throw new SqlStatementParseError('INSERT missing VALUES');
        const valPart = remainder.substring(valIdx + 6).trim();
        const valStart = valPart.indexOf('(');
        const valEnd = valPart.lastIndexOf(')');
        if (valStart === -1 || valEnd === -1) throw new SqlStatementParseError('INSERT missing value list');
        const values = this._parseValueList(valPart.substring(valStart + 1, valEnd));

        return { type: 'INSERT', mapName, columns, values };
    }

    private _parseUpdate(sql: string, upper: string): ParsedUpdateStatement {
        // UPDATE <map> SET col = val [, col = val] [WHERE ...]
        const setIdx = upper.indexOf('SET');
        if (setIdx === -1) throw new SqlStatementParseError('UPDATE missing SET');
        const mapName = sql.substring(6, setIdx).trim();
        const afterSet = sql.substring(setIdx + 3).trim();

        const whereIdx = afterSet.toUpperCase().indexOf('WHERE');
        const assignmentStr = whereIdx === -1 ? afterSet : afterSet.substring(0, whereIdx).trim();
        const remainder = whereIdx === -1 ? '' : afterSet.substring(whereIdx);

        const assignments = assignmentStr.split(',').map((pair) => {
            const [col, ...rest] = pair.split('=');
            return { column: col.trim(), value: this._parseValue(rest.join('=').trim()) };
        });

        const where = this._parseWhere(remainder);
        return { type: 'UPDATE', mapName: mapName.trim(), assignments, where };
    }

    private _parseDelete(sql: string, upper: string): ParsedDeleteStatement {
        // DELETE FROM <map> [WHERE ...]
        const fromIdx = upper.indexOf('FROM');
        if (fromIdx === -1) throw new SqlStatementParseError('DELETE missing FROM');
        const afterFrom = sql.substring(fromIdx + 4).trim();
        const { mapName, remainder } = this._extractIdentifier(afterFrom);
        const where = this._parseWhere(remainder);
        return { type: 'DELETE', mapName, where };
    }

    private _extractIdentifier(str: string): { mapName: string; remainder: string } {
        // Handles quoted identifiers and stops at whitespace/parenthesis
        const match = str.match(/^`?([^`\s(,]+)`?\s*(.*)/s);
        if (!match) throw new SqlStatementParseError(`Cannot extract identifier from: ${str}`);
        return { mapName: match[1].trim(), remainder: match[2].trim() };
    }

    private _parseWhere(sql: string): SqlWhereClause[] {
        const upper = sql.toUpperCase();
        const whereIdx = upper.indexOf('WHERE');
        if (whereIdx === -1) return [];

        // Extract WHERE clause (stop at ORDER BY / LIMIT / OFFSET)
        const afterWhere = sql.substring(whereIdx + 5).trim();
        const stopKeywords = ['ORDER BY', 'LIMIT', 'OFFSET'];
        let clauseEnd = afterWhere.length;
        for (const kw of stopKeywords) {
            const idx = afterWhere.toUpperCase().indexOf(kw);
            if (idx !== -1 && idx < clauseEnd) clauseEnd = idx;
        }
        const clauseStr = afterWhere.substring(0, clauseEnd).trim();

        // Split by AND (simple parser; no nested OR support)
        const parts = clauseStr.split(/\bAND\b/i);
        const clauses: SqlWhereClause[] = [];

        for (const part of parts) {
            const clause = this._parseWhereClause(part.trim());
            if (clause) clauses.push(clause);
        }

        return clauses;
    }

    private _parseWhereClause(part: string): SqlWhereClause | null {
        // Patterns: col = val, col != val, col < val, col <= val, col > val, col >= val
        //           col LIKE val, col IN (v1, v2), col BETWEEN v1 AND v2
        //           col IS NULL, col IS NOT NULL
        const isNullMatch = part.match(/^(\w+)\s+IS\s+NULL$/i);
        if (isNullMatch) {
            return { column: isNullMatch[1], operator: 'IS NULL', value: null };
        }
        const isNotNullMatch = part.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i);
        if (isNotNullMatch) {
            return { column: isNotNullMatch[1], operator: 'IS NOT NULL', value: null };
        }
        const betweenMatch = part.match(/^(\w+)\s+BETWEEN\s+(.+)\s+AND\s+(.+)$/i);
        if (betweenMatch) {
            return {
                column: betweenMatch[1],
                operator: 'BETWEEN',
                value: this._parseValue(betweenMatch[2].trim()),
                value2: this._parseValue(betweenMatch[3].trim()),
            };
        }
        const inMatch = part.match(/^(\w+)\s+IN\s*\((.+)\)$/i);
        if (inMatch) {
            const vals = this._parseValueList(inMatch[2]);
            return { column: inMatch[1], operator: 'IN', value: vals[0] ?? null, values: vals };
        }
        const likeMatch = part.match(/^(\w+)\s+LIKE\s+(.+)$/i);
        if (likeMatch) {
            return { column: likeMatch[1], operator: 'LIKE', value: this._parseValue(likeMatch[2].trim()) };
        }
        const opMatch = part.match(/^(\w+)\s*(!=|<=|>=|<>|=|<|>)\s*(.+)$/);
        if (opMatch) {
            const op = opMatch[2] === '<>' ? '!=' : opMatch[2] as SqlWhereClause['operator'];
            return { column: opMatch[1], operator: op, value: this._parseValue(opMatch[3].trim()) };
        }
        return null;
    }

    private _parseOrderBy(sql: string): SqlOrderByClause[] {
        const upper = sql.toUpperCase();
        const orderIdx = upper.indexOf('ORDER BY');
        if (orderIdx === -1) return [];
        const afterOrderBy = sql.substring(orderIdx + 8).trim();
        const stopKeywords = ['LIMIT', 'OFFSET'];
        let clauseEnd = afterOrderBy.length;
        for (const kw of stopKeywords) {
            const idx = afterOrderBy.toUpperCase().indexOf(kw);
            if (idx !== -1 && idx < clauseEnd) clauseEnd = idx;
        }
        const clauseStr = afterOrderBy.substring(0, clauseEnd).trim();
        return clauseStr.split(',').map((col) => {
            const parts = col.trim().split(/\s+/);
            const direction = parts[1]?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
            return { column: parts[0].trim(), direction };
        });
    }

    private _parseLimit(sql: string): number | null {
        const match = sql.match(/\bLIMIT\s+(\d+)/i);
        return match ? parseInt(match[1], 10) : null;
    }

    private _parseOffset(sql: string): number | null {
        const match = sql.match(/\bOFFSET\s+(\d+)/i);
        return match ? parseInt(match[1], 10) : null;
    }

    private _parseValueList(str: string): unknown[] {
        // Simple comma-split respecting quoted strings
        const values: unknown[] = [];
        let current = '';
        let inString = false;
        let quoteChar = '';
        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            if (inString) {
                if (ch === quoteChar) { inString = false; current += ch; }
                else { current += ch; }
            } else if (ch === '"' || ch === "'") {
                inString = true;
                quoteChar = ch;
                current += ch;
            } else if (ch === ',') {
                values.push(this._parseValue(current.trim()));
                current = '';
            } else {
                current += ch;
            }
        }
        if (current.trim()) values.push(this._parseValue(current.trim()));
        return values;
    }

    private _parseValue(str: string): unknown {
        const trimmed = str.trim();
        // Positional parameter placeholder ?
        if (trimmed === '?') {
            return this._params.shift() ?? null;
        }
        // null literal
        if (trimmed.toUpperCase() === 'NULL') return null;
        // Boolean
        if (trimmed.toUpperCase() === 'TRUE') return true;
        if (trimmed.toUpperCase() === 'FALSE') return false;
        // Quoted string
        if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
            (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
            return trimmed.slice(1, -1);
        }
        // Number
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            return trimmed.includes('.') ? parseFloat(trimmed) : parseInt(trimmed, 10);
        }
        return trimmed;
    }
}
