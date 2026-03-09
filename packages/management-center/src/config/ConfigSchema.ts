/**
 * Zod validation schema for ManagementCenterConfig.
 *
 * Parses and validates environment variables (MC_ prefix) into a fully typed
 * configuration object with sensible defaults for local development.
 */

import { z } from 'zod';

const clusterConfigSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  memberAddresses: z.array(z.string().min(1)).min(1),
  restPort: z.number().int().positive().default(8080),
  sslEnabled: z.boolean().default(false),
  authToken: z.string().optional(),
  autoDiscover: z.boolean().default(true),
  requestTimeoutMs: z.number().int().positive().default(5000),
  stalenessWindowMs: z.number().int().positive().default(30000),
});

export const managementCenterConfigSchema = z.object({
  server: z.object({
    host: z.string().default('0.0.0.0'),
    port: z.number().int().positive().default(8080),
    publicUrl: z.string().url().default('http://localhost:8080'),
    trustProxy: z.boolean().default(false),
    secureCookies: z.boolean().default(false),
  }).default({}),

  database: z.object({
    url: z.string().min(1).default('file:mc.db'),
    authToken: z.string().optional(),
    backupBucketUrl: z.string().optional(),
    backupBucketRegion: z.string().optional(),
    backupAccessKeyId: z.string().optional(),
    backupSecretAccessKey: z.string().optional(),
    backupRoleArn: z.string().optional(),
    backupEncryptionKey: z.string().default(''),
  }).default({}),

  auth: z.object({
    issuer: z.string().default('helios-management-center'),
    sessionTtlMinutes: z.number().int().positive().default(30),
    refreshTtlDays: z.number().int().positive().default(7),
    cookieDomain: z.string().optional(),
    csrfSecret: z.string().min(16).default('change-me-in-prod'),
    bootstrapAdmin: z.object({
      email: z.string().email().default('admin@localhost'),
      password: z.string().min(14).default('changeme-in-prod!'),
      displayName: z.string().default('Admin'),
    }).default({}),
  }).default({}),

  smtp: z.object({
    host: z.string().default('localhost'),
    port: z.number().int().positive().default(587),
    secure: z.boolean().default(false),
    username: z.string().default(''),
    password: z.string().default(''),
    from: z.string().default('Helios MC <noreply@localhost>'),
  }).default({}),

  rateLimit: z.object({
    authPerMinute: z.number().int().positive().default(10),
    apiPerMinute: z.number().int().positive().default(120),
    wsPerMinute: z.number().int().positive().default(60),
  }).default({}),

  retention: z.object({
    rawSamplesHours: z.number().positive().default(6),
    minuteAggregatesHours: z.number().positive().default(48),
    fiveMinuteAggregatesDays: z.number().positive().default(14),
    hourlyAggregatesDays: z.number().positive().default(90),
    dailyAggregatesDays: z.number().positive().default(365),
    eventDays: z.number().positive().default(30),
    alertDays: z.number().positive().default(90),
    auditDays: z.number().positive().default(365),
    jobDays: z.number().positive().default(30),
  }).default({}),

  clusters: z.array(clusterConfigSchema).default([]),
});

export type ManagementCenterConfig = z.infer<typeof managementCenterConfigSchema>;

