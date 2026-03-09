/**
 * NestJS module that wires up the complete cluster connectivity layer.
 *
 * Provides SSE streaming, REST client, state management, aggregation,
 * and the main connector orchestrator. Imports the PersistenceModule
 * for metric writes and the ConfigModule for cluster configuration.
 */

import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/PersistenceModule.js';
import { MemberRestClient } from './MemberRestClient.js';
import { ClusterStateStore } from './ClusterStateStore.js';
import { AggregationEngine } from './AggregationEngine.js';
import { ClusterConnectorService } from './ClusterConnectorService.js';

@Module({
  imports: [PersistenceModule],
  providers: [
    MemberRestClient,
    ClusterStateStore,
    AggregationEngine,
    ClusterConnectorService,
  ],
  exports: [
    ClusterConnectorService,
    ClusterStateStore,
    AggregationEngine,
    MemberRestClient,
  ],
})
export class ClusterConnectorModule {}
