/**
 * NestJS module for real-time WebSocket communication.
 *
 * Wires up the WebSocket gateway, heartbeat service, and history query
 * handler. Depends on AuthModule for ticket/session validation,
 * ClusterConnectorModule for live cluster state, and PersistenceModule
 * for historical metric queries.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/AuthModule.js';
import { ClusterConnectorModule } from '../connector/ClusterConnectorModule.js';
import { PersistenceModule } from '../persistence/PersistenceModule.js';
import { WsHeartbeatService } from './WsHeartbeatService.js';
import { HistoryQueryService } from './HistoryQueryService.js';
import { DashboardGateway } from './DashboardGateway.js';

@Module({
  imports: [
    AuthModule,
    ClusterConnectorModule,
    PersistenceModule,
  ],
  providers: [
    WsHeartbeatService,
    HistoryQueryService,
    DashboardGateway,
  ],
  exports: [
    DashboardGateway,
    WsHeartbeatService,
  ],
})
export class RealtimeModule {}
