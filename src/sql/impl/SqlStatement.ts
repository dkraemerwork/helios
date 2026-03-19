/**
 * Port of {@code com.hazelcast.sql.SqlStatement}.
 *
 * Represents a parsed SQL statement with parameters and query metadata.
 *
 * Supports:
 * - SELECT … FROM <mapName> [WHERE <conditions>] [GROUP BY …] [HAVING …] [ORDER BY …] [LIMIT n] [OFFSET n]
 * - INSERT INTO <mapName> (keys) VALUES (values)
 * - UPDATE <mapName> SET col = val [WHERE …]
 * - DELETE FROM <mapName> [WHERE …]
 * - CREATE MAPPING [IF NOT EXISTS] <mapName> [EXTERNAL NAME …] TYPE IMap [(cols)] [OPTIONS (…)]
 * - DROP MAPPING [IF EXISTS] <mapName>
 */
import type { SqlColumnType } from '@zenystx/helios-core/sql/impl/SqlRowMetadata.js';

export type SqlStatementType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE_MAPPING' | 'DROP_MAPPING';

// ── WHERE / HAVING condition node ───────────────────────────────────────────

export type SqlConditionOperator =
    | '=' | '!=' | '<' | '<=' | '>' | '>='
    | 'LIKE' | 'IN' | 'BETWEEN' | 'IS NULL' | 'IS NOT NULL';

export type SqlLogicalOp = 'AND' | 'OR';

/** A single predicate leaf (col op value). */
export interface SqlWhereClause {
    readonly column: string;
    readonly operator: SqlConditionOperator;
    readonly value: unknown;
    readonly value2?: unknown;     // used by BETWEEN
    readonly values?: unknown[];   // used by IN
}

/** A group of predicates joined by the same logical operator. */
export interface SqlWhereGroup {
    readonly op: SqlLogicalOp;
    readonly clauses: SqlConditionNode[];
}

/** A condition tree node — either a leaf predicate or a logical group. */
export type SqlConditionNode = SqlWhereClause | SqlWhereGroup;

export function isWhereGroup(node: SqlConditionNode): node is SqlWhereGroup {
    return 'op' in node && 'clauses' in node;
}

// ── ORDER BY ────────────────────────────────────────────────────────────────

export interface SqlOrderByClause {
    readonly column: string;
    readonly direction: 'ASC' | 'DESC';
}

// ── SELECT items ─────────────────────────────────────────────────────────────

export interface AggregateCall {
    readonly function: string;      // COUNT | SUM | AVG | MIN | MAX
    readonly column: string | '*';  // column name or '*' for COUNT(*)
    readonly distinct?: boolean;
}

export interface SelectItem {
    /** Either a column/expression string or an aggregate call descriptor. */
    readonly expression: string | AggregateCall;
    readonly alias?: string;
}

// ── Statement interfaces ─────────────────────────────────────────────────────

export interface ParsedSelectStatement {
    readonly type: 'SELECT';
    readonly mapName: string;
    /** Legacy flat column list — still populated for simple non-aggregate queries. */
    readonly columns: string[];
    /** Rich select item list (populated for all queries). */
    readonly selectItems: SelectItem[];
    readonly distinct: boolean;
    readonly where: SqlConditionNode[];
    readonly groupBy: string[];
    readonly having: SqlConditionNode[];
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
    readonly where: SqlConditionNode[];
}

export interface ParsedDeleteStatement {
    readonly type: 'DELETE';
    readonly mapName: string;
    readonly where: SqlConditionNode[];
}

export interface MappingColumnDef {
    readonly name: string;
    readonly type: SqlColumnType;
    readonly externalName?: string;
}

export interface ParsedCreateMappingStatement {
    readonly type: 'CREATE_MAPPING';
    readonly mappingName: string;
    readonly externalName?: string;
    readonly ifNotExists: boolean;
    readonly mappingType: string;
    readonly columns: MappingColumnDef[];
    readonly options: Record<string, string>;
}

export interface ParsedDropMappingStatement {
    readonly type: 'DROP_MAPPING';
    readonly mappingName: string;
    readonly ifExists: boolean;
}

export type ParsedStatement =
    | ParsedSelectStatement
    | ParsedInsertStatement
    | ParsedUpdateStatement
    | ParsedDeleteStatement
    | ParsedCreateMappingStatement
    | ParsedDropMappingStatement;

// ── Error ────────────────────────────────────────────────────────────────────

export class SqlStatementParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SqlStatementParseError';
    }
}

// ── SQL column type names (for mapping parser) ───────────────────────────────

