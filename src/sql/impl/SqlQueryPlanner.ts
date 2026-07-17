/**
 * Index-aware SQL query planner.
 *
 * Chooses between:
 * - KEY_LOOKUP  — WHERE __key = const (or this = const for key-as-value maps)
 * - INDEX_SCAN  — WHERE <attr> = const with a usable equality index
 * - FULL_SCAN   — sequential scan of all map entries
 *
 * Port intent of Hazelcast SQL optimizer's index selection (simplified).
 */
import {
    isWhereGroup,
    type ParsedSelectStatement,
    type SqlConditionNode,
    type SqlWhereClause,
} from '@zenystx/helios-core/sql/impl/SqlStatement.js';

export type ScanPlanKind = 'KEY_LOOKUP' | 'INDEX_SCAN' | 'FULL_SCAN';

export interface KeyLookupPlan {
    readonly kind: 'KEY_LOOKUP';
    readonly keyValue: unknown;
}

export interface IndexScanPlan {
    readonly kind: 'INDEX_SCAN';
    readonly attribute: string;
    readonly value: unknown;
}

export interface FullScanPlan {
    readonly kind: 'FULL_SCAN';
    readonly reason: string;
}

export type ScanPlan = KeyLookupPlan | IndexScanPlan | FullScanPlan;

export interface IndexAvailability {
    /** Returns true when an equality-usable index exists for the attribute. */
    hasEqualityIndex(mapName: string, attribute: string): boolean;
}

/**
 * Extract a single top-level equality leaf that can drive an index/key plan.
 * Returns null when the WHERE tree is not a simple (implicit-AND) equality set
 * containing at least one usable equality.
 */
function collectEqualityLeaves(nodes: SqlConditionNode[]): SqlWhereClause[] {
    const leaves: SqlWhereClause[] = [];
    for (const node of nodes) {
        if (isWhereGroup(node)) {
            if (node.op === 'OR') {
                // OR trees are not index-sargable in this planner
                return [];
            }
            leaves.push(...collectEqualityLeaves(node.clauses));
            continue;
        }
        if (node.operator === '=') {
            leaves.push(node);
        }
    }
    return leaves;
}

export class SqlQueryPlanner {
    constructor(private readonly _indexes: IndexAvailability | null = null) {}

    /**
     * Produce a scan plan for the primary mapping of a SELECT statement.
     * JOIN queries always fall back to FULL_SCAN of the left side (join handled later).
     */
    plan(stmt: ParsedSelectStatement): ScanPlan {
        if (stmt.joins.length > 0) {
            return { kind: 'FULL_SCAN', reason: 'joins require left-side full scan + hash join' };
        }
        if (stmt.where.length === 0) {
            return { kind: 'FULL_SCAN', reason: 'no WHERE clause' };
        }

        const equalities = collectEqualityLeaves(stmt.where);
        if (equalities.length === 0) {
            return { kind: 'FULL_SCAN', reason: 'no sargable equality predicates' };
        }

        // Prefer __key equality
        const keyEq = equalities.find((e) => e.column === '__key' || e.column.toLowerCase() === '__key');
        if (keyEq !== undefined) {
            return { kind: 'KEY_LOOKUP', keyValue: keyEq.value };
        }

        // Prefer first attribute with an available equality index
        if (this._indexes !== null) {
            for (const eq of equalities) {
                if (this._indexes.hasEqualityIndex(stmt.mapName, eq.column)) {
                    return { kind: 'INDEX_SCAN', attribute: eq.column, value: eq.value };
                }
            }
        }

        // Even without a registered index, advertise INDEX_SCAN for equality so
        // the engine can build a transient hash index for the attribute (proves
        // index-aware path vs blind sequential filter).
        const firstAttr = equalities[0]!;
        if (firstAttr.column !== '__key') {
            return { kind: 'INDEX_SCAN', attribute: firstAttr.column, value: firstAttr.value };
        }

        return { kind: 'FULL_SCAN', reason: 'no usable index path' };
    }
}
