/**
 * One-time-use WebSocket authentication ticket service.
 *
 * Issues short-lived (30 s) cryptographic tickets that authenticate the
 * initial WebSocket handshake. Each ticket is consumed exactly once;
 * replay is impossible because consumption deletes the entry from memory.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { WS_TICKET_TTL_MS } from '../shared/constants.js';

interface TicketEntry {
  sessionId: string;
  userId: string;
  expiresAt: number;
}

@Injectable()
export class WsTicketService {
  private readonly logger = new Logger(WsTicketService.name);
  private readonly tickets = new Map<string, TicketEntry>();

  issueTicket(sessionId: string, userId: string): string {
    const ticket = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + WS_TICKET_TTL_MS;
    this.tickets.set(ticket, { sessionId, userId, expiresAt });
    return ticket;
  }

  consumeTicket(ticket: string): { sessionId: string; userId: string } | null {
    const entry = this.tickets.get(ticket);
    if (!entry) return null;

    this.tickets.delete(ticket);

    if (Date.now() > entry.expiresAt) return null;

    return { sessionId: entry.sessionId, userId: entry.userId };
  }

  @Interval(60_000)
  cleanup(): void {
    const now = Date.now();
    let removed = 0;
    for (const [ticket, entry] of this.tickets) {
      if (now > entry.expiresAt) {
        this.tickets.delete(ticket);
        removed++;
      }
    }
    if (removed > 0) {
      this.logger.debug(`Cleaned up ${removed} expired WS tickets`);
    }
  }
}
