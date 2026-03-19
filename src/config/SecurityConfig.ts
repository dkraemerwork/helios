/**
 * Security configuration for Helios.
 *
 * Controls client permission enforcement, realm settings, and static token → permission mappings.
 *
 * Port of com.hazelcast.config.SecurityConfig
 */

// ── PermissionType enum ──────────────────────────────────────────────────────

export enum PermissionType {
    MAP = 'MAP',
    QUEUE = 'QUEUE',
    TOPIC = 'TOPIC',
    LIST = 'LIST',
    SET = 'SET',
    MULTIMAP = 'MULTIMAP',
    LOCK = 'LOCK',
    SEMAPHORE = 'SEMAPHORE',
    ATOMIC_LONG = 'ATOMIC_LONG',
    ATOMIC_REFERENCE = 'ATOMIC_REFERENCE',
    COUNTDOWN_LATCH = 'COUNTDOWN_LATCH',
    EXECUTOR_SERVICE = 'EXECUTOR_SERVICE',
    CACHE = 'CACHE',
    REPLICATED_MAP = 'REPLICATED_MAP',
    FLAKE_ID_GENERATOR = 'FLAKE_ID_GENERATOR',
    CARDINALITY_ESTIMATOR = 'CARDINALITY_ESTIMATOR',
    SCHEDULED_EXECUTOR = 'SCHEDULED_EXECUTOR',
    CP_MAP = 'CP_MAP',
    ALL = 'ALL',
}

// ── PermissionConfig ─────────────────────────────────────────────────────────

/**
 * Defines a single permission grant for a principal on a named data structure.
 *
 * Port of com.hazelcast.config.PermissionConfig
 */
export class PermissionConfig {
    private _type: PermissionType = PermissionType.ALL;
    /** Data structure name pattern — supports wildcards (e.g. "orders-*"). */
    private _name: string = '*';
    /** Principal this permission applies to — '*' means any principal. */
    private _principal: string = '*';
    /** List of action strings (e.g. ['read', 'write', 'create', 'destroy']). */
    private _actions: string[] = [];
    /** Client endpoint patterns that this permission applies to. */
    private _endpoints: string[] = [];

    getType(): PermissionType {
        return this._type;
    }

    setType(type: PermissionType): this {
        this._type = type;
        return this;
    }

    getName(): string {
        return this._name;
    }

    setName(name: string): this {
        this._name = name;
        return this;
    }

    getPrincipal(): string {
        return this._principal;
    }

    setPrincipal(principal: string): this {
        this._principal = principal;
        return this;
    }

    getActions(): string[] {
        return this._actions;
    }

    setActions(actions: string[]): this {
        this._actions = [...actions];
        return this;
    }

    addAction(action: string): this {
        this._actions.push(action);
        return this;
    }

    getEndpoints(): string[] {
        return this._endpoints;
    }

    setEndpoints(endpoints: string[]): this {
        this._endpoints = [...endpoints];
        return this;
    }

    addEndpoint(endpoint: string): this {
        this._endpoints.push(endpoint);
        return this;
    }
}

// ── TokenConfig ──────────────────────────────────────────────────────────────

/**
 * Maps a static token string to a principal and set of permission configs.
 *
 * Used by TokenAuthenticator for static token-based authentication.
 */
export class TokenConfig {
    private _token: string = '';
    private _principal: string = '';
    private _permissions: PermissionConfig[] = [];

    getToken(): string {
        return this._token;
    }

    setToken(token: string): this {
        this._token = token;
        return this;
    }

    getPrincipal(): string {
        return this._principal;
    }

    setPrincipal(principal: string): this {
        this._principal = principal;
        return this;
    }

    getPermissions(): PermissionConfig[] {
        return this._permissions;
    }

    setPermissions(permissions: PermissionConfig[]): this {
        this._permissions = [...permissions];
        return this;
    }

    addPermission(permission: PermissionConfig): this {
        this._permissions.push(permission);
        return this;
    }
}

// ── SecurityConfig ────────────────────────────────────────────────────────────

/**
 * Top-level security configuration.
 *
 * When enabled, the SecurityInterceptor enforces permission checks before
 * every client operation.  When disabled (default), all operations are
 * permitted without checking.
 */
export class SecurityConfig {
    /** Whether permission enforcement is active. Default: false. */
    private _enabled: boolean = false;
    /** Permission grants applied to all authenticated clients. */
    private _clientPermissionConfigs: PermissionConfig[] = [];
    /** Realm name used for member-to-member authentication. */
    private _memberRealm: string = 'default';
    /** Realm name used for client authentication. */
    private _clientRealm: string = 'default';
    /**
     * Static token → TokenConfig mapping.
     * Key: the raw token string.
     * Value: TokenConfig with principal and permissions.
     */
    private _tokenConfigs: Map<string, TokenConfig> = new Map();

    isEnabled(): boolean {
        return this._enabled;
    }

    setEnabled(enabled: boolean): this {
        this._enabled = enabled;
        return this;
    }

    getClientPermissionConfigs(): PermissionConfig[] {
        return this._clientPermissionConfigs;
    }

    setClientPermissionConfigs(configs: PermissionConfig[]): this {
        this._clientPermissionConfigs = [...configs];
        return this;
    }

    addClientPermissionConfig(config: PermissionConfig): this {
        this._clientPermissionConfigs.push(config);
        return this;
    }

    getMemberRealm(): string {
        return this._memberRealm;
    }

    setMemberRealm(realm: string): this {
        this._memberRealm = realm;
        return this;
    }

    getClientRealm(): string {
        return this._clientRealm;
    }

    setClientRealm(realm: string): this {
        this._clientRealm = realm;
        return this;
    }

    getTokenConfigs(): Map<string, TokenConfig> {
        return this._tokenConfigs;
    }

    addTokenConfig(tokenConfig: TokenConfig): this {
        this._tokenConfigs.set(tokenConfig.getToken(), tokenConfig);
        return this;
    }

    getTokenConfig(token: string): TokenConfig | null {
        return this._tokenConfigs.get(token) ?? null;
    }
}
