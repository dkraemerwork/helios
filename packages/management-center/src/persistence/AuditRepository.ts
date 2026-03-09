/**
 * Repository for the audit log.
 *
 * Every sensitive administrative action—user mutations, cluster
 * configuration changes, alert rule modifications—is recorded here.
 * All reads go directly through TursoConnectionFactory. All writes
 * are serialized through AsyncSerialQueue.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { InValue } from '@libsql/client';
import { TursoConnectionFactory } from './TursoConnectionFactory.js';
import { AsyncSerialQueue } from './AsyncSerialQueue.js';
import type { AuditLogEntry, CursorPaginatedResult } from '../shared/types.js';

export interface AuditQueryFilters {
  actorUserId?: string;
  clusterId?: string;
  actionType?: string;
  from?: number;
  to?: number;
}

@Injectable()
export class AuditRepository {
  private readonly logger = new Logger(AuditRepository.name);

  constructor(
    private readonly connectionFactory: TursoConnectionFactory,
    private readonly queue: AsyncSerialQueue,
  ) {}

  /** Inserts an audit log entry and returns its auto-generated id. */
  async insertAuditEntry(entry: AuditLogEntry): Promise<number> {
    return this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      const result = await client.execute({
        sql: `INSERT INTO audit_log (
          actor_user_id, action_type, cluster_id, target_type, target_id,
          request_id, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          entry.actorUserId,
          entry.actionType,
          entry.clusterId,
          entry.targetType,
          entry.targetId,
          entry.requestId,
          entry.detailsJson,
          entry.createdAt,
        ],
      });

      return Number(result.lastInsertRowid);
    });
  }

  /** Queries audit log entries with optional filters and cursor-based pagination. */
  async queryAuditLog(
    filters: AuditQueryFilters,
    limit = 50,
    cursor?: string,
  ): Promise<CursorPaginatedResult<AuditLogEntry>> {
    const client = await this.connectionFactory.getClient();
    const conditions: string[] = [];
    const args: InValue[] = [];

    if (filters.actorUserId) {
      conditions.push('actor_user_id = ?');
      args.push(filters.actorUserId);
    }
    if (filters.clusterId) {
      conditions.push('cluster_id = ?');
      args.push(filters.clusterId);
    }
    if (filters.actionType) {
      conditions.push('action_type = ?');
      args.push(filters.actionType);
    }
    if (filters.from !== undefined) {
      conditions.push('created_at >= ?');
      args.push(filters.from);
    }
    if (filters.to !== undefined) {
      conditions.push('created_at <= ?');
      args.push(filters.to);
    }
    if (cursor) {
      conditions.push('id < ?');
      args.push(parseInt(cursor, 10));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    args.push(limit + 1);

    const result = await client.execute({
      sql: `SELECT * FROM audit_log ${whereClause} ORDER BY id DESC LIMIT ?`,
      args,
    });

    const rows = result.rows.map(rowToAuditEntry);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && items.length > 0 ? String(items[items.length - 1]!.id) : null;

    return { items, nextCursor };
  }

  /** Retrieves a single audit entry by its id. */
  async getAuditEntryById(id: number): Promise<AuditLogEntry | null> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute({
      sql: 'SELECT * FROM audit_log WHERE id = ?',
      args: [id],
    });

    if (result.rows.length === 0) return null;
    return rowToAuditEntry(result.rows[0]!);
  }

  /** Deletes audit entries older than the given millisecond timestamp. */
  async deleteOldAuditEntries(olderThanMs: number): Promise<number> {
    return this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      const result = await client.execute({
        sql: 'DELETE FROM audit_log WHERE created_at < ?',
        args: [olderThanMs],
      });
      return Number(result.rowsAffected);
    });
  }
}

// ── Row Mapper ──────────────────────────────────────────────────────────────

function rowToAuditEntry(row: Record<string, unknown>): AuditLogEntry {
  return {
    id: row['id'] === null || row['id'] === undefined ? undefined : Number(row['id']),
    actorUserId: row['actor_user_id'] === null ? null : String(row['actor_user_id']),
    actionType: String(row['action_type']),
    clusterId: row['cluster_id'] === null ? null : String(row['cluster_id']),
    targetType: row['target_type'] === null ? null : String(row['target_type']),
    targetId: row['target_id'] === null ? null : String(row['target_id']),
    requestId: row['request_id'] === null ? null : String(row['request_id']),
    detailsJson: String(row['details_json']),
    createdAt: Number(row['created_at']),
  };
}
