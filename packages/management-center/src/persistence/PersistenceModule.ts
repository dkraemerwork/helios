/**
 * NestJS module providing the complete persistence layer.
 *
 * On initialization, runs database migrations and bootstraps the admin user
 * from configuration if no users exist yet. All persistence services are
 * exported for injection into other modules.
 */

import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { TursoConnectionFactory } from './TursoConnectionFactory.js';
import { MigrationRunner } from './MigrationRunner.js';
import { AsyncSerialQueue } from './AsyncSerialQueue.js';
import { WriteBatcher } from './WriteBatcher.js';
import { MetricsRepository } from './MetricsRepository.js';
import { AuthRepository } from './AuthRepository.js';
import { AuditRepository } from './AuditRepository.js';
import { BackupScheduler } from './BackupScheduler.js';
import { BackupUploader } from './BackupUploader.js';
import { DownsampleScheduler } from './DownsampleScheduler.js';
import { RetentionScheduler } from './RetentionScheduler.js';
import { ConfigService } from '../config/ConfigService.js';
import { nowMs } from '../shared/time.js';
import * as crypto from 'crypto';

@Module({
  providers: [
    TursoConnectionFactory,
    MigrationRunner,
    AsyncSerialQueue,
    WriteBatcher,
    MetricsRepository,
    AuthRepository,
    AuditRepository,
    BackupScheduler,
    BackupUploader,
    DownsampleScheduler,
    RetentionScheduler,
  ],
  exports: [
    TursoConnectionFactory,
    MigrationRunner,
    AsyncSerialQueue,
    WriteBatcher,
    MetricsRepository,
    AuthRepository,
    AuditRepository,
    BackupScheduler,
    BackupUploader,
    DownsampleScheduler,
    RetentionScheduler,
  ],
})
export class PersistenceModule implements OnModuleInit {
  private readonly logger = new Logger(PersistenceModule.name);

  constructor(
    private readonly migrationRunner: MigrationRunner,
    private readonly authRepository: AuthRepository,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Run database migrations
    this.logger.log('Running database migrations...');
    await this.migrationRunner.run();
    this.logger.log('Database migrations complete');

    // Bootstrap admin user if no users exist
    await this.bootstrapAdminUser();
  }

  /**
   * Creates the initial admin user from configuration if the users table is empty.
   * Uses argon2 for password hashing.
   */
  private async bootstrapAdminUser(): Promise<void> {
    const userCount = await this.authRepository.countUsers();
    if (userCount > 0) {
      this.logger.log('Users already exist, skipping admin bootstrap');
      return;
    }

    const email = this.configService.bootstrapAdminEmail;
    const password = this.configService.bootstrapAdminPassword;
    const displayName = this.configService.bootstrapAdminDisplayName;

    try {
      const argon2 = await import('argon2');
      const passwordHash = await argon2.hash(password);
      const now = nowMs();

      await this.authRepository.createUser({
        id: crypto.randomUUID(),
        email,
        displayName,
        passwordHash,
        status: 'active',
        roles: ['admin'],
        clusterScopes: [],
        createdAt: now,
        updatedAt: now,
      });

      this.logger.log(`Bootstrap admin user created: ${email}`);
    } catch (err) {
      this.logger.error(
        `Failed to bootstrap admin user: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
