/**
 * Repository for user authentication, sessions, password reset tokens,
 * and cluster records.
 *
 * All reads go directly through TursoConnectionFactory. All writes are
 * serialized through AsyncSerialQueue to prevent SQLITE_BUSY errors.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { InValue } from '@libsql/client';
import { TursoConnectionFactory } from './TursoConnectionFactory.js';
import { AsyncSerialQueue } from './AsyncSerialQueue.js';
import type {
  User,
  Session,
  PasswordResetToken,
  ClusterRecord,
  OffsetPaginatedResult,
} from '../shared/types.js';

@Injectable()
export class AuthRepository {
  private readonly logger = new Logger(AuthRepository.name);

  constructor(
    private readonly connectionFactory: TursoConnectionFactory,
    private readonly queue: AsyncSerialQueue,
  ) {}

  // ── Users ─────────────────────────────────────────────────────────────

  async createUser(user: User): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: `INSERT INTO users (id, email, display_name, password_hash, status, roles_json, cluster_scopes_json, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          user.id,
          user.email,
          user.displayName,
          user.passwordHash,
          user.status,
          JSON.stringify(user.roles),
          JSON.stringify(user.clusterScopes),
          user.createdAt,
          user.updatedAt,
        ],
      });
    });
  }

  async getUserById(id: string): Promise<User | null> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute({
      sql: 'SELECT * FROM users WHERE id = ?',
      args: [id],
    });

    if (result.rows.length === 0) return null;
    return rowToUser(result.rows[0]!);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute({
      sql: 'SELECT * FROM users WHERE email = ?',
      args: [email],
    });

    if (result.rows.length === 0) return null;
    return rowToUser(result.rows[0]!);
  }

  async updateUser(id: string, updates: Partial<User>): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      const setClauses: string[] = [];
      const args: InValue[] = [];

      if (updates.email !== undefined) {
        setClauses.push('email = ?');
        args.push(updates.email);
      }
      if (updates.displayName !== undefined) {
        setClauses.push('display_name = ?');
        args.push(updates.displayName);
      }
      if (updates.passwordHash !== undefined) {
        setClauses.push('password_hash = ?');
        args.push(updates.passwordHash);
      }
      if (updates.status !== undefined) {
        setClauses.push('status = ?');
        args.push(updates.status);
      }
      if (updates.roles !== undefined) {
        setClauses.push('roles_json = ?');
        args.push(JSON.stringify(updates.roles));
      }
      if (updates.clusterScopes !== undefined) {
        setClauses.push('cluster_scopes_json = ?');
        args.push(JSON.stringify(updates.clusterScopes));
      }
      if (updates.updatedAt !== undefined) {
        setClauses.push('updated_at = ?');
        args.push(updates.updatedAt);
      }

      if (setClauses.length === 0) return;

      args.push(id);
      await client.execute({
        sql: `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`,
        args,
      });
    });
  }

  async listUsers(page: number, pageSize: number): Promise<OffsetPaginatedResult<User>> {
    const client = await this.connectionFactory.getClient();
    const offset = (page - 1) * pageSize;

    const [countResult, dataResult] = await Promise.all([
      client.execute('SELECT COUNT(*) as cnt FROM users'),
      client.execute({
        sql: 'SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?',
        args: [pageSize, offset],
      }),
    ]);

    const total = Number(countResult.rows[0]!['cnt']);
    const items = dataResult.rows.map(rowToUser);

    return { items, page, pageSize, total };
  }

  async countUsers(): Promise<number> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute('SELECT COUNT(*) as cnt FROM users');
    return Number(result.rows[0]!['cnt']);
  }

  // ── Sessions ──────────────────────────────────────────────────────────

  async createSession(session: Session): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: `INSERT INTO sessions (id, user_id, refresh_hash, user_agent, ip_address, created_at, expires_at, refreshed_at, revoked_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          session.id,
          session.userId,
          session.refreshHash,
          session.userAgent,
          session.ipAddress,
          session.createdAt,
          session.expiresAt,
          session.refreshedAt,
          session.revokedAt,
        ],
      });
    });
  }

  async getSessionById(id: string): Promise<Session | null> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute({
      sql: 'SELECT * FROM sessions WHERE id = ?',
      args: [id],
    });

    if (result.rows.length === 0) return null;
    return rowToSession(result.rows[0]!);
  }

  async getActiveSessionsForUser(userId: string): Promise<Session[]> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute({
      sql: `SELECT * FROM sessions
            WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
            ORDER BY created_at DESC`,
      args: [userId, Date.now()],
    });

    return result.rows.map(rowToSession);
  }

  async revokeSession(id: string): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: 'UPDATE sessions SET revoked_at = ? WHERE id = ?',
        args: [Date.now(), id],
      });
    });
  }

  async revokeAllSessionsForUser(userId: string, exceptSessionId?: string): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();

      if (exceptSessionId) {
        await client.execute({
          sql: 'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL',
          args: [Date.now(), userId, exceptSessionId],
        });
      } else {
        await client.execute({
          sql: 'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
          args: [Date.now(), userId],
        });
      }
    });
  }

  async deleteExpiredSessions(): Promise<number> {
    return this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      const result = await client.execute({
        sql: 'DELETE FROM sessions WHERE expires_at < ? AND revoked_at IS NOT NULL',
        args: [Date.now()],
      });
      return Number(result.rowsAffected);
    });
  }

  async deleteRevokedSessionsOlderThan(ms: number): Promise<number> {
    return this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      const cutoff = Date.now() - ms;
      const result = await client.execute({
        sql: 'DELETE FROM sessions WHERE revoked_at IS NOT NULL AND revoked_at < ?',
        args: [cutoff],
      });
      return Number(result.rowsAffected);
    });
  }

  // ── Password Reset Tokens ────────────────────────────────────────────

  async createPasswordResetToken(token: PasswordResetToken): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, consumed_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          token.id,
          token.userId,
          token.tokenHash,
          token.expiresAt,
          token.consumedAt,
          token.createdAt,
        ],
      });
    });
  }

  async getPasswordResetTokenByHash(hash: string): Promise<PasswordResetToken | null> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute({
      sql: 'SELECT * FROM password_reset_tokens WHERE token_hash = ?',
      args: [hash],
    });

    if (result.rows.length === 0) return null;
    return rowToResetToken(result.rows[0]!);
  }

  async consumePasswordResetToken(id: string): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: 'UPDATE password_reset_tokens SET consumed_at = ? WHERE id = ?',
        args: [Date.now(), id],
      });
    });
  }

  async deleteExpiredResetTokens(): Promise<number> {
    return this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      const result = await client.execute({
        sql: 'DELETE FROM password_reset_tokens WHERE expires_at < ?',
        args: [Date.now()],
      });
      return Number(result.rowsAffected);
    });
  }

  // ── Clusters ──────────────────────────────────────────────────────────

  async upsertCluster(cluster: ClusterRecord): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: `INSERT INTO clusters (id, display_name, config_json, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET
                display_name = excluded.display_name,
                config_json = excluded.config_json,
                updated_at = excluded.updated_at`,
        args: [
          cluster.id,
          cluster.displayName,
          cluster.configJson,
          cluster.createdAt,
          cluster.updatedAt,
        ],
      });
    });
  }

  async getClusterById(id: string): Promise<ClusterRecord | null> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute({
      sql: 'SELECT * FROM clusters WHERE id = ?',
      args: [id],
    });

    if (result.rows.length === 0) return null;
    return rowToCluster(result.rows[0]!);
  }

  async listClusters(): Promise<ClusterRecord[]> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute('SELECT * FROM clusters ORDER BY display_name ASC');
    return result.rows.map(rowToCluster);
  }

  async deleteCluster(id: string): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: 'DELETE FROM clusters WHERE id = ?',
        args: [id],
      });
    });
  }

  async updateCluster(id: string, displayName: string, configJson: string): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: 'UPDATE clusters SET display_name = ?, config_json = ?, updated_at = ? WHERE id = ?',
        args: [displayName, configJson, Date.now(), id],
      });
    });
  }
}

// ── Row Mappers ─────────────────────────────────────────────────────────────

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: String(row['id']),
    email: String(row['email']),
    displayName: String(row['display_name']),
    passwordHash: String(row['password_hash']),
    status: String(row['status']) as 'active' | 'disabled',
    roles: JSON.parse(String(row['roles_json'])) as Array<'viewer' | 'operator' | 'admin'>,
    clusterScopes: JSON.parse(String(row['cluster_scopes_json'])) as string[],
    createdAt: Number(row['created_at']),
    updatedAt: Number(row['updated_at']),
  };
}

function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: String(row['id']),
    userId: String(row['user_id']),
    refreshHash: String(row['refresh_hash']),
    userAgent: row['user_agent'] === null ? null : String(row['user_agent']),
    ipAddress: row['ip_address'] === null ? null : String(row['ip_address']),
    createdAt: Number(row['created_at']),
    expiresAt: Number(row['expires_at']),
    refreshedAt: Number(row['refreshed_at']),
    revokedAt: row['revoked_at'] === null ? null : Number(row['revoked_at']),
  };
}

function rowToResetToken(row: Record<string, unknown>): PasswordResetToken {
  return {
    id: String(row['id']),
    userId: String(row['user_id']),
    tokenHash: String(row['token_hash']),
    expiresAt: Number(row['expires_at']),
    consumedAt: row['consumed_at'] === null ? null : Number(row['consumed_at']),
    createdAt: Number(row['created_at']),
  };
}

function rowToCluster(row: Record<string, unknown>): ClusterRecord {
  return {
    id: String(row['id']),
    displayName: String(row['display_name']),
    configJson: String(row['config_json']),
    createdAt: Number(row['created_at']),
    updatedAt: Number(row['updated_at']),
  };
}
