/**
 * Static-token authenticator.
 *
 * Looks up an incoming token Buffer in a pre-configured map of token → TokenConfig,
 * and if found returns a fully-populated SecurityContext for that token's principal
 * and permissions.
 *
 * This authenticator supports simple shared-secret token schemes where tokens
 * are pre-provisioned in the SecurityConfig.  It is intentionally kept stateless
 * and synchronous for hot-path performance.
 *
 * Port of com.hazelcast.security.impl.TokenCredentialsAuthenticator (internal)
 */
import type { TokenConfig } from '../../config/SecurityConfig.js';
import { SecurityContext } from './SecurityContext.js';

export class TokenAuthenticator {
    private readonly _tokenConfigs: Map<string, TokenConfig>;

    /**
     * @param tokenConfigs  Map of raw token string → TokenConfig.
     *                      Typically sourced from SecurityConfig.getTokenConfigs().
     */
    constructor(tokenConfigs: Map<string, TokenConfig>) {
        this._tokenConfigs = tokenConfigs;
    }

    /**
     * Authenticate a token byte buffer.
     *
     * Decodes the buffer as a UTF-8 string and looks it up in the configured
     * token store.  Returns a SecurityContext if found, null otherwise.
     *
     * @param tokenBytes  The raw token bytes received from the client.
     * @param endpoint    The client endpoint string (IP:port), used in the context.
     */
    authenticate(tokenBytes: Buffer, endpoint: string = ''): SecurityContext | null {
        const token = tokenBytes.toString('utf8');
        const tokenConfig = this._tokenConfigs.get(token);
        if (tokenConfig === undefined) {
            return null;
        }
        return SecurityContext.fromPermissionConfigs(
            tokenConfig.getPrincipal(),
            tokenConfig.getPermissions(),
            endpoint,
        );
    }

    /**
     * Authenticate a token string directly.
     *
     * Convenience overload for callers that already have the token as a string.
     *
     * @param token     The raw token string.
     * @param endpoint  The client endpoint string.
     */
    authenticateToken(token: string, endpoint: string = ''): SecurityContext | null {
        const tokenConfig = this._tokenConfigs.get(token);
        if (tokenConfig === undefined) {
            return null;
        }
        return SecurityContext.fromPermissionConfigs(
            tokenConfig.getPrincipal(),
            tokenConfig.getPermissions(),
            endpoint,
        );
    }

    /**
     * Returns whether a token is known to this authenticator.
     */
    hasToken(token: string): boolean {
        return this._tokenConfigs.has(token);
    }
}
