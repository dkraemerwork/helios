/**
 * SQL Expression Engine.
 *
 * Each Expression evaluates against a row context — the full row record plus
 * the raw key and value (for __key / this access).
 */
import type { SqlColumnType } from '@zenystx/helios-core/sql/impl/SqlRowMetadata.js';
import type { SqlRow } from '@zenystx/helios-core/sql/impl/SqlResult.js';
import { sqlTypeSystem } from '@zenystx/helios-core/sql/impl/SqlTypeSystem.js';

// ── Base interface ──────────────────────────────────────────────────────────

export interface Expression {
    evaluate(row: SqlRow, key: unknown, value: unknown): unknown;
}

// ── Column / literal ────────────────────────────────────────────────────────

export class ColumnExpression implements Expression {
    constructor(public readonly columnName: string) {}

    evaluate(row: SqlRow, key: unknown, value: unknown): unknown {
        if (this.columnName === '__key') return key;
        if (this.columnName === 'this') return value;
        return row[this.columnName] ?? null;
    }
}

export class LiteralExpression implements Expression {
    constructor(public readonly literalValue: unknown) {}

    evaluate(_row: SqlRow, _key: unknown, _value: unknown): unknown {
        return this.literalValue;
    }
}

// ── Arithmetic ──────────────────────────────────────────────────────────────

export type ArithmeticOp = '+' | '-' | '*' | '/' | '%';

export class ArithmeticExpression implements Expression {
    constructor(
        public readonly op: ArithmeticOp,
        public readonly left: Expression,
        public readonly right: Expression,
    ) {}

    evaluate(row: SqlRow, key: unknown, value: unknown): unknown {
        const l = this._toNum(this.left.evaluate(row, key, value));
        const r = this._toNum(this.right.evaluate(row, key, value));
        if (l === null || r === null) return null;

        switch (this.op) {
            case '+': return l + r;
            case '-': return l - r;
            case '*': return l * r;
            case '/': return r === 0 ? null : l / r;
            case '%': return r === 0 ? null : l % r;
        }
    }

    private _toNum(v: unknown): number | null {
        if (v === null || v === undefined) return null;
        const n = Number(v);
        return isNaN(n) ? null : n;
    }
}

// ── Comparison ──────────────────────────────────────────────────────────────

export type ComparisonOp = '=' | '<>' | '<' | '>' | '<=' | '>=';

export class ComparisonExpression implements Expression {
    constructor(
        public readonly op: ComparisonOp,
        public readonly left: Expression,
        public readonly right: Expression,
    ) {}

    evaluate(row: SqlRow, key: unknown, value: unknown): unknown {
        const l = this.left.evaluate(row, key, value);
        const r = this.right.evaluate(row, key, value);

        switch (this.op) {
            case '=': return _equals(l, r);
            case '<>': return !_equals(l, r);
            case '<': return _compare(l, r) < 0;
            case '>': return _compare(l, r) > 0;
            case '<=': return _compare(l, r) <= 0;
            case '>=': return _compare(l, r) >= 0;
        }
    }
}

// ── Logical ─────────────────────────────────────────────────────────────────

export type LogicalOp = 'AND' | 'OR' | 'NOT';

export class LogicalExpression implements Expression {
    constructor(
        public readonly op: LogicalOp,
        public readonly operands: Expression[],
    ) {}

    evaluate(row: SqlRow, key: unknown, value: unknown): unknown {
        switch (this.op) {
            case 'AND':
                return this.operands.every((e) => !!e.evaluate(row, key, value));
            case 'OR':
                return this.operands.some((e) => !!e.evaluate(row, key, value));
            case 'NOT':
                return !this.operands[0]?.evaluate(row, key, value);
        }
    }
}

// ── CAST ─────────────────────────────────────────────────────────────────────

export class CastExpression implements Expression {
    constructor(
        public readonly expression: Expression,
        public readonly targetType: SqlColumnType,
    ) {}

    evaluate(row: SqlRow, key: unknown, value: unknown): unknown {
        const v = this.expression.evaluate(row, key, value);
        if (v === null || v === undefined) return null;
        return sqlTypeSystem.coerce(v, this.targetType);
    }
}

