/**
 * WP8 SQL Breadth Expansion — Smoke / Integration Tests
 *
 * Tests CREATE/DROP MAPPING, GROUP BY, HAVING, DISTINCT, OR conditions,
 * aggregate functions (COUNT, SUM, AVG, MIN, MAX), and the expression engine.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { SqlService } from '@zenystx/helios-core/sql/impl/SqlService.js';
import { SqlStatement } from '@zenystx/helios-core/sql/impl/SqlStatement.js';
import { MappingRegistry } from '@zenystx/helios-core/sql/impl/MappingRegistry.js';
import { SqlTypeSystem, SqlErrorCode } from '@zenystx/helios-core/sql/impl/SqlTypeSystem.js';
import {
    AggregateExpression,
} from '@zenystx/helios-core/sql/impl/expression/AggregateExpression.js';
import {
    ColumnExpression,
    LiteralExpression,
    ArithmeticExpression,
    LikeExpression,
    BetweenExpression,
    InExpression,
    IsNullExpression,
    LogicalExpression,
    ComparisonExpression,
    CastExpression,
    CaseExpression,
    FunctionExpression,
} from '@zenystx/helios-core/sql/impl/expression/Expression.js';

// ── Minimal in-memory MapContainerService / NodeEngine mock ──────────────────

type RawEntry = [string, string];  // serialized key, serialized value

function makeServices(initialEntries: Array<[unknown, unknown]>) {
    const data: RawEntry[] = initialEntries.map(([k, v]) => [JSON.stringify(k), JSON.stringify(v)]);

    const partitionService = {
        getPartitionCount: () => 1,
        getPartitionId: (_k: unknown) => 0,
    };

    const nodeEngine = {
        toData: (v: unknown) => JSON.stringify(v) as unknown as import('@zenystx/helios-core/internal/serialization/Data.js').Data,
        toObject: <T>(d: unknown): T => JSON.parse(d as string) as T,
        getPartitionService: () => partitionService,
    } as unknown as import('@zenystx/helios-core/spi/NodeEngine.js').NodeEngine;

    const recordStore = {
        put: (kd: string, vd: string, _ttl: number, _maxIdle: number) => {
            const idx = data.findIndex(([k]) => k === kd);
            if (idx >= 0) { data[idx] = [kd, vd]; } else { data.push([kd, vd]); }
        },
        remove: (kd: string) => {
            const idx = data.findIndex(([k]) => k === kd);
            if (idx >= 0) data.splice(idx, 1);
        },
    };

    const containerService = {
        getAllEntries: (_mapName: string) => data.map(([k, v]) => [k, v]),
        getOrCreateRecordStore: (_mapName: string, _partitionId: number) => recordStore,
    } as unknown as import('@zenystx/helios-core/map/impl/MapContainerService.js').MapContainerService;

    return { nodeEngine, containerService };
}

const EMPLOYEES: Array<[unknown, unknown]> = [
    [1, { name: 'Alice', dept: 'Eng', salary: 90000, active: true }],
    [2, { name: 'Bob',   dept: 'Eng', salary: 80000, active: true }],
    [3, { name: 'Carol', dept: 'HR',  salary: 60000, active: true }],
    [4, { name: 'Dave',  dept: 'HR',  salary: 55000, active: false }],
    [5, { name: 'Eve',   dept: 'Eng', salary: 95000, active: true }],
    [6, { name: 'Frank', dept: 'HR',  salary: 62000, active: true }],
];

// ── Test Suites ───────────────────────────────────────────────────────────────

describe('WP8 — SqlStatement Parser', () => {
    it('parses CREATE MAPPING with columns and OPTIONS', () => {
        const stmt = new SqlStatement(`
            CREATE MAPPING IF NOT EXISTS employees
            TYPE IMap
            (id INTEGER, name VARCHAR, dept VARCHAR, salary INTEGER EXTERNAL NAME empSalary)
            OPTIONS ('key.format'='integer', 'value.format'='json')
        `);
        const parsed = stmt.parse();
        expect(parsed.type).toBe('CREATE_MAPPING');
        const cm = parsed as import('@zenystx/helios-core/sql/impl/SqlStatement.js').ParsedCreateMappingStatement;
        expect(cm.mappingName).toBe('employees');
        expect(cm.ifNotExists).toBe(true);
        expect(cm.mappingType).toBe('IMAP');
        expect(cm.columns).toHaveLength(4);
        expect(cm.columns[3].externalName).toBe('empSalary');
        expect(cm.options['key.format']).toBe('integer');
        expect(cm.options['value.format']).toBe('json');
    });

    it('parses CREATE MAPPING without IF NOT EXISTS', () => {
        const stmt = new SqlStatement('CREATE MAPPING myMap TYPE IMap');
        const parsed = stmt.parse() as import('@zenystx/helios-core/sql/impl/SqlStatement.js').ParsedCreateMappingStatement;
        expect(parsed.type).toBe('CREATE_MAPPING');
        expect(parsed.ifNotExists).toBe(false);
    });

    it('parses DROP MAPPING IF EXISTS', () => {
        const stmt = new SqlStatement('DROP MAPPING IF EXISTS employees');
        const parsed = stmt.parse() as import('@zenystx/helios-core/sql/impl/SqlStatement.js').ParsedDropMappingStatement;
        expect(parsed.type).toBe('DROP_MAPPING');
        expect(parsed.mappingName).toBe('employees');
        expect(parsed.ifExists).toBe(true);
    });

    it('parses DROP MAPPING without IF EXISTS', () => {
        const stmt = new SqlStatement('DROP MAPPING employees');
        const parsed = stmt.parse() as import('@zenystx/helios-core/sql/impl/SqlStatement.js').ParsedDropMappingStatement;
        expect(parsed.type).toBe('DROP_MAPPING');
        expect(parsed.ifExists).toBe(false);
    });

    it('parses SELECT DISTINCT', () => {
        const stmt = new SqlStatement('SELECT DISTINCT dept, name FROM employees');
        const parsed = stmt.parse() as import('@zenystx/helios-core/sql/impl/SqlStatement.js').ParsedSelectStatement;
        expect(parsed.distinct).toBe(true);
        expect(parsed.columns).toContain('dept');
        expect(parsed.columns).toContain('name');
    });

    it('parses GROUP BY and HAVING', () => {
        const stmt = new SqlStatement(`
            SELECT dept, COUNT(*) AS cnt FROM employees
            GROUP BY dept HAVING cnt > 2
        `);
        const parsed = stmt.parse() as import('@zenystx/helios-core/sql/impl/SqlStatement.js').ParsedSelectStatement;
        expect(parsed.groupBy).toEqual(['dept']);
        expect(parsed.having.length).toBeGreaterThan(0);
    });

    it('parses aggregate SELECT items', () => {
        const stmt = new SqlStatement(`
            SELECT dept, COUNT(*) AS cnt, AVG(salary) AS avg_sal, MIN(salary), MAX(salary), SUM(salary)
            FROM employees GROUP BY dept
        `);
        const parsed = stmt.parse() as import('@zenystx/helios-core/sql/impl/SqlStatement.js').ParsedSelectStatement;
        expect(parsed.selectItems).toHaveLength(6);
        const countItem = parsed.selectItems[1];
        expect(typeof countItem.expression).toBe('object');
        const agg = countItem.expression as import('@zenystx/helios-core/sql/impl/SqlStatement.js').AggregateCall;
        expect(agg.function).toBe('COUNT');
        expect(agg.column).toBe('*');
        expect(countItem.alias).toBe('cnt');
    });

    it('parses OR in WHERE clause', () => {
        const stmt = new SqlStatement("SELECT * FROM t WHERE a = 1 OR b = 2");
        const parsed = stmt.parse() as import('@zenystx/helios-core/sql/impl/SqlStatement.js').ParsedSelectStatement;
        expect(parsed.where).toHaveLength(1);
        const node = parsed.where[0] as import('@zenystx/helios-core/sql/impl/SqlStatement.js').SqlWhereGroup;
        expect(node.op).toBe('OR');
        expect(node.clauses).toHaveLength(2);
    });

    it('parses AND + OR combination', () => {
        const stmt = new SqlStatement("SELECT * FROM t WHERE (a = 1 AND b = 2) OR c = 3");
        const parsed = stmt.parse() as import('@zenystx/helios-core/sql/impl/SqlStatement.js').ParsedSelectStatement;
        expect(parsed.where).toHaveLength(1);
        const orNode = parsed.where[0] as import('@zenystx/helios-core/sql/impl/SqlStatement.js').SqlWhereGroup;
        expect(orNode.op).toBe('OR');
    });
});

// ── MappingRegistry ───────────────────────────────────────────────────────────

describe('WP8 — MappingRegistry', () => {
    let registry: MappingRegistry;

    beforeEach(() => { registry = new MappingRegistry(); });

    it('creates and retrieves a mapping', () => {
        registry.createMapping({ name: 'users', type: 'IMap', columns: [], options: {} });
        expect(registry.getMapping('users')).not.toBeNull();
        expect(registry.getMapping('USERS')).not.toBeNull();  // case-insensitive
    });

    it('listMappings returns all registered mappings', () => {
        registry.createMapping({ name: 'a', type: 'IMap', columns: [], options: {} });
        registry.createMapping({ name: 'b', type: 'IMap', columns: [], options: {} });
        expect(registry.listMappings()).toHaveLength(2);
    });

    it('throws on duplicate createMapping', () => {
        registry.createMapping({ name: 'users', type: 'IMap', columns: [], options: {} });
        expect(() => registry.createMapping({ name: 'users', type: 'IMap', columns: [], options: {} }))
            .toThrow();
    });

    it('createMappingIfNotExists returns false if exists', () => {
        registry.createMapping({ name: 'users', type: 'IMap', columns: [], options: {} });
        const created = registry.createMappingIfNotExists({ name: 'users', type: 'IMap', columns: [], options: {} });
        expect(created).toBe(false);
    });

    it('createMappingIfNotExists returns true if new', () => {
        const created = registry.createMappingIfNotExists({ name: 'users', type: 'IMap', columns: [], options: {} });
        expect(created).toBe(true);
    });

    it('drops a mapping', () => {
        registry.createMapping({ name: 'users', type: 'IMap', columns: [], options: {} });
        registry.dropMapping('users');
        expect(registry.getMapping('users')).toBeNull();
    });

    it('throws on dropMapping of non-existent', () => {
        expect(() => registry.dropMapping('nope')).toThrow();
    });

    it('dropMappingIfExists returns false when not found', () => {
        expect(registry.dropMappingIfExists('nope')).toBe(false);
    });
});

// ── SqlTypeSystem ─────────────────────────────────────────────────────────────

describe('WP8 — SqlTypeSystem', () => {
    const ts = new SqlTypeSystem();

    it('infers types correctly', () => {
        expect(ts.inferType('hello')).toBe('VARCHAR');
        expect(ts.inferType(42)).toBe('INTEGER');
        expect(ts.inferType(3.14)).toBe('DOUBLE');
        expect(ts.inferType(true)).toBe('BOOLEAN');
        expect(ts.inferType(null)).toBe('NULL');
        expect(ts.inferType(undefined)).toBe('NULL');
        expect(ts.inferType(BigInt(5))).toBe('BIGINT');
        expect(ts.inferType(new Date())).toBe('TIMESTAMP');
    });

    it('coerces to VARCHAR', () => {
        expect(ts.coerce(42, 'VARCHAR')).toBe('42');
        expect(ts.coerce(true, 'VARCHAR')).toBe('true');
    });

    it('coerces to BOOLEAN', () => {
        expect(ts.coerce(1, 'BOOLEAN')).toBe(true);
        expect(ts.coerce(0, 'BOOLEAN')).toBe(false);
        expect(ts.coerce('true', 'BOOLEAN')).toBe(true);
        expect(ts.coerce('false', 'BOOLEAN')).toBe(false);
    });

    it('coerces to INTEGER', () => {
        expect(ts.coerce('42', 'INTEGER')).toBe(42);
        expect(ts.coerce(3.9, 'INTEGER')).toBe(3);
    });

    it('coerces to DOUBLE', () => {
        expect(ts.coerce('3.14', 'DOUBLE')).toBeCloseTo(3.14);
    });

    it('returns null for null input', () => {
        expect(ts.coerce(null, 'INTEGER')).toBeNull();
        expect(ts.coerce(undefined, 'VARCHAR')).toBeNull();
    });

    it('areTypesCompatible works for numerics', () => {
        expect(ts.areTypesCompatible('INTEGER', 'DOUBLE')).toBe(true);
        expect(ts.areTypesCompatible('INTEGER', 'VARCHAR')).toBe(false);
        expect(ts.areTypesCompatible('INTEGER', 'OBJECT')).toBe(true);
        expect(ts.areTypesCompatible('INTEGER', 'NULL')).toBe(true);
    });

    it('commonType picks the wider type', () => {
        expect(ts.commonType('INTEGER', 'DOUBLE')).toBe('DOUBLE');
        expect(ts.commonType('VARCHAR', 'INTEGER')).toBe('VARCHAR');
        expect(ts.commonType('NULL', 'INTEGER')).toBe('INTEGER');
    });

    it('SqlErrorCode has expected values', () => {
        expect(SqlErrorCode.GENERIC).toBe(-1);
        expect(SqlErrorCode.CONNECTION_PROBLEM).toBe(1001);
        expect(SqlErrorCode.PARSING).toBe(1008);
        expect(SqlErrorCode.DATA_EXCEPTION).toBe(2000);
    });
});

// ── Expression Engine ─────────────────────────────────────────────────────────

describe('WP8 — Expression Engine', () => {
    const row = { name: 'Alice', age: 30, salary: 50000, dept: null as unknown };

    it('ColumnExpression resolves row fields', () => {
        expect(new ColumnExpression('name').evaluate(row, 'key1', null)).toBe('Alice');
        expect(new ColumnExpression('__key').evaluate(row, 'key1', null)).toBe('key1');
        expect(new ColumnExpression('this').evaluate(row, null, 'rawValue')).toBe('rawValue');
    });

    it('LiteralExpression returns its value', () => {
        expect(new LiteralExpression(42).evaluate(row, null, null)).toBe(42);
        expect(new LiteralExpression(null).evaluate(row, null, null)).toBeNull();
    });

    it('ArithmeticExpression evaluates all ops', () => {
        const age = new ColumnExpression('age');
        const five = new LiteralExpression(5);
        expect(new ArithmeticExpression('+', age, five).evaluate(row, null, null)).toBe(35);
        expect(new ArithmeticExpression('-', age, five).evaluate(row, null, null)).toBe(25);
        expect(new ArithmeticExpression('*', age, five).evaluate(row, null, null)).toBe(150);
        expect(new ArithmeticExpression('/', age, five).evaluate(row, null, null)).toBe(6);
        expect(new ArithmeticExpression('%', age, new LiteralExpression(7)).evaluate(row, null, null)).toBe(2);
    });

    it('ArithmeticExpression returns null on division by zero', () => {
        const age = new ColumnExpression('age');
        const zero = new LiteralExpression(0);
        expect(new ArithmeticExpression('/', age, zero).evaluate(row, null, null)).toBeNull();
    });

    it('ComparisonExpression evaluates correctly', () => {
        const age = new ColumnExpression('age');
        expect(new ComparisonExpression('=', age, new LiteralExpression(30)).evaluate(row, null, null)).toBe(true);
        expect(new ComparisonExpression('<>', age, new LiteralExpression(30)).evaluate(row, null, null)).toBe(false);
        expect(new ComparisonExpression('>', age, new LiteralExpression(20)).evaluate(row, null, null)).toBe(true);
        expect(new ComparisonExpression('<', age, new LiteralExpression(40)).evaluate(row, null, null)).toBe(true);
    });

    it('LogicalExpression AND / OR / NOT', () => {
        const t = new LiteralExpression(true);
        const f = new LiteralExpression(false);
        expect(new LogicalExpression('AND', [t, t]).evaluate(row, null, null)).toBe(true);
        expect(new LogicalExpression('AND', [t, f]).evaluate(row, null, null)).toBe(false);
        expect(new LogicalExpression('OR', [t, f]).evaluate(row, null, null)).toBe(true);
        expect(new LogicalExpression('OR', [f, f]).evaluate(row, null, null)).toBe(false);
        expect(new LogicalExpression('NOT', [t]).evaluate(row, null, null)).toBe(false);
    });

    it('IsNullExpression checks null / not null', () => {
        const dept = new ColumnExpression('dept');
        const name = new ColumnExpression('name');
        expect(new IsNullExpression(dept, false).evaluate(row, null, null)).toBe(true);
        expect(new IsNullExpression(dept, true).evaluate(row, null, null)).toBe(false);
        expect(new IsNullExpression(name, false).evaluate(row, null, null)).toBe(false);
        expect(new IsNullExpression(name, true).evaluate(row, null, null)).toBe(true);
    });

    it('LikeExpression matches SQL LIKE patterns', () => {
        const name = new ColumnExpression('name');
        expect(new LikeExpression(name, 'Al%').evaluate(row, null, null)).toBe(true);
        expect(new LikeExpression(name, '%ice').evaluate(row, null, null)).toBe(true);
        expect(new LikeExpression(name, 'A_ice').evaluate(row, null, null)).toBe(true);
        expect(new LikeExpression(name, 'Bob%').evaluate(row, null, null)).toBe(false);
    });

    it('InExpression tests membership', () => {
        const age = new ColumnExpression('age');
        const vals = [new LiteralExpression(20), new LiteralExpression(30), new LiteralExpression(40)];
        expect(new InExpression(age, vals).evaluate(row, null, null)).toBe(true);
        const vals2 = [new LiteralExpression(99)];
        expect(new InExpression(age, vals2).evaluate(row, null, null)).toBe(false);
    });

    it('BetweenExpression checks range inclusively', () => {
        const age = new ColumnExpression('age');
        expect(new BetweenExpression(age, new LiteralExpression(25), new LiteralExpression(35)).evaluate(row, null, null)).toBe(true);
        expect(new BetweenExpression(age, new LiteralExpression(30), new LiteralExpression(30)).evaluate(row, null, null)).toBe(true);
        expect(new BetweenExpression(age, new LiteralExpression(31), new LiteralExpression(40)).evaluate(row, null, null)).toBe(false);
    });

    it('CastExpression coerces values', () => {
        const lit = new LiteralExpression('42');
        expect(new CastExpression(lit, 'INTEGER').evaluate(row, null, null)).toBe(42);
        expect(new CastExpression(new LiteralExpression(3.14), 'VARCHAR').evaluate(row, null, null)).toBe('3.14');
    });

    it('CaseExpression returns first matching when', () => {
        const age = new ColumnExpression('age');
        const expr = new CaseExpression(
            [
                { condition: new ComparisonExpression('<', age, new LiteralExpression(18)), result: new LiteralExpression('minor') },
                { condition: new ComparisonExpression('<', age, new LiteralExpression(65)), result: new LiteralExpression('adult') },
            ],
            new LiteralExpression('senior'),
        );
        expect(expr.evaluate(row, null, null)).toBe('adult');
    });

    it('FunctionExpression — string functions', () => {
        const nameExpr = new ColumnExpression('name');
        expect(new FunctionExpression('UPPER', [nameExpr]).evaluate(row, null, null)).toBe('ALICE');
        expect(new FunctionExpression('LOWER', [nameExpr]).evaluate(row, null, null)).toBe('alice');
        expect(new FunctionExpression('LENGTH', [nameExpr]).evaluate(row, null, null)).toBe(5);
        expect(new FunctionExpression('TRIM', [new LiteralExpression('  hi  ')]).evaluate(row, null, null)).toBe('hi');
        expect(new FunctionExpression('SUBSTRING', [nameExpr, new LiteralExpression(1), new LiteralExpression(3)]).evaluate(row, null, null)).toBe('Ali');
    });

    it('FunctionExpression — numeric functions', () => {
        const negFive = new LiteralExpression(-5);
        expect(new FunctionExpression('ABS', [negFive]).evaluate(row, null, null)).toBe(5);
        expect(new FunctionExpression('FLOOR', [new LiteralExpression(3.9)]).evaluate(row, null, null)).toBe(3);
        expect(new FunctionExpression('CEIL', [new LiteralExpression(3.1)]).evaluate(row, null, null)).toBe(4);
        expect(new FunctionExpression('ROUND', [new LiteralExpression(3.567), new LiteralExpression(2)]).evaluate(row, null, null)).toBeCloseTo(3.57);
    });

    it('FunctionExpression — COALESCE and NULLIF', () => {
        const nullLit = new LiteralExpression(null);
        const val42 = new LiteralExpression(42);
        expect(new FunctionExpression('COALESCE', [nullLit, val42]).evaluate(row, null, null)).toBe(42);
        expect(new FunctionExpression('NULLIF', [val42, new LiteralExpression(42)]).evaluate(row, null, null)).toBeNull();
        expect(new FunctionExpression('NULLIF', [val42, new LiteralExpression(99)]).evaluate(row, null, null)).toBe(42);
    });

    it('FunctionExpression — CONCAT', () => {
        const fn = new FunctionExpression('CONCAT', [
            new LiteralExpression('Hello'),
            new LiteralExpression(', '),
            new LiteralExpression('World'),
        ]);
        expect(fn.evaluate(row, null, null)).toBe('Hello, World');
    });
});

// ── Aggregate Functions ───────────────────────────────────────────────────────

describe('WP8 — Aggregate Functions', () => {
    const operand = new ColumnExpression('value');

    const feed = (agg: AggregateExpression, values: Array<{ value: unknown }>) => {
        const acc = agg.createAccumulator();
        for (const r of values) agg.feed(acc, r as Record<string, unknown>, null, null);
        return acc.getResult();
    };

    const rows = [
        { value: 10 }, { value: 20 }, { value: 30 }, { value: null }, { value: 10 },
    ];

    it('COUNT non-null values', () => {
        expect(feed(new AggregateExpression('COUNT', operand, false), rows)).toBe(4);
    });

    it('COUNT(*) counts all rows', () => {
        expect(feed(new AggregateExpression('COUNT', null, false), rows)).toBe(5);
    });

    it('COUNT DISTINCT', () => {
        expect(feed(new AggregateExpression('COUNT', operand, true), rows)).toBe(3);
    });

    it('SUM ignores nulls', () => {
        expect(feed(new AggregateExpression('SUM', operand, false), rows)).toBe(70);
    });

    it('SUM returns null when all values are null', () => {
        expect(feed(new AggregateExpression('SUM', operand, false), [{ value: null }])).toBeNull();
    });

    it('AVG computes correct average', () => {
        expect(feed(new AggregateExpression('AVG', operand, false), rows)).toBeCloseTo(17.5);
    });

    it('AVG returns null for no rows', () => {
        expect(feed(new AggregateExpression('AVG', operand, false), [])).toBeNull();
    });

    it('MIN finds minimum', () => {
        expect(feed(new AggregateExpression('MIN', operand, false), rows)).toBe(10);
    });

    it('MAX finds maximum', () => {
        expect(feed(new AggregateExpression('MAX', operand, false), rows)).toBe(30);
    });

    it('SUM DISTINCT deduplicates', () => {
        expect(feed(new AggregateExpression('SUM', operand, true), rows)).toBe(60);  // 10+20+30
    });
});

// ── SqlService Integration ────────────────────────────────────────────────────

describe('WP8 — SqlService Integration', () => {
    let svc: SqlService;

    beforeEach(() => {
        const { nodeEngine, containerService } = makeServices(EMPLOYEES);
        svc = new SqlService(nodeEngine, containerService);
    });

    it('CREATE MAPPING registers in the registry', () => {
        svc.execute(`
            CREATE MAPPING IF NOT EXISTS employees
            TYPE IMap
            (id INTEGER, name VARCHAR, dept VARCHAR, salary INTEGER, active BOOLEAN)
        `);
        const mapping = svc.getMappingRegistry().getMapping('employees');
        expect(mapping).not.toBeNull();
        expect(mapping!.columns).toHaveLength(5);
    });

    it('CREATE MAPPING without IF NOT EXISTS throws on duplicate', () => {
        svc.execute('CREATE MAPPING employees TYPE IMap');
        expect(() => svc.execute('CREATE MAPPING employees TYPE IMap')).toThrow();
    });

    it('DROP MAPPING removes the mapping', () => {
        svc.execute('CREATE MAPPING employees TYPE IMap');
        svc.execute('DROP MAPPING employees');
        expect(svc.getMappingRegistry().getMapping('employees')).toBeNull();
    });

    it('DROP MAPPING IF EXISTS does not throw when absent', () => {
        expect(() => svc.execute('DROP MAPPING IF EXISTS nonexistent')).not.toThrow();
    });

    it('DROP MAPPING without IF EXISTS throws when absent', () => {
        expect(() => svc.execute('DROP MAPPING nonexistent')).toThrow();
    });

    it('SELECT * returns all rows', () => {
        const rows = svc.execute('SELECT * FROM employees').toArray();
        expect(rows).toHaveLength(6);
    });

    it('OR in WHERE selects correct rows', () => {
        const rows = svc.execute("SELECT * FROM employees WHERE dept = 'Eng' OR name = 'Carol'").toArray();
        expect(rows).toHaveLength(4);
        const names = rows.map((r) => (r as { name: string }).name).sort();
        expect(names).toEqual(['Alice', 'Bob', 'Carol', 'Eve'].sort());
    });

    it('AND in WHERE still works', () => {
        const rows = svc.execute("SELECT * FROM employees WHERE dept = 'Eng' AND active = true").toArray();
        expect(rows).toHaveLength(3);
    });

    it('DISTINCT deduplicates results', () => {
        const rows = svc.execute('SELECT DISTINCT dept FROM employees').toArray();
        expect(rows).toHaveLength(2);
    });

    it('COUNT(*) with no GROUP BY returns single row', () => {
        const rows = svc.execute('SELECT COUNT(*) AS total FROM employees').toArray();
        expect(rows).toHaveLength(1);
        expect((rows[0] as { total: number }).total).toBe(6);
    });

    it('GROUP BY + COUNT(*) groups correctly', () => {
        const rows = svc.execute(`
            SELECT dept, COUNT(*) AS cnt FROM employees GROUP BY dept ORDER BY dept ASC
        `).toArray();
        expect(rows).toHaveLength(2);
        const eng = rows.find((r) => (r as { dept: string }).dept === 'Eng') as { cnt: number } | undefined;
        const hr  = rows.find((r) => (r as { dept: string }).dept === 'HR') as { cnt: number } | undefined;
        expect(eng?.cnt).toBe(3);
        expect(hr?.cnt).toBe(3);
    });

    it('GROUP BY + SUM aggregates salary', () => {
        const rows = svc.execute(`
            SELECT dept, SUM(salary) AS total FROM employees GROUP BY dept ORDER BY dept ASC
        `).toArray();
        const eng = rows.find((r) => (r as { dept: string }).dept === 'Eng') as { total: number } | undefined;
        const hr  = rows.find((r) => (r as { dept: string }).dept === 'HR') as { total: number } | undefined;
        expect(eng?.total).toBe(265000);  // 90000+80000+95000
        expect(hr?.total).toBe(177000);   // 60000+55000+62000
    });

    it('GROUP BY + AVG computes mean', () => {
        const rows = svc.execute(`
            SELECT dept, AVG(salary) AS avg_sal FROM employees GROUP BY dept ORDER BY dept ASC
        `).toArray();
        const eng = rows.find((r) => (r as { dept: string }).dept === 'Eng') as { avg_sal: number } | undefined;
        expect(eng?.avg_sal).toBeCloseTo(265000 / 3, 2);
    });

    it('GROUP BY + MIN + MAX', () => {
        const rows = svc.execute(`
            SELECT dept, MIN(salary) AS min_sal, MAX(salary) AS max_sal
            FROM employees GROUP BY dept ORDER BY dept ASC
        `).toArray();
        const eng = rows.find((r) => (r as { dept: string }).dept === 'Eng') as { min_sal: number; max_sal: number } | undefined;
        expect(eng?.min_sal).toBe(80000);
        expect(eng?.max_sal).toBe(95000);
    });

    it('HAVING filters groups', () => {
        // active=true: Alice(Eng), Bob(Eng), Carol(HR), Eve(Eng), Frank(HR) → Eng:3, HR:2
        const rows = svc.execute(`
            SELECT dept, COUNT(*) AS cnt
            FROM employees WHERE active = true
            GROUP BY dept HAVING cnt > 2
        `).toArray();
        expect(rows).toHaveLength(1);
        expect((rows[0] as { dept: string }).dept).toBe('Eng');
    });

    it('existing SELECT/INSERT/UPDATE/DELETE still works', () => {
        // INSERT
        const ir = svc.execute("INSERT INTO employees (__key, name, dept, salary, active) VALUES (7, 'Grace', 'PM', 75000, true)");
        expect(ir.getUpdateCount()).toBe(1);

        // SELECT with WHERE
        const sr = svc.execute("SELECT * FROM employees WHERE name = 'Grace'").toArray();
        expect(sr).toHaveLength(1);

        // UPDATE
        const ur = svc.execute("UPDATE employees SET salary = 80000 WHERE name = 'Grace'");
        expect(ur.getUpdateCount()).toBe(1);

        // DELETE
        const dr = svc.execute("DELETE FROM employees WHERE name = 'Grace'");
        expect(dr.getUpdateCount()).toBe(1);
    });

    it('LIMIT and OFFSET work after GROUP BY', () => {
        const rows = svc.execute(`
            SELECT dept, COUNT(*) AS cnt FROM employees GROUP BY dept ORDER BY dept ASC LIMIT 1
        `).toArray();
        expect(rows).toHaveLength(1);
        expect((rows[0] as { dept: string }).dept).toBe('Eng');
    });
});
