import { RestEndpointGroup } from '@helios/rest/RestEndpointGroup';

/**
 * Configuration for the built-in Helios REST API (Bun.serve()).
 *
 * Default enabled groups: HEALTH_CHECK + CLUSTER_READ.
 * The REST server only starts when both `isEnabled()` is true and at least
 * one group is enabled (`isEnabledAndNotEmpty()`).
 */
export class RestApiConfig {
    static readonly DEFAULT_PORT = 8080;
    static readonly DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

    private _enabled: boolean = false;
    private _port: number = RestApiConfig.DEFAULT_PORT;
    private _requestTimeoutMs: number = RestApiConfig.DEFAULT_REQUEST_TIMEOUT_MS;
    private _enabledGroups: Set<RestEndpointGroup> = new Set([
        RestEndpointGroup.HEALTH_CHECK,
        RestEndpointGroup.CLUSTER_READ,
    ]);

    isEnabled(): boolean { return this._enabled; }
    setEnabled(enabled: boolean): this { this._enabled = enabled; return this; }

    getPort(): number { return this._port; }
    setPort(port: number): this { this._port = port; return this; }

    getRequestTimeoutMs(): number { return this._requestTimeoutMs; }
    setRequestTimeoutMs(ms: number): this { this._requestTimeoutMs = ms; return this; }

    enableGroups(...groups: RestEndpointGroup[]): this {
        for (const g of groups) this._enabledGroups.add(g);
        return this;
    }

    disableGroups(...groups: RestEndpointGroup[]): this {
        for (const g of groups) this._enabledGroups.delete(g);
        return this;
    }

    enableAllGroups(): this {
        for (const g of Object.values(RestEndpointGroup)) this._enabledGroups.add(g);
        return this;
    }

    disableAllGroups(): this {
        this._enabledGroups.clear();
        return this;
    }

    isGroupEnabled(group: RestEndpointGroup): boolean {
        return this._enabledGroups.has(group);
    }

    getEnabledGroups(): ReadonlySet<RestEndpointGroup> {
        return this._enabledGroups;
    }

    isEnabledAndNotEmpty(): boolean {
        return this._enabled && this._enabledGroups.size > 0;
    }
}
