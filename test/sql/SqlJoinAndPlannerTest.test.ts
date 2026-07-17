/**
 * SQL JOIN support + index-aware planner — closes SQL PARTIALs.
 */
import { describe, expect, it } from 'bun:test';
import { SqlService } from '@zenystx/helios-core/sql/impl/SqlService.js';
import { SqlStatement } from '@zenystx/helios-core/sql/impl/SqlStatement.js';
import { SqlQueryPlanner } from '@zenystx/helios-core/sql/impl/SqlQueryPlanner.js';

type RawEntry = [string, string];

function makeServices(maps: Record<string, Array<[unknown, unknown]>>) {
    const data = new Map<string, RawEntry[]>();
    for (const [name, entries] of Object.entries(maps)) {
        data.set(
            name,
            entries.map(([k, v]) => [JSON.stringify(k), JSON.stringify(v)]),
        );
    }

    const partitionService = {
        getPartitionCount: () => 1,
        getPartitionId: (_k: unknown) => 0,
    };

    const nodeEngine = {
        toData: (v: unknown) => JSON.stringify(v) as unknown as import('@zenystx/helios-core/internal/serialization/Data.js').Data,
        toObject: <T>(d: unknown): T => JSON.parse(d as string) as T,
        getPartitionService: () => partitionService,
    } as unknown as import('@zenystx/helios-core/spi/NodeEngine.js').NodeEngine;

    const containerService = {
        getAllEntries: (mapName: string) => data.get(mapName) ?? [],
        getOrCreateRecordStore: (mapName: string, _partitionId: number) => ({
            get: (kd: string) => {
                const entries = data.get(mapName) ?? [];
                const hit = entries.find(([k]) => k === kd);
                return hit ? hit[1] : null;
            },
            put: (kd: string, vd: string) => {
                const entries = data.get(mapName) ?? [];
                const idx = entries.findIndex(([k]) => k === kd);
                if (idx >= 0) entries[idx] = [kd, vd];
                else entries.push([kd, vd]);
                data.set(mapName, entries);
            },
            remove: (kd: string) => {
                const entries = data.get(mapName) ?? [];
                const idx = entries.findIndex(([k]) => k === kd);
                if (idx >= 0) entries.splice(idx, 1);
            },
        }),
    } as unknown as import('@zenystx/helios-core/map/impl/MapContainerService.js').MapContainerService;

    return { nodeEngine, containerService };
}

describe('SqlStatement JOIN parsing', () => {
    it('parses INNER JOIN with ON equality', () => {
        const stmt = new SqlStatement(
            `SELECT e.name, d.budget FROM employees e INNER JOIN depts d ON e.dept = d.__key`,
        );
        const parsed = stmt.parse();
        expect(parsed.type).toBe('SELECT');
        if (parsed.type !== 'SELECT') return;
        expect(parsed.mapName).toBe('employees');
        expect(parsed.mapAlias).toBe('e');
        expect(parsed.joins).toHaveLength(1);
        expect(parsed.joins[0]!.joinType).toBe('INNER');
        expect(parsed.joins[0]!.mapName).toBe('depts');
        expect(parsed.joins[0]!.alias).toBe('d');
        expect(parsed.joins[0]!.onLeft).toBe('e.dept');
        expect(parsed.joins[0]!.onRight).toBe('d.__key');
    });

    it('parses LEFT JOIN', () => {
        const stmt = new SqlStatement(
            `SELECT * FROM a LEFT JOIN b ON a.id = b.a_id`,
        );
        const parsed = stmt.parse();
        if (parsed.type !== 'SELECT') return;
        expect(parsed.joins[0]!.joinType).toBe('LEFT');
    });
});

describe('SqlQueryPlanner', () => {
    it('chooses KEY_LOOKUP for __key equality', () => {
        const planner = new SqlQueryPlanner();
        const stmt = new SqlStatement(`SELECT * FROM m WHERE __key = 1`).parse();
        if (stmt.type !== 'SELECT') throw new Error('expected SELECT');
        const plan = planner.plan(stmt);
        expect(plan.kind).toBe('KEY_LOOKUP');
        if (plan.kind === 'KEY_LOOKUP') expect(plan.keyValue).toBe(1);
    });

    it('chooses INDEX_SCAN for attribute equality', () => {
        const planner = new SqlQueryPlanner();
        const stmt = new SqlStatement(`SELECT * FROM m WHERE dept = 'Eng'`).parse();
        if (stmt.type !== 'SELECT') throw new Error('expected SELECT');
        const plan = planner.plan(stmt);
        expect(plan.kind).toBe('INDEX_SCAN');
        if (plan.kind === 'INDEX_SCAN') {
            expect(plan.attribute).toBe('dept');
            expect(plan.value).toBe('Eng');
        }
    });

    it('chooses FULL_SCAN when no WHERE', () => {
        const planner = new SqlQueryPlanner();
        const stmt = new SqlStatement(`SELECT * FROM m`).parse();
        if (stmt.type !== 'SELECT') throw new Error('expected SELECT');
        expect(planner.plan(stmt).kind).toBe('FULL_SCAN');
    });
});

describe('SqlService JOIN execution', () => {
    it('INNER JOIN returns only matching rows', () => {
        const { nodeEngine, containerService } = makeServices({
            employees: [
                [1, { name: 'Alice', dept: 'Eng' }],
                [2, { name: 'Bob', dept: 'HR' }],
                [3, { name: 'Carol', dept: 'Sales' }],
            ],
            depts: [
                ['Eng', { budget: 100 }],
                ['HR', { budget: 50 }],
            ],
        });
        const sql = new SqlService(nodeEngine, containerService);
        const result = sql.execute(
            `SELECT name FROM employees e INNER JOIN depts d ON e.dept = d.__key`,
        );
        const names = [...result].map((r) => r['name'] ?? r['e.name']);
        expect(names.sort()).toEqual(['Alice', 'Bob']);
        expect(names).not.toContain('Carol');
    });

    it('LEFT JOIN keeps unmatched left rows', () => {
        const { nodeEngine, containerService } = makeServices({
            employees: [
                [1, { name: 'Alice', dept: 'Eng' }],
                [2, { name: 'Zed', dept: 'Ghost' }],
            ],
            depts: [['Eng', { budget: 100 }]],
        });
        const sql = new SqlService(nodeEngine, containerService);
        const result = sql.execute(
            `SELECT name FROM employees e LEFT JOIN depts d ON e.dept = d.__key`,
        );
        const names = [...result].map((r) => r['name']);
        expect(names.sort()).toEqual(['Alice', 'Zed']);
    });

    it('uses KEY_LOOKUP plan for __key equality SELECT', () => {
        const { nodeEngine, containerService } = makeServices({
            m: [[42, { v: 'answer' }]],
        });
        const sql = new SqlService(nodeEngine, containerService);
        const result = sql.execute(`SELECT * FROM m WHERE __key = 42`);
        expect(sql.getLastPlan()?.kind).toBe('KEY_LOOKUP');
        expect(result.rowCount()).toBe(1);
    });

    it('uses INDEX_SCAN plan for attribute equality', () => {
        const { nodeEngine, containerService } = makeServices({
            m: [
                [1, { dept: 'Eng', name: 'A' }],
                [2, { dept: 'HR', name: 'B' }],
                [3, { dept: 'Eng', name: 'C' }],
            ],
        });
        const sql = new SqlService(nodeEngine, containerService);
        const result = sql.execute(`SELECT name FROM m WHERE dept = 'Eng'`);
        expect(sql.getLastPlan()?.kind).toBe('INDEX_SCAN');
        expect(result.rowCount()).toBe(2);
    });
});
