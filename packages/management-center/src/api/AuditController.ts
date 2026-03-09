/**
 * REST controller for querying the audit log.
 *
 * All administrative actions, authentication events, and configuration
 * changes are recorded in the audit log. This controller provides
 * filtered, cursor-paginated access restricted to admin users.
 */

import {
  Controller,
  Get,
  Logger,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RbacGuard, RequireRoles } from '../auth/RbacGuard.js';
import { AuditRepository, type AuditQueryFilters } from '../persistence/AuditRepository.js';
import { NotFoundError, ValidationError } from '../shared/errors.js';
import { clampPageSize } from '../shared/formatters.js';
import { MAX_HISTORY_PAGE_SIZE } from '../shared/constants.js';
import type { AuditLogEntry, CursorPaginatedResult } from '../shared/types.js';

@Controller('api/audit')
@UseGuards(RbacGuard)
export class AuditController {
  private readonly logger = new Logger(AuditController.name);

  constructor(private readonly auditRepo: AuditRepository) {}

  // ── GET /api/audit ─────────────────────────────────────────────────────

  @Get()
  @RequireRoles('admin')
  async queryAuditLog(
    @Query('actorUserId') actorUserId?: string,
    @Query('clusterId') clusterId?: string,
    @Query('actionType') actionType?: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ): Promise<CursorPaginatedResult<AuditLogEntry>> {
    const limit = clampPageSize(parseInt(limitStr ?? '50', 10) || 50, MAX_HISTORY_PAGE_SIZE);

    const filters: AuditQueryFilters = {};
    if (actorUserId) filters.actorUserId = actorUserId;
    if (clusterId) filters.clusterId = clusterId;
    if (actionType) filters.actionType = actionType;
    if (fromStr) {
      const from = parseInt(fromStr, 10);
      if (Number.isNaN(from)) throw new ValidationError('from must be a valid timestamp');
      filters.from = from;
    }
    if (toStr) {
      const to = parseInt(toStr, 10);
      if (Number.isNaN(to)) throw new ValidationError('to must be a valid timestamp');
      filters.to = to;
    }

    return this.auditRepo.queryAuditLog(filters, limit, cursor);
  }

  // ── GET /api/audit/:id ─────────────────────────────────────────────────

  @Get(':id')
  @RequireRoles('admin')
  async getAuditEntry(@Param('id') idStr: string): Promise<AuditLogEntry> {
    const id = parseInt(idStr, 10);
    if (Number.isNaN(id)) {
      throw new ValidationError('id must be a valid number');
    }

    const entry = await this.auditRepo.getAuditEntryById(id);
    if (!entry) {
      throw new NotFoundError(`Audit entry ${id} not found`);
    }

    return entry;
  }
}
