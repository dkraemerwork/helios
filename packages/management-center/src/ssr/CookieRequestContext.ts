/**
 * Request context extraction for Angular SSR.
 *
 * Builds a serializable snapshot of the incoming HTTP request, including
 * parsed cookies, forwarded headers, and the resolved session/user data.
 * This context can be injected into the Angular SSR rendering pipeline
 * so that server-rendered components have access to auth state without
 * additional round-trips.
 */

import type { Session, User } from '../shared/types.js';

export interface RequestContext {
  url: string;
  cookies: Record<string, string>;
  headers: Record<string, string>;
  sessionId: string | null;
  user: SafeUser | null;
  userRoles: string[];
  clusterScopes: string[];
}

/**
 * Subset of User safe for serialization into transfer state.
 * Excludes sensitive fields like passwordHash.
 */
export interface SafeUser {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'disabled';
  roles: Array<'viewer' | 'operator' | 'admin'>;
  clusterScopes: string[];
}

/**
 * Parses the raw cookie header string into a key-value map.
 * Handles standard cookie format: `name=value; name2=value2`.
 */
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};

  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(';');

  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) continue;

    const name = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    if (name.length > 0) {
      cookies[name] = decodeURIComponent(value);
    }
  }

  return cookies;
}

/**
 * Strips sensitive headers that should not be exposed to the Angular SSR context.
 */
function sanitizeHeaders(rawHeaders: Record<string, string | string[] | undefined>): Record<string, string> {
  const sensitiveHeaders = new Set([
    'authorization',
    'cookie',
    'proxy-authorization',
    'x-forwarded-for',
    'x-real-ip',
  ]);

  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(rawHeaders)) {
    const lower = key.toLowerCase();
    if (sensitiveHeaders.has(lower) || value === undefined) continue;
    sanitized[lower] = Array.isArray(value) ? value.join(', ') : value;
  }

  return sanitized;
}

/**
 * Converts a full User object to a SafeUser by stripping passwordHash
 * and other internal fields.
 */
function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    roles: user.roles,
    clusterScopes: user.clusterScopes,
  };
}

/**
 * Creates a RequestContext from the raw Fastify/NestJS request and resolved
 * session data. This is the primary entry point used by AngularSsrController.
 */
export function createRequestContext(
  req: { url: string; headers: Record<string, string | string[] | undefined> },
  session: Session | null,
  user: User | null,
): RequestContext {
  const cookieHeader = req.headers['cookie'];
  const cookies = parseCookies(
    Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader,
  );

  return {
    url: req.url,
    cookies,
    headers: sanitizeHeaders(req.headers),
    sessionId: session?.id ?? null,
    user: user ? toSafeUser(user) : null,
    userRoles: user?.roles ?? [],
    clusterScopes: user?.clusterScopes ?? [],
  };
}
