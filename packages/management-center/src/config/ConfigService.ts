/**
 * NestJS injectable configuration service.
 *
 * Loads configuration from environment variables, validates it against the
 * Zod schema, and exposes typed getters for every config section. The service
 * is instantiated once at module initialization and remains immutable for the
 * lifetime of the application.
 */

import { Injectable } from '@nestjs/common';
import type { ClusterConfig } from '../shared/types.js';
import {
  type ManagementCenterConfig,
  managementCenterConfigSchema,
  parseEnvToRawConfig,
} from './ConfigSchema.js';

@Injectable()
export class ConfigService {
  private readonly _config: ManagementCenterConfig;

  constructor() {
    const raw = parseEnvToRawConfig(process.env as Record<string, string | undefined>);
    const result = managementCenterConfigSchema.safeParse(raw);

    if (!result.success) {
      const formatted = result.error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n');
      throw new Error(`Management Center configuration validation failed:\n${formatted}`);
    }

    this._config = result.data;
  }

  /** Returns the full validated configuration object. */
  get config(): ManagementCenterConfig {
    return this._config;
  }

  // ── Server ──────────────────────────────────────────────────────────────

  get serverHost(): string {
    return this._config.server.host;
  }

  get serverPort(): number {
    return this._config.server.port;
  }

  get publicUrl(): string {
    return this._config.server.publicUrl;
  }

  get trustProxy(): boolean {
    return this._config.server.trustProxy;
  }

  get secureCookies(): boolean {
    return this._config.server.secureCookies;
  }

  // ── Database ────────────────────────────────────────────────────────────

  get databaseUrl(): string {
    return this._config.database.url;
  }

  get databaseAuthToken(): string | undefined {
    return this._config.database.authToken;
  }

  get backupBucketUrl(): string | undefined {
    return this._config.database.backupBucketUrl;
  }

  get backupBucketRegion(): string | undefined {
    return this._config.database.backupBucketRegion;
  }

  get backupAccessKeyId(): string | undefined {
    return this._config.database.backupAccessKeyId;
  }

  get backupSecretAccessKey(): string | undefined {
    return this._config.database.backupSecretAccessKey;
  }

  get backupRoleArn(): string | undefined {
    return this._config.database.backupRoleArn;
  }

  get backupEncryptionKey(): string {
    return this._config.database.backupEncryptionKey;
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  get authIssuer(): string {
    return this._config.auth.issuer;
  }

  get sessionTtlMs(): number {
    return this._config.auth.sessionTtlMinutes * 60 * 1000;
  }

  get refreshTtlMs(): number {
    return this._config.auth.refreshTtlDays * 24 * 60 * 60 * 1000;
  }

  get cookieDomain(): string | undefined {
    return this._config.auth.cookieDomain;
  }

  get csrfSecret(): string {
    return this._config.auth.csrfSecret;
  }

  get bootstrapAdminEmail(): string {
    return this._config.auth.bootstrapAdmin.email;
  }

  get bootstrapAdminPassword(): string {
    return this._config.auth.bootstrapAdmin.password;
  }

  get bootstrapAdminDisplayName(): string {
    return this._config.auth.bootstrapAdmin.displayName;
  }

  // ── SMTP ─────────────────────────────────────────────────────────────────

  get smtpHost(): string {
    return this._config.smtp.host;
  }

  get smtpPort(): number {
    return this._config.smtp.port;
  }

  get smtpSecure(): boolean {
    return this._config.smtp.secure;
  }

  get smtpUsername(): string {
    return this._config.smtp.username;
  }

  get smtpPassword(): string {
    return this._config.smtp.password;
  }

  get smtpFrom(): string {
    return this._config.smtp.from;
  }

  // ── Rate Limits ──────────────────────────────────────────────────────────

  get rateLimitAuthPerMinute(): number {
    return this._config.rateLimit.authPerMinute;
  }

  get rateLimitApiPerMinute(): number {
    return this._config.rateLimit.apiPerMinute;
  }

  get rateLimitWsPerMinute(): number {
    return this._config.rateLimit.wsPerMinute;
  }

  // ── Retention ────────────────────────────────────────────────────────────

  get retentionRawSamplesHours(): number {
    return this._config.retention.rawSamplesHours;
  }

  get retentionMinuteAggregatesHours(): number {
    return this._config.retention.minuteAggregatesHours;
  }

  get retentionFiveMinuteAggregatesDays(): number {
    return this._config.retention.fiveMinuteAggregatesDays;
  }

  get retentionHourlyAggregatesDays(): number {
    return this._config.retention.hourlyAggregatesDays;
  }

  get retentionDailyAggregatesDays(): number {
    return this._config.retention.dailyAggregatesDays;
  }

  get retentionEventDays(): number {
    return this._config.retention.eventDays;
  }

  get retentionAlertDays(): number {
    return this._config.retention.alertDays;
  }

  get retentionAuditDays(): number {
    return this._config.retention.auditDays;
  }

  get retentionJobDays(): number {
    return this._config.retention.jobDays;
  }

  // ── Clusters ─────────────────────────────────────────────────────────────

  get clusters(): readonly ClusterConfig[] {
    return this._config.clusters;
  }
}
