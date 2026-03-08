/**
 * Block C — TLS Configuration for the Client Protocol Server
 *
 * Provides TLS/mTLS configuration for the client-facing TCP listener.
 * Configuration may supply certificate material as file paths or inline PEM
 * strings; TlsConfig normalises both forms into resolved PEM buffers.
 *
 * Supports:
 *   - One-way TLS: server presents cert; client does NOT send one.
 *   - Mutual TLS (mTLS): both server and client present certificates.
 *     If the client does not present a cert when mTLS is required, the
 *     connection is rejected with an explicit error message.
 *
 * TLS is OPTIONAL: if no TLS configuration is provided the listener starts
 * in plain-TCP mode (matching Hazelcast's default behaviour for non-enterprise
 * deployments).
 *
 * Integration:
 *   - ClientProtocolServerOptions.tls accepts a TlsConfig.
 *   - ClientProtocolServer passes it to Bun.listen() / Bun.serveRaw().
 *
 * Port of Hazelcast Enterprise's {@code SSLConfig} + {@code SSLContextFactory}.
 */

import { readFileSync } from 'node:fs';

// ── Raw config DF inputs ──────────────────────────────────────────────────────

/**
 * Raw TLS configuration as provided by the caller.
 * Fields may be file paths (ending in .pem / .crt / .key) or inline PEM strings.
 */
export interface TlsConfigInput {
    /**
     * Server certificate (PEM string or path to .pem / .crt file).
     * Required.
     */
    cert: string;

    /**
     * Server private key (PEM string or path to .key / .pem file).
     * Required.
     */
    key: string;

    /**
     * Certificate Authority / trust store (PEM string or path).
     * Required for mTLS (client certificate validation).
     * Optional for one-way TLS.
     */
    ca?: string;

    /**
     * Require clients to present a valid certificate signed by `ca`.
     * Defaults to false (one-way TLS).
     * If true and no `ca` is provided, configuration is rejected.
     */
    requireClientCert?: boolean;

    /**
     * Minimum TLS version to accept.  Bun maps this to the corresponding
     * OpenSSL option.  Defaults to 'TLSv1.2'.
     */
    minVersion?: 'TLSv1.2' | 'TLSv1.3';
}

// ── Resolved config ───────────────────────────────────────────────────────────

/**
 * Fully-resolved TLS configuration with PEM buffers ready for use by the
 * Bun TLS listener.
 */
export interface ResolvedTlsConfig {
    cert: string;
    key: string;
    ca: string | undefined;
    requireClientCert: boolean;
    minVersion: 'TLSv1.2' | 'TLSv1.3';
}

// ── TlsConfigError ────────────────────────────────────────────────────────────

export class TlsConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TlsConfigError';
    }
}

// ── TlsConfig ─────────────────────────────────────────────────────────────────

/**
 * Immutable TLS configuration for the client protocol server.
 *
 * Construction validates the configuration (e.g. mTLS without a CA is
 * rejected immediately so the error surfaces at startup time).
 *
 * @example
 * ```ts
 * const tls = TlsConfig.fromInput({
 *   cert: '/etc/helios/server.crt',
 *   key:  '/etc/helios/server.key',
 *   ca:   '/etc/helios/ca.crt',
 *   requireClientCert: true,
 * });
 * ```
 */
export class TlsConfig {
    private readonly _resolved: ResolvedTlsConfig;

    private constructor(resolved: ResolvedTlsConfig) {
        this._resolved = resolved;
    }

    // ── Factory ───────────────────────────────────────────────────────────────

    /**
     * Build a TlsConfig from raw input, resolving file paths to PEM strings.
     *
     * @throws TlsConfigError if the configuration is invalid.
     */
    static fromInput(input: TlsConfigInput): TlsConfig {
        const cert = TlsConfig._resolvePem(input.cert, 'cert');
        const key  = TlsConfig._resolvePem(input.key, 'key');

        let ca: string | undefined;
        if (input.ca !== undefined) {
            ca = TlsConfig._resolvePem(input.ca, 'ca');
        }

        const requireClientCert = input.requireClientCert ?? false;

        if (requireClientCert && ca === undefined) {
            throw new TlsConfigError(
                'TLS mTLS requires a CA certificate (ca) to validate client certificates. ' +
                'Either provide a ca or set requireClientCert to false.',
            );
        }

        return new TlsConfig({
            cert,
            key,
            ca,
            requireClientCert,
            minVersion: input.minVersion ?? 'TLSv1.2',
        });
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    getServerCert(): string {
        return this._resolved.cert;
    }

    getServerKey(): string {
        return this._resolved.key;
    }

    getCa(): string | undefined {
        return this._resolved.ca;
    }

    isClientCertRequired(): boolean {
        return this._resolved.requireClientCert;
    }

    isMutualTls(): boolean {
        return this._resolved.requireClientCert && this._resolved.ca !== undefined;
    }

    getMinVersion(): 'TLSv1.2' | 'TLSv1.3' {
        return this._resolved.minVersion;
    }

    /**
     * Returns a Bun-compatible TLS options object that can be spread into
     * Bun.listen() options.
     */
    toBunTlsOptions(): {
        cert: string;
        key: string;
        ca?: string;
        requestCert: boolean;
        rejectUnauthorized: boolean;
    } {
        return {
            cert: this._resolved.cert,
            key: this._resolved.key,
            ...(this._resolved.ca !== undefined ? { ca: this._resolved.ca } : {}),
            requestCert: this._resolved.requireClientCert,
            rejectUnauthorized: this._resolved.requireClientCert,
        };
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * If the string looks like a PEM block, return it as-is.
     * Otherwise, treat it as a file path and read the file.
     */
    private static _resolvePem(value: string, fieldName: string): string {
        const trimmed = value.trim();

        // Inline PEM strings start with '-----BEGIN'
        if (trimmed.startsWith('-----BEGIN')) {
            return trimmed;
        }

        // Treat as a file path
        try {
            return readFileSync(trimmed, 'utf-8');
        } catch (err) {
            throw new TlsConfigError(
                `TLS configuration error: could not read ${fieldName} file at '${trimmed}': ` +
                `${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}
