/**
 * NestJS module that wires up the complete alerting and notification layer.
 *
 * Provides the alert evaluation engine, metric path resolution, rule
 * evaluation, notification delivery with circuit breaking and rate
 * limiting, and email/webhook channels. Imports persistence for
 * database access and the cluster connector for state inspection.
 */

import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/PersistenceModule.js';
import { ClusterConnectorModule } from '../connector/ClusterConnectorModule.js';
import { MetricPathResolver } from './MetricPathResolver.js';
import { RuleEvaluator } from './RuleEvaluator.js';
import { AlertEngine } from './AlertEngine.js';
import { NotificationRateLimiter } from './NotificationRateLimiter.js';
import { EmailNotificationChannel } from './EmailNotificationChannel.js';
import { WebhookNotificationChannel } from './WebhookNotificationChannel.js';
import { NotificationService } from './NotificationService.js';

@Module({
  imports: [PersistenceModule, ClusterConnectorModule],
  providers: [
    MetricPathResolver,
    RuleEvaluator,
    AlertEngine,
    NotificationRateLimiter,
    EmailNotificationChannel,
    WebhookNotificationChannel,
    NotificationService,
  ],
  exports: [AlertEngine, NotificationService],
})
export class AlertsModule {}