const SQL_TYPE_NAMES: Record<string, SqlColumnType> = {
    VARCHAR: 'VARCHAR',
    BOOLEAN: 'BOOLEAN',
    TINYINT: 'TINYINT',
    SMALLINT: 'SMALLINT',
    INTEGER: 'INTEGER',
    INT: 'INTEGER',
    BIGINT: 'BIGINT',
    DECIMAL: 'DECIMAL',
    NUMERIC: 'DECIMAL',
    REAL: 'REAL',
    FLOAT: 'REAL',
    DOUBLE: 'DOUBLE',
    DATE: 'DATE',
    TIME: 'TIME',
    TIMESTAMP: 'TIMESTAMP',
    OBJECT: 'OBJECT',
};

// ── Main class ───────────────────────────────────────────────────────────────

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
        if (upper.startsWith('CREATE')) {
            return this._parseCreate(sql, upper);
        }
        if (upper.startsWith('DROP')) {
            return this._parseDrop(sql, upper);
        }

        throw new SqlStatementParseError(`Unsupported SQL statement type: ${sql.substring(0, 20)}`);
    }

    // ── SELECT ───────────────────────────────────────────────────────────────

    private _parseSelect(sql: string, upper: string): ParsedSelectStatement {
        // SELECT [DISTINCT] <cols> FROM <map> [WHERE ...] [GROUP BY ...] [HAVING ...] [ORDER BY ...] [LIMIT n] [OFFSET n]
        const fromIdx = upper.indexOf('FROM');
        if (fromIdx === -1) throw new SqlStatementParseError('SELECT missing FROM clause');

        let colsPart = sql.substring(6, fromIdx).trim();
        let distinct = false;
        if (colsPart.toUpperCase().startsWith('DISTINCT')) {
            distinct = true;
            colsPart = colsPart.substring(8).trim();
        }

        const afterFrom = sql.substring(fromIdx + 4).trim();
        const { mapName, remainder } = this._extractIdentifier(afterFrom);

        const where = this._parseConditions(remainder, 'WHERE');
        const groupBy = this._parseGroupBy(remainder);
        const having = this._parseConditions(remainder, 'HAVING');
        const orderBy = this._parseOrderBy(remainder);
        const limit = this._parseLimit(remainder);
        const offset = this._parseOffset(remainder);

        // Parse select items (handles aggregates, functions, aliases)
        const selectItems = this._parseSelectItems(colsPart);

        // Build flat column list for backwards compatibility
        const columns = this._buildLegacyColumns(colsPart, selectItems);

        return {
            type: 'SELECT',
            mapName,
            columns,
            selectItems,
            distinct,
            where,
            groupBy,
            having,
            orderBy,
            limit,
            offset,
        };
    }

    private _parseSelectItems(colsPart: string): SelectItem[] {
        if (colsPart.trim() === '*') {
            return [{ expression: '*' }];
        }

        const parts = this._splitTopLevel(colsPart, ',');
        const items: SelectItem[] = [];

        for (const part of parts) {
            items.push(this._parseSelectItem(part.trim()));
        }

        return items;
    }

    private _parseSelectItem(expr: string): SelectItem {
        // Check for alias: expr AS alias  or  expr alias
        const asMatch = expr.match(/^(.+?)\s+AS\s+(\w+)$/i);
        if (asMatch) {
            return {
                expression: this._parseExpressionToken(asMatch[1].trim()),
                alias: asMatch[2].trim(),
            };
        }

        // Trailing bare identifier could be alias (e.g., "col myAlias"), but ambiguous.
        // Only treat as alias if there's whitespace + a simple word after a non-function expression.
        const bareAliasMatch = expr.match(/^([^(]+?)\s+(\w+)$/);
        if (bareAliasMatch && !bareAliasMatch[1].trim().toUpperCase().match(/\bFROM\b/)) {
            const candidate = bareAliasMatch[1].trim();
            const alias = bareAliasMatch[2].trim();
            // Only if candidate doesn't look like a function call without parens
            if (!candidate.includes('(') && candidate.split(/\s+/).length === 1) {
                return { expression: candidate, alias };
            }
        }

        return { expression: this._parseExpressionToken(expr.trim()) };
    }

    private _parseExpressionToken(token: string): string | AggregateCall {

        // Aggregate functions: COUNT(*), COUNT(DISTINCT col), SUM(col), AVG(col), MIN(col), MAX(col)
        const aggMatch = token.match(/^(COUNT|SUM|AVG|MIN|MAX)\s*\((.+)\)$/i);
        if (aggMatch) {
            const fn = aggMatch[1].toUpperCase();
            let inner = aggMatch[2].trim();
            let distinct = false;

            if (inner.toUpperCase().startsWith('DISTINCT ')) {
                distinct = true;
                inner = inner.substring(9).trim();
            }

            return { function: fn, column: inner, distinct } as AggregateCall;
        }

        // Everything else is treated as a string expression
        return token;
    }

    private _buildLegacyColumns(colsPart: string, items: SelectItem[]): string[] {
        if (colsPart.trim() === '*') return ['*'];

        return items.map((item) => {
            if (item.alias) return item.alias;
            if (typeof item.expression === 'string') return item.expression;
            // aggregate — use "function(column)" as name
            const agg = item.expression as AggregateCall;
            return `${agg.function}(${agg.column})`;
        });
    }

    // ── INSERT ───────────────────────────────────────────────────────────────

    private _parseInsert(sql: string, upper: string): ParsedInsertStatement {
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

    // ── UPDATE ───────────────────────────────────────────────────────────────

    private _parseUpdate(sql: string, upper: string): ParsedUpdateStatement {
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

        const where = this._parseConditions(remainder, 'WHERE');
        return { type: 'UPDATE', mapName: mapName.trim(), assignments, where };
    }

    // ── DELETE ───────────────────────────────────────────────────────────────

    private _parseDelete(sql: string, upper: string): ParsedDeleteStatement {
        const fromIdx = upper.indexOf('FROM');
        if (fromIdx === -1) throw new SqlStatementParseError('DELETE missing FROM');
        const afterFrom = sql.substring(fromIdx + 4).trim();
        const { mapName, remainder } = this._extractIdentifier(afterFrom);
        const where = this._parseConditions(remainder, 'WHERE');
        return { type: 'DELETE', mapName, where };
    }

    // ── CREATE MAPPING ───────────────────────────────────────────────────────

    private _parseCreate(sql: string, upper: string): ParsedCreateMappingStatement {
        // CREATE MAPPING [IF NOT EXISTS] mapName [EXTERNAL NAME extName]
        //   TYPE IMap
        //   [(col type [EXTERNAL NAME ext], ...)]
        //   [OPTIONS ('k'='v', ...)]

        let rest = sql.substring(6).trim();          // after CREATE
        let restUpper = rest.toUpperCase();

        if (!restUpper.startsWith('MAPPING')) {
            throw new SqlStatementParseError(`Unsupported CREATE statement: ${sql.substring(0, 30)}`);
        }
        rest = rest.substring(7).trim();
        restUpper = rest.toUpperCase();

        let ifNotExists = false;
        if (restUpper.startsWith('IF NOT EXISTS')) {
            ifNotExists = true;
            rest = rest.substring(13).trim();
            restUpper = rest.toUpperCase();
        }

        // mapping name
        const { mapName: mappingName, remainder: afterName } = this._extractIdentifier(rest);
        rest = afterName;
        restUpper = rest.toUpperCase();

        // optional EXTERNAL NAME
        let externalName: string | undefined;
        if (restUpper.startsWith('EXTERNAL NAME')) {
            rest = rest.substring(13).trim();
            restUpper = rest.toUpperCase();
            const { mapName: extName, remainder: afterExt } = this._extractIdentifier(rest);
            externalName = extName;
            rest = afterExt;
            restUpper = rest.toUpperCase();
        }

        // TYPE
        if (!restUpper.startsWith('TYPE')) {
            throw new SqlStatementParseError('CREATE MAPPING missing TYPE clause');
        }
        rest = rest.substring(4).trim();
        const { mapName: mappingType, remainder: afterType } = this._extractIdentifier(rest);
        rest = afterType;
        restUpper = rest.toUpperCase();

        // optional column list
        const columns: MappingColumnDef[] = [];
        if (rest.startsWith('(')) {
            const closeIdx = this._findMatchingParen(rest, 0);
            if (closeIdx === -1) throw new SqlStatementParseError('CREATE MAPPING unclosed column list');
            const colListStr = rest.substring(1, closeIdx);
            rest = rest.substring(closeIdx + 1).trim();
            restUpper = rest.toUpperCase();
            this._parseMappingColumns(colListStr, columns);
        }

        // optional OPTIONS
        const options: Record<string, string> = {};
        if (restUpper.startsWith('OPTIONS')) {
            rest = rest.substring(7).trim();
            if (rest.startsWith('(')) {
                const closeIdx = this._findMatchingParen(rest, 0);
                const optStr = rest.substring(1, closeIdx);
                this._parseMappingOptions(optStr, options);
            }
        }

        return {
            type: 'CREATE_MAPPING',
            mappingName,
            externalName,
            ifNotExists,
            mappingType: mappingType.toUpperCase(),
            columns,
            options,
        };
    }

    private _parseMappingColumns(str: string, out: MappingColumnDef[]): void {
        const parts = this._splitTopLevel(str, ',');
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            // name type [EXTERNAL NAME extName]
            const tokens = trimmed.split(/\s+/);
            if (tokens.length < 2) throw new SqlStatementParseError(`Invalid column definition: ${trimmed}`);

            const name = tokens[0];
            const typeStr = tokens[1].toUpperCase();
            const colType = SQL_TYPE_NAMES[typeStr];
            if (!colType) throw new SqlStatementParseError(`Unknown SQL type: ${typeStr}`);

            let externalName: string | undefined;
            const extIdx = trimmed.toUpperCase().indexOf('EXTERNAL NAME');
            if (extIdx !== -1) {
                externalName = trimmed.substring(extIdx + 13).trim().replace(/^`|`$/g, '');
            }

            out.push({ name, type: colType, externalName });
        }
    }

    private _parseMappingOptions(str: string, out: Record<string, string>): void {
        const parts = this._splitTopLevel(str, ',');
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) continue;
            const key = trimmed.substring(0, eqIdx).trim().replace(/^['"]|['"]$/g, '');
            const val = trimmed.substring(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
            out[key] = val;
        }
    }

    // ── DROP MAPPING ─────────────────────────────────────────────────────────

    private _parseDrop(sql: string, upper: string): ParsedDropMappingStatement {
        let rest = sql.substring(4).trim();
        let restUpper = rest.toUpperCase();

        if (!restUpper.startsWith('MAPPING')) {
            throw new SqlStatementParseError(`Unsupported DROP statement: ${sql.substring(0, 30)}`);
        }
        rest = rest.substring(7).trim();
        restUpper = rest.toUpperCase();

        let ifExists = false;
        if (restUpper.startsWith('IF EXISTS')) {
            ifExists = true;
            rest = rest.substring(9).trim();
        }

        const { mapName: mappingName } = this._extractIdentifier(rest);
        return { type: 'DROP_MAPPING', mappingName, ifExists };
    }

    // ── WHERE / HAVING (full OR/AND tree) ────────────────────────────────────

    private _parseConditions(sql: string, keyword: 'WHERE' | 'HAVING'): SqlConditionNode[] {
        const upper = sql.toUpperCase();
        const kwIdx = upper.indexOf(keyword);
        if (kwIdx === -1) return [];

        const afterKw = sql.substring(kwIdx + keyword.length).trim();

        // Determine end: stop at known clause keywords
        const stopKeywords =
            keyword === 'WHERE'
                ? ['GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET']
                : ['ORDER BY', 'LIMIT', 'OFFSET'];

        let clauseEnd = afterKw.length;
        for (const kw of stopKeywords) {
            const idx = afterKw.toUpperCase().indexOf(kw);
            if (idx !== -1 && idx < clauseEnd) clauseEnd = idx;
        }

        const clauseStr = afterKw.substring(0, clauseEnd).trim();
        return this._parseConditionTree(clauseStr);
    }

    /**
     * Parse a WHERE/HAVING clause string into a tree of SqlConditionNode.
     * Supports AND / OR with standard SQL precedence (AND binds tighter than OR).
     */
    private _parseConditionTree(str: string): SqlConditionNode[] {
        if (!str) return [];

        // Split by OR first (lowest precedence), preserving parenthesised groups
        const orParts = this._splitByLogicalOp(str, 'OR');
        if (orParts.length > 1) {
            const children: SqlConditionNode[] = orParts.flatMap((part) =>
                this._parseAndGroup(part.trim()),
            );
            return [{ op: 'OR', clauses: children }];
        }

        return this._parseAndGroup(str);
    }

    private _parseAndGroup(str: string): SqlConditionNode[] {
        const andParts = this._splitByLogicalOp(str, 'AND');
        if (andParts.length === 1) {
            const clause = this._parseSingleClause(andParts[0].trim());
            return clause ? [clause] : [];
        }
        const children: SqlConditionNode[] = andParts.flatMap((part) => {
            const clause = this._parseSingleClause(part.trim());
            return clause ? [clause] : [];
        });
        return [{ op: 'AND', clauses: children }];
    }

    /**
     * Split a condition string by AND or OR at the top level
     * (not inside parentheses or quoted strings).
     */
    private _splitByLogicalOp(str: string, op: 'AND' | 'OR'): string[] {
        const parts: string[] = [];
        let current = '';
        let depth = 0;
        let inString = false;
        let quoteChar = '';
        let i = 0;

        while (i < str.length) {
            const ch = str[i];

            if (inString) {
                if (ch === quoteChar) inString = false;
                current += ch;
                i++;
                continue;
            }

            if (ch === "'" || ch === '"') {
                inString = true;
                quoteChar = ch;
                current += ch;
                i++;
                continue;
            }

            if (ch === '(') { depth++; current += ch; i++; continue; }
            if (ch === ')') { depth--; current += ch; i++; continue; }

            if (depth === 0) {
                const remaining = str.substring(i).toUpperCase();
                if (remaining.startsWith(op) && /^\W/.test(str[i + op.length] ?? ' ')) {
                    parts.push(current);
                    current = '';
                    i += op.length;
                    // skip spaces
                    while (i < str.length && str[i] === ' ') i++;
                    continue;
                }
            }

            current += ch;
            i++;
        }

        parts.push(current);
        return parts;
    }

    private _parseSingleClause(part: string): SqlConditionNode | null {
        const trimmed = part.trim();
        if (!trimmed) return null;

        // Parenthesised sub-expression
        if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
            const inner = trimmed.slice(1, -1).trim();
            const children = this._parseConditionTree(inner);
            if (children.length === 1) return children[0];
            return { op: 'AND', clauses: children };
        }

        return this._parseWhereClause(trimmed);
    }

    private _parseWhereClause(part: string): SqlWhereClause | null {
        const isNullMatch = part.match(/^(\w+)\s+IS\s+NULL$/i);
        if (isNullMatch) {
            return { column: isNullMatch[1], operator: 'IS NULL', value: null };
        }
        const isNotNullMatch = part.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i);
        if (isNotNullMatch) {
            return { column: isNotNullMatch[1], operator: 'IS NOT NULL', value: null };
        }
        const betweenMatch = part.match(/^(\w+)\s+BETWEEN\s+(.+?)\s+AND\s+(.+)$/i);
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
            const op = opMatch[2] === '<>' ? '!=' : (opMatch[2] as SqlConditionOperator);
            return { column: opMatch[1], operator: op, value: this._parseValue(opMatch[3].trim()) };
        }
        return null;
    }

    // ── GROUP BY ─────────────────────────────────────────────────────────────

    private _parseGroupBy(sql: string): string[] {
        const upper = sql.toUpperCase();
        const gbIdx = upper.indexOf('GROUP BY');
        if (gbIdx === -1) return [];
        const afterGb = sql.substring(gbIdx + 8).trim();

        const stopKeywords = ['HAVING', 'ORDER BY', 'LIMIT', 'OFFSET'];
        let clauseEnd = afterGb.length;
        for (const kw of stopKeywords) {
            const idx = afterGb.toUpperCase().indexOf(kw);
            if (idx !== -1 && idx < clauseEnd) clauseEnd = idx;
        }
        const clauseStr = afterGb.substring(0, clauseEnd).trim();
        return clauseStr.split(',').map((c) => c.trim()).filter(Boolean);
    }

    // ── ORDER BY ─────────────────────────────────────────────────────────────

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

    // ── Identifier extraction ─────────────────────────────────────────────────

    private _extractIdentifier(str: string): { mapName: string; remainder: string } {
        const match = str.match(/^`?([^`\s(,]+)`?\s*(.*)/s);
        if (!match) throw new SqlStatementParseError(`Cannot extract identifier from: ${str}`);
        return { mapName: match[1].trim(), remainder: match[2].trim() };
    }

    // ── Value parsing ─────────────────────────────────────────────────────────

    private _parseValueList(str: string): unknown[] {
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
        if (trimmed === '?') {
            return this._params.shift() ?? null;
        }
        if (trimmed.toUpperCase() === 'NULL') return null;
        if (trimmed.toUpperCase() === 'TRUE') return true;
        if (trimmed.toUpperCase() === 'FALSE') return false;
        if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
            (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
            return trimmed.slice(1, -1);
        }
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            return trimmed.includes('.') ? parseFloat(trimmed) : parseInt(trimmed, 10);
        }
        return trimmed;
    }

    // ── Utility: split by comma at top level (not inside parens/quotes) ───────

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

    /** Find the matching closing paren starting at `openIdx` in `str`. */
    private _findMatchingParen(str: string, openIdx: number): number {
        let depth = 0;
        for (let i = openIdx; i < str.length; i++) {
            if (str[i] === '(') depth++;
            else if (str[i] === ')') {
                depth--;
                if (depth === 0) return i;
            }
        }
        return -1;
    }
}
