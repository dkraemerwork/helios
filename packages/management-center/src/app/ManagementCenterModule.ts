/**
 * Root NestJS module for the Helios Management Center.
 *
 * This module is the composition root that imports all feature modules,
 * registers all API controllers, and configures the global session
 * authentication guard.
 */

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';

// Feature modules
import { ConfigModule } from '../config/ConfigModule.js';
import { PersistenceModule } from '../persistence/PersistenceModule.js';
import { AuthModule } from '../auth/AuthModule.js';
import { ClusterConnectorModule } from '../connector/ClusterConnectorModule.js';
import { AlertsModule } from '../alerts/AlertsModule.js';
import { JobsModule } from '../jobs/JobsModule.js';
import { AdminModule } from '../admin/AdminModule.js';
import { RealtimeModule } from '../realtime/RealtimeModule.js';
import { SsrModule } from '../ssr/SsrModule.js';

// App-level components
import { HealthController } from './HealthController.js';
import { AppShutdown } from './AppShutdown.js';

// API controllers (AuthController and AdminController are provided by their modules)
import { ClustersController } from '../api/ClustersController.js';
import { MetricsController } from '../api/MetricsController.js';
import { DataStructuresController } from '../api/DataStructuresController.js';
import { AlertsController } from '../api/AlertsController.js';
import { EventsController } from '../api/EventsController.js';
import { JobsController } from '../api/JobsController.js';
import { AuditController } from '../api/AuditController.js';
import { ConfigController } from '../api/ConfigController.js';

// Global guard
import { SessionAuthGuard } from '../api/SessionAuthGuard.js';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ConfigModule,
    PersistenceModule,
    AuthModule,
    ClusterConnectorModule,
    AlertsModule,
    JobsModule,
    AdminModule,
    RealtimeModule,
    SsrModule,
  ],
  controllers: [
    HealthController,
    ClustersController,
    MetricsController,
    DataStructuresController,
    AlertsController,
    EventsController,
    JobsController,
    AuditController,
    ConfigController,
  ],
  providers: [
    AppShutdown,
    SessionAuthGuard,
    {
      provide: APP_GUARD,
      useClass: SessionAuthGuard,
    },
  ],
})
export class ManagementCenterModule {}