// ── CASE WHEN ────────────────────────────────────────────────────────────────

export interface WhenClause {
    readonly condition: Expression;
    readonly result: Expression;
}

export class CaseExpression implements Expression {
    constructor(
        public readonly whenClauses: WhenClause[],
        public readonly elseResult: Expression | null,
    ) {}

    evaluate(row: SqlRow, key: unknown, value: unknown): unknown {
        for (const { condition, result } of this.whenClauses) {
            if (condition.evaluate(row, key, value)) {
                return result.evaluate(row, key, value);
            }
        }
        return this.elseResult?.evaluate(row, key, value) ?? null;
    }
}

// ── Functions ─────────────────────────────────────────────────────────────────

export type SqlFunctionName =
    | 'UPPER' | 'LOWER' | 'TRIM' | 'LTRIM' | 'RTRIM' | 'LENGTH'
    | 'ABS' | 'FLOOR' | 'CEIL' | 'CEILING' | 'ROUND'
    | 'CONCAT' | 'SUBSTRING' | 'COALESCE' | 'NULLIF'
    | 'MOD' | 'POWER' | 'SQRT' | 'SIGN'
    | 'TO_CHAR' | 'TO_NUMBER';

export class FunctionExpression implements Expression {
    constructor(
        public readonly name: SqlFunctionName,
        public readonly args: Expression[],
    ) {}

    evaluate(row: SqlRow, key: unknown, value: unknown): unknown {
        const argv = this.args.map((a) => a.evaluate(row, key, value));

        switch (this.name) {
            case 'UPPER':
                return argv[0] === null || argv[0] === undefined ? null : String(argv[0]).toUpperCase();

            case 'LOWER':
                return argv[0] === null || argv[0] === undefined ? null : String(argv[0]).toLowerCase();

            case 'TRIM':
                return argv[0] === null || argv[0] === undefined ? null : String(argv[0]).trim();

            case 'LTRIM':
                return argv[0] === null || argv[0] === undefined ? null : String(argv[0]).trimStart();

            case 'RTRIM':
                return argv[0] === null || argv[0] === undefined ? null : String(argv[0]).trimEnd();

            case 'LENGTH':
                return argv[0] === null || argv[0] === undefined ? null : String(argv[0]).length;

            case 'ABS': {
                const n = this._num(argv[0]);
                return n === null ? null : Math.abs(n);
            }

            case 'FLOOR': {
                const n = this._num(argv[0]);
                return n === null ? null : Math.floor(n);
            }

            case 'CEIL':
            case 'CEILING': {
                const n = this._num(argv[0]);
                return n === null ? null : Math.ceil(n);
            }

            case 'ROUND': {
                const n = this._num(argv[0]);
                if (n === null) return null;
                const places = argv[1] !== undefined && argv[1] !== null ? this._num(argv[1]) ?? 0 : 0;
                const factor = Math.pow(10, places);
                return Math.round(n * factor) / factor;
            }

            case 'MOD': {
                const a = this._num(argv[0]);
                const b = this._num(argv[1]);
                if (a === null || b === null || b === 0) return null;
                return a % b;
            }

            case 'POWER': {
                const base = this._num(argv[0]);
                const exp = this._num(argv[1]);
                if (base === null || exp === null) return null;
                return Math.pow(base, exp);
            }

            case 'SQRT': {
                const n = this._num(argv[0]);
                return n === null ? null : Math.sqrt(n);
            }

            case 'SIGN': {
                const n = this._num(argv[0]);
                if (n === null) return null;
                return n > 0 ? 1 : n < 0 ? -1 : 0;
            }

            case 'CONCAT': {
                if (argv.some((a) => a === null || a === undefined)) return null;
                return argv.map(String).join('');
            }

            case 'SUBSTRING': {
                const str = argv[0];
                if (str === null || str === undefined) return null;
                const s = String(str);
                const start = this._num(argv[1]);
                if (start === null) return null;
                // SQL SUBSTRING is 1-based
                const startIdx = start - 1;
                if (argv[2] !== undefined && argv[2] !== null) {
                    const len = this._num(argv[2]);
                    return len === null ? null : s.substring(startIdx, startIdx + len);
                }
                return s.substring(startIdx);
            }

            case 'COALESCE': {
                for (const a of argv) {
                    if (a !== null && a !== undefined) return a;
                }
                return null;
            }

            case 'NULLIF': {
                const a = argv[0];
                const b = argv[1];
                return _equals(a, b) ? null : a;
            }

            case 'TO_CHAR':
                return argv[0] === null || argv[0] === undefined ? null : String(argv[0]);

            case 'TO_NUMBER': {
                if (argv[0] === null || argv[0] === undefined) return null;
                const n = Number(argv[0]);
                return isNaN(n) ? null : n;
            }

            default:
                throw new Error(`Unknown SQL function: ${this.name}`);
        }
    }