/**
 * Parses a flat `Record<string, string | undefined>` (typically `process.env` or
 * the `ExtensionContext.env`) into raw config input suitable for schema validation.
 *
 * Environment variable mapping:
 *
 * | Env Variable                        | Config Path                          |
 * |-------------------------------------|--------------------------------------|
 * | MC_SERVER_HOST                      | server.host                          |
 * | MC_SERVER_PORT                      | server.port                          |
 * | MC_SERVER_PUBLIC_URL                | server.publicUrl                     |
 * | MC_SERVER_TRUST_PROXY              | server.trustProxy                    |
 * | MC_SERVER_SECURE_COOKIES           | server.secureCookies                 |
 * | MC_DATABASE_URL                    | database.url                         |
 * | MC_DATABASE_AUTH_TOKEN             | database.authToken                   |
 * | MC_DATABASE_BACKUP_BUCKET_URL     | database.backupBucketUrl             |
 * | MC_DATABASE_BACKUP_BUCKET_REGION  | database.backupBucketRegion          |
 * | MC_DATABASE_BACKUP_ACCESS_KEY_ID  | database.backupAccessKeyId           |
 * | MC_DATABASE_BACKUP_SECRET_KEY     | database.backupSecretAccessKey       |
 * | MC_DATABASE_BACKUP_ROLE_ARN       | database.backupRoleArn               |
 * | MC_DATABASE_BACKUP_ENCRYPTION_KEY | database.backupEncryptionKey         |
 * | MC_AUTH_ISSUER                     | auth.issuer                          |
 * | MC_AUTH_SESSION_TTL_MINUTES       | auth.sessionTtlMinutes               |
 * | MC_AUTH_REFRESH_TTL_DAYS          | auth.refreshTtlDays                  |
 * | MC_AUTH_COOKIE_DOMAIN             | auth.cookieDomain                    |
 * | MC_AUTH_CSRF_SECRET               | auth.csrfSecret                      |
 * | MC_AUTH_BOOTSTRAP_ADMIN_EMAIL     | auth.bootstrapAdmin.email            |
 * | MC_AUTH_BOOTSTRAP_ADMIN_PASSWORD  | auth.bootstrapAdmin.password         |
 * | MC_AUTH_BOOTSTRAP_ADMIN_NAME      | auth.bootstrapAdmin.displayName      |
 * | MC_SMTP_HOST                      | smtp.host                            |
 * | MC_SMTP_PORT                      | smtp.port                            |
 * | MC_SMTP_SECURE                    | smtp.secure                          |
 * | MC_SMTP_USERNAME                  | smtp.username                        |
 * | MC_SMTP_PASSWORD                  | smtp.password                        |
 * | MC_SMTP_FROM                      | smtp.from                            |
 * | MC_RATE_LIMIT_AUTH                | rateLimit.authPerMinute               |
 * | MC_RATE_LIMIT_API                 | rateLimit.apiPerMinute                |
 * | MC_RATE_LIMIT_WS                  | rateLimit.wsPerMinute                 |
 * | MC_RETENTION_RAW_HOURS            | retention.rawSamplesHours             |
 * | MC_RETENTION_1M_HOURS             | retention.minuteAggregatesHours       |
 * | MC_RETENTION_5M_DAYS              | retention.fiveMinuteAggregatesDays    |
 * | MC_RETENTION_1H_DAYS              | retention.hourlyAggregatesDays        |
 * | MC_RETENTION_1D_DAYS              | retention.dailyAggregatesDays         |
 * | MC_RETENTION_EVENT_DAYS           | retention.eventDays                   |
 * | MC_RETENTION_ALERT_DAYS           | retention.alertDays                   |
 * | MC_RETENTION_AUDIT_DAYS           | retention.auditDays                   |
 * | MC_RETENTION_JOB_DAYS             | retention.jobDays                     |
 * | MC_CLUSTERS                       | clusters (JSON array)                 |
 */
