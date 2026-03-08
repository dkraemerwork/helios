/**
 * Block A — Freeze The Baseline
 *
 * Single source of truth for the Hazelcast compatibility target.
 * Every later block that needs to know "which Hazelcast version are we targeting?"
 * imports from here instead of hard-coding strings or numbers.
 *
 * Hazelcast releases two versioned artefacts together:
 *   - The open-source server (hazelcast OSS jar)  — 5.5.x
 *   - The Node.js thin client (hazelcast-client npm) — 5.6.x
 *
 * The thin client version is intentionally one minor version ahead of the server
 * because the client SDK ships on a separate release cadence and embeds the
 * *client protocol* version negotiated at runtime.
 *
 * Client Protocol versioning:
 *   - Version 2.x is the multi-frame (new) Hazelcast binary protocol used by all
 *     5.x clients.  The exact protocol version number (2.8 for HZ 5.5) is sent
 *     in the serialisation-version byte of the authentication handshake.
 *   - The numeric representation stored here (280) follows Hazelcast's internal
 *     convention: major * 100 + minor.  It is compared against the server's
 *     advertised version during connection to validate wire compatibility.
 */

// ── npm package target ────────────────────────────────────────────────────────

/** The hazelcast-client npm package version we are targeting. */
export const CLIENT_NPM_VERSION = "5.6.0" as const;

/** Semantic version parts of the npm client target. */
export const CLIENT_NPM_VERSION_PARTS = Object.freeze({
    major: 5,
    minor: 6,
    patch: 0,
} as const);

// ── OSS server target ─────────────────────────────────────────────────────────

/** The Hazelcast OSS server version this client is designed to talk to. */
export const SERVER_OSS_VERSION = "5.5.0" as const;

/** Semantic version parts of the server target. */
export const SERVER_OSS_VERSION_PARTS = Object.freeze({
    major: 5,
    minor: 5,
    patch: 0,
} as const);

// ── Client protocol version ───────────────────────────────────────────────────

/**
 * The Hazelcast client protocol version in use.
 *
 * Protocol version history (client-protocol repo):
 *   2.0 — HZ 4.0 (multi-frame framing introduced)
 *   2.1 — HZ 4.1
 *   2.2 — HZ 4.2
 *   2.3 — HZ 5.0
 *   2.4 — HZ 5.1
 *   2.5 — HZ 5.2
 *   2.6 — HZ 5.3
 *   2.7 — HZ 5.4
 *   2.8 — HZ 5.5  ← our target
 */
export const CLIENT_PROTOCOL_VERSION = "2.8" as const;

/**
 * Numeric protocol version used in wire-level comparisons.
 * Convention: major * 100 + minor  →  2 * 100 + 8 = 208.
 *
 * Helios uses this when encoding/decoding the `clientHazelcastVersion`
 * field of the authentication message.
 */
export const CLIENT_PROTOCOL_VERSION_NUMBER = 208 as const;

/**
 * The serialisation-version byte written into the authentication request and
 * echoed back by the server in its authentication response.
 *
 * Value 1 = Hazelcast binary serialisation v1 (all 5.x releases).
 */
export const SERIALIZATION_VERSION = 1 as const;

// ── Cluster protocol constants ────────────────────────────────────────────────

/** Default partition count used by Hazelcast clusters. */
export const DEFAULT_PARTITION_COUNT = 271 as const;

/** Default heartbeat interval the client sends to keep the connection alive (ms). */
export const DEFAULT_CLIENT_HEARTBEAT_INTERVAL_MS = 5_000 as const;

/** Default heartbeat timeout after which the client declares the connection dead (ms). */
export const DEFAULT_CLIENT_HEARTBEAT_TIMEOUT_MS = 60_000 as const;

/** Default invocation timeout for client operations (ms). */
export const DEFAULT_INVOCATION_TIMEOUT_MS = 120_000 as const;

/** Default connection attempt limit before giving up. */
export const DEFAULT_CONNECTION_ATTEMPT_LIMIT = 2 as const;

/** Default retry delay between connection attempts (ms). */
export const DEFAULT_CONNECTION_ATTEMPT_PERIOD_MS = 3_000 as const;

// ── Composite descriptor (convenience re-export) ──────────────────────────────

/**
 * A frozen object that bundles all compatibility constants together.
 * Use this when you need to pass the full target as a single value.
 */
export const COMPATIBILITY_TARGET = Object.freeze({
    clientNpmVersion: CLIENT_NPM_VERSION,
    clientNpmVersionParts: CLIENT_NPM_VERSION_PARTS,
    serverOssVersion: SERVER_OSS_VERSION,
    serverOssVersionParts: SERVER_OSS_VERSION_PARTS,
    clientProtocolVersion: CLIENT_PROTOCOL_VERSION,
    clientProtocolVersionNumber: CLIENT_PROTOCOL_VERSION_NUMBER,
    serializationVersion: SERIALIZATION_VERSION,
    defaultPartitionCount: DEFAULT_PARTITION_COUNT,
    defaultClientHeartbeatIntervalMs: DEFAULT_CLIENT_HEARTBEAT_INTERVAL_MS,
    defaultClientHeartbeatTimeoutMs: DEFAULT_CLIENT_HEARTBEAT_TIMEOUT_MS,
    defaultInvocationTimeoutMs: DEFAULT_INVOCATION_TIMEOUT_MS,
    defaultConnectionAttemptLimit: DEFAULT_CONNECTION_ATTEMPT_LIMIT,
    defaultConnectionAttemptPeriodMs: DEFAULT_CONNECTION_ATTEMPT_PERIOD_MS,
} as const);

/** TypeScript type for the compatibility target descriptor. */
export type CompatibilityTarget = typeof COMPATIBILITY_TARGET;