    private _num(v: unknown): number | null {
        if (v === null || v === undefined) return null;
        const n = Number(v);
        return isNaN(n) ? null : n;
    }
}

// ── IS NULL / IS NOT NULL ─────────────────────────────────────────────────────

export class IsNullExpression implements Expression {
    constructor(
        public readonly expression: Expression,
        public readonly not: boolean,
    ) {}

    evaluate(row: SqlRow, key: unknown, value: unknown): unknown {
        const v = this.expression.evaluate(row, key, value);
        const isNull = v === null || v === undefined;
        return this.not ? !isNull : isNull;
    }
}

// ── LIKE ──────────────────────────────────────────────────────────────────────

export class LikeExpression implements Expression {
    private readonly _regex: RegExp;

    constructor(
        public readonly expression: Expression,
        public readonly pattern: string,
        public readonly escape?: string,
    ) {
        this._regex = this._buildRegex(pattern, escape);
    }

    evaluate(row: SqlRow, key: unknown, value: unknown): unknown {
        const v = this.expression.evaluate(row, key, value);
        if (v === null || v === undefined) return null;
        return this._regex.test(String(v));
    }

    private _buildRegex(pattern: string, escape?: string): RegExp {
        let regexStr = '';
        for (let i = 0; i < pattern.length; i++) {
            const ch = pattern[i];
            if (escape && ch === escape) {
                const next = pattern[++i];
                if (next !== undefined) {
                    regexStr += next.replace(/[.+^${}()|[\]\\]/g, '\\$&');
                }
            } else if (ch === '%') {
                regexStr += '.*';
            } else if (ch === '_') {
                regexStr += '.';
            } else {
                regexStr += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            }
        }
        return new RegExp(`^${regexStr}$`, 'si');
    }
}

// ── IN ────────────────────────────────────────────────────────────────────────

export class InExpression implements Expression {
    constructor(
        public readonly expression: Expression,
        public readonly values: Expression[],
    ) {}

    evaluate(row: SqlRow, key: unknown, value: unknown): unknown {
        const v = this.expression.evaluate(row, key, value);
        if (v === null || v === undefined) return null;
        return this.values.some((e) => _equals(v, e.evaluate(row, key, value)));
    }
}

// ── BETWEEN ───────────────────────────────────────────────────────────────────

export class BetweenExpression implements Expression {
    constructor(
        public readonly expression: Expression,
        public readonly low: Expression,
        public readonly high: Expression,
    ) {}

    evaluate(row: SqlRow, key: unknown, value: unknown): unknown {
        const v = this.expression.evaluate(row, key, value);
        const lo = this.low.evaluate(row, key, value);
        const hi = this.high.evaluate(row, key, value);
        if (v === null || lo === null || hi === null) return null;
        return _compare(v, lo) >= 0 && _compare(v, hi) <= 0;
    }
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

export function _equals(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) return false;
    if (typeof a === 'number' && typeof b === 'number') return a === b;
    if (typeof a === 'string' && typeof b === 'string') return a === b;
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

export function _compare(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
    if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
    const as = String(a);
    const bs = String(b);
    return as < bs ? -1 : as > bs ? 1 : 0;
}
