/**
 * WebSocket protocol encoding/decoding utilities.
 *
 * Provides runtime validation for incoming client messages and encoding
 * of outgoing server messages. All messages use a simple JSON envelope
 * with an `event` discriminator and typed `data` payload.
 */

import type {
  ClientMessage,
  ClientMessageEvent,
  ServerMessageEvent,
  WsSubscribeData,
  WsUnsubscribeData,
  WsHistoryQueryData,
} from '../shared/types.js';

const VALID_CLIENT_EVENTS = new Set<ClientMessageEvent>(['subscribe', 'unsubscribe', 'query:history']);

/**
 * Parses and validates a raw JSON string into a typed ClientMessage.
 * Returns null if the message is malformed or has an unrecognised event.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;

  const msg = parsed as Record<string, unknown>;
  const event = msg['event'];
  const data = msg['data'];

  if (typeof event !== 'string' || !VALID_CLIENT_EVENTS.has(event as ClientMessageEvent)) {
    return null;
  }

  if (typeof data !== 'object' || data === null) return null;

  const payload = data as Record<string, unknown>;

  switch (event) {
    case 'subscribe':
      return validateSubscribe(payload);
    case 'unsubscribe':
      return validateUnsubscribe(payload);
    case 'query:history':
      return validateHistoryQuery(payload);
    default:
      return null;
  }
}

/**
 * Encodes a server message into a JSON string for transmission.
 */
export function encodeServerMessage(event: ServerMessageEvent, data: unknown): string {
  return JSON.stringify({ event, data });
}

function validateSubscribe(data: Record<string, unknown>): ClientMessage | null {
  const clusterId = data['clusterId'];
  if (typeof clusterId !== 'string' || clusterId.length === 0) return null;

  const scope = data['scope'];
  const validatedScope = typeof scope === 'string' && scope.length > 0 ? scope : 'all';

  const subscribeData: WsSubscribeData = { clusterId, scope: validatedScope };
  return { event: 'subscribe', data: subscribeData };
}

function validateUnsubscribe(data: Record<string, unknown>): ClientMessage | null {
  const clusterId = data['clusterId'];
  if (typeof clusterId !== 'string' || clusterId.length === 0) return null;

  const unsubData: WsUnsubscribeData = { clusterId };
  return { event: 'unsubscribe', data: unsubData };
}

function validateHistoryQuery(data: Record<string, unknown>): ClientMessage | null {
  const requestId = data['requestId'];
  if (typeof requestId !== 'string' || requestId.length === 0) return null;

  const clusterId = data['clusterId'];
  if (typeof clusterId !== 'string' || clusterId.length === 0) return null;

  const memberAddr = data['memberAddr'];
  if (memberAddr !== null && typeof memberAddr !== 'string') return null;

  const from = data['from'];
  if (typeof from !== 'number' || !Number.isFinite(from) || from < 0) return null;

  const to = data['to'];
  if (typeof to !== 'number' || !Number.isFinite(to) || to < 0) return null;

  if (from >= to) return null;

  const maxPoints = data['maxPoints'];
  if (typeof maxPoints !== 'number' || !Number.isFinite(maxPoints) || maxPoints < 1) return null;

  const historyData: WsHistoryQueryData = {
    requestId,
    clusterId,
    memberAddr: typeof memberAddr === 'string' ? memberAddr : null,
    from,
    to,
    maxPoints: Math.min(Math.floor(maxPoints), 10_000),
  };

  return { event: 'query:history', data: historyData };
}
