/**
 * NestJS module for cluster, job, and data structure administration.
 *
 * Imports PersistenceModule for audit logging, ClusterConnectorModule for
 * member REST communication, and AuthModule for CSRF/RBAC guards.
 * Exports the three admin services for use by other modules.
 */

import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/PersistenceModule.js';
import { ClusterConnectorModule } from '../connector/ClusterConnectorModule.js';
import { AuthModule } from '../auth/AuthModule.js';
import { ClusterAdminService } from './ClusterAdminService.js';
import { JobAdminService } from './JobAdminService.js';
import { ObjectAdminService } from './ObjectAdminService.js';
import { AdminController } from './AdminController.js';

@Module({
  imports: [PersistenceModule, ClusterConnectorModule, AuthModule],
  controllers: [AdminController],
  providers: [ClusterAdminService, JobAdminService, ObjectAdminService],
  exports: [ClusterAdminService, JobAdminService, ObjectAdminService],
})
export class AdminModule {}
