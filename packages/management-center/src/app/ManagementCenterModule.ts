/**
 * Root NestJS module for the Helios Management Center.
 *
 * This module is the composition root that imports all feature modules.
 * Additional modules (persistence, auth, connector, alerts, admin, realtime,
 * SSR) will be added as they are implemented in subsequent steps.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/ConfigModule.js';

@Module({
  imports: [
    ConfigModule,
  ],
})
export class ManagementCenterModule {}