export function parseEnvToRawConfig(env: Record<string, string | undefined>): Record<string, unknown> {
  const optStr = (key: string): string | undefined => env[key] || undefined;
  const optInt = (key: string): number | undefined => {
    const v = env[key];
    if (v === undefined || v === '') return undefined;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
  };
  const optFloat = (key: string): number | undefined => {
    const v = env[key];
    if (v === undefined || v === '') return undefined;
    const n = parseFloat(v);
    return Number.isNaN(n) ? undefined : n;
  };
  const optBool = (key: string): boolean | undefined => {
    const v = env[key];
    if (v === undefined || v === '') return undefined;
    return v === 'true' || v === '1' || v === 'yes';
  };

  const raw: Record<string, unknown> = {};

  // Server
  const server: Record<string, unknown> = {};
  const sHost = optStr('MC_SERVER_HOST');
  if (sHost !== undefined) server['host'] = sHost;
  const sPort = optInt('MC_SERVER_PORT');
  if (sPort !== undefined) server['port'] = sPort;
  const sPub = optStr('MC_SERVER_PUBLIC_URL');
  if (sPub !== undefined) server['publicUrl'] = sPub;
  const sTrust = optBool('MC_SERVER_TRUST_PROXY');
  if (sTrust !== undefined) server['trustProxy'] = sTrust;
  const sSecure = optBool('MC_SERVER_SECURE_COOKIES');
  if (sSecure !== undefined) server['secureCookies'] = sSecure;
  if (Object.keys(server).length > 0) raw['server'] = server;

  // Database
  const database: Record<string, unknown> = {};
  const dbUrl = optStr('MC_DATABASE_URL');
  if (dbUrl !== undefined) database['url'] = dbUrl;
  const dbAuth = optStr('MC_DATABASE_AUTH_TOKEN');
  if (dbAuth !== undefined) database['authToken'] = dbAuth;
  const dbBackup = optStr('MC_DATABASE_BACKUP_BUCKET_URL');
  if (dbBackup !== undefined) database['backupBucketUrl'] = dbBackup;
  const dbRegion = optStr('MC_DATABASE_BACKUP_BUCKET_REGION');
  if (dbRegion !== undefined) database['backupBucketRegion'] = dbRegion;
  const dbAk = optStr('MC_DATABASE_BACKUP_ACCESS_KEY_ID');
  if (dbAk !== undefined) database['backupAccessKeyId'] = dbAk;
  const dbSk = optStr('MC_DATABASE_BACKUP_SECRET_KEY');
  if (dbSk !== undefined) database['backupSecretAccessKey'] = dbSk;
  const dbArn = optStr('MC_DATABASE_BACKUP_ROLE_ARN');
  if (dbArn !== undefined) database['backupRoleArn'] = dbArn;
  const dbEnc = optStr('MC_DATABASE_BACKUP_ENCRYPTION_KEY');
  if (dbEnc !== undefined) database['backupEncryptionKey'] = dbEnc;
  if (Object.keys(database).length > 0) raw['database'] = database;

  // Auth
  const auth: Record<string, unknown> = {};
  const aIssuer = optStr('MC_AUTH_ISSUER');
  if (aIssuer !== undefined) auth['issuer'] = aIssuer;
  const aSession = optInt('MC_AUTH_SESSION_TTL_MINUTES');
  if (aSession !== undefined) auth['sessionTtlMinutes'] = aSession;
  const aRefresh = optInt('MC_AUTH_REFRESH_TTL_DAYS');
  if (aRefresh !== undefined) auth['refreshTtlDays'] = aRefresh;
  const aCookieDomain = optStr('MC_AUTH_COOKIE_DOMAIN');
  if (aCookieDomain !== undefined) auth['cookieDomain'] = aCookieDomain;
  const aCsrf = optStr('MC_AUTH_CSRF_SECRET');
  if (aCsrf !== undefined) auth['csrfSecret'] = aCsrf;

  const bootstrap: Record<string, unknown> = {};
  const bEmail = optStr('MC_AUTH_BOOTSTRAP_ADMIN_EMAIL');
  if (bEmail !== undefined) bootstrap['email'] = bEmail;
  const bPass = optStr('MC_AUTH_BOOTSTRAP_ADMIN_PASSWORD');
  if (bPass !== undefined) bootstrap['password'] = bPass;
  const bName = optStr('MC_AUTH_BOOTSTRAP_ADMIN_NAME');
  if (bName !== undefined) bootstrap['displayName'] = bName;
  if (Object.keys(bootstrap).length > 0) auth['bootstrapAdmin'] = bootstrap;
  if (Object.keys(auth).length > 0) raw['auth'] = auth;

  // SMTP
  const smtp: Record<string, unknown> = {};
  const smtpHost = optStr('MC_SMTP_HOST');
  if (smtpHost !== undefined) smtp['host'] = smtpHost;
  const smtpPort = optInt('MC_SMTP_PORT');
  if (smtpPort !== undefined) smtp['port'] = smtpPort;
  const smtpSecure = optBool('MC_SMTP_SECURE');
  if (smtpSecure !== undefined) smtp['secure'] = smtpSecure;
  const smtpUser = optStr('MC_SMTP_USERNAME');
  if (smtpUser !== undefined) smtp['username'] = smtpUser;
  const smtpPass = optStr('MC_SMTP_PASSWORD');
  if (smtpPass !== undefined) smtp['password'] = smtpPass;
  const smtpFrom = optStr('MC_SMTP_FROM');
  if (smtpFrom !== undefined) smtp['from'] = smtpFrom;
  if (Object.keys(smtp).length > 0) raw['smtp'] = smtp;

  // Rate limit
  const rateLimit: Record<string, unknown> = {};
  const rlAuth = optInt('MC_RATE_LIMIT_AUTH');
  if (rlAuth !== undefined) rateLimit['authPerMinute'] = rlAuth;
  const rlApi = optInt('MC_RATE_LIMIT_API');
  if (rlApi !== undefined) rateLimit['apiPerMinute'] = rlApi;
  const rlWs = optInt('MC_RATE_LIMIT_WS');
  if (rlWs !== undefined) rateLimit['wsPerMinute'] = rlWs;
  if (Object.keys(rateLimit).length > 0) raw['rateLimit'] = rateLimit;

  // Retention
  const retention: Record<string, unknown> = {};
  const rRaw = optFloat('MC_RETENTION_RAW_HOURS');
  if (rRaw !== undefined) retention['rawSamplesHours'] = rRaw;
  const r1m = optFloat('MC_RETENTION_1M_HOURS');
  if (r1m !== undefined) retention['minuteAggregatesHours'] = r1m;
  const r5m = optFloat('MC_RETENTION_5M_DAYS');
  if (r5m !== undefined) retention['fiveMinuteAggregatesDays'] = r5m;
  const r1h = optFloat('MC_RETENTION_1H_DAYS');
  if (r1h !== undefined) retention['hourlyAggregatesDays'] = r1h;
  const r1d = optFloat('MC_RETENTION_1D_DAYS');
  if (r1d !== undefined) retention['dailyAggregatesDays'] = r1d;
  const rEvent = optFloat('MC_RETENTION_EVENT_DAYS');
  if (rEvent !== undefined) retention['eventDays'] = rEvent;
  const rAlert = optFloat('MC_RETENTION_ALERT_DAYS');
  if (rAlert !== undefined) retention['alertDays'] = rAlert;
  const rAudit = optFloat('MC_RETENTION_AUDIT_DAYS');
  if (rAudit !== undefined) retention['auditDays'] = rAudit;
  const rJob = optFloat('MC_RETENTION_JOB_DAYS');
  if (rJob !== undefined) retention['jobDays'] = rJob;
  if (Object.keys(retention).length > 0) raw['retention'] = retention;

  // Clusters (JSON array from env)
  const clustersJson = optStr('MC_CLUSTERS');
  if (clustersJson !== undefined) {
    try {
      const parsed: unknown = JSON.parse(clustersJson);
      if (Array.isArray(parsed)) {
        raw['clusters'] = parsed;
      }
    } catch {
      // Invalid JSON is caught later during Zod validation via empty array default
    }
  }

  return raw;
}
