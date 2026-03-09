/**
 * NestJS module for job monitoring, topology serialization, and snapshot persistence.
 *
 * Imports PersistenceModule for database access and ClusterConnectorModule for
 * fetching job data from Helios cluster members. Exports JobsService and
 * TopologySerializer for use by the admin module and WebSocket gateway.
 */

import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/PersistenceModule.js';
import { ClusterConnectorModule } from '../connector/ClusterConnectorModule.js';
import { TopologySerializer } from './TopologySerializer.js';
import { JobsService } from './JobsService.js';

@Module({
  imports: [PersistenceModule, ClusterConnectorModule],
  providers: [TopologySerializer, JobsService],
  exports: [JobsService, TopologySerializer],
})
export class JobsModule {}
