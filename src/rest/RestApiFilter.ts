import { RestApiConfig } from '@zenystx/helios-core/config/RestApiConfig';
import { RestEndpointGroup } from '@zenystx/helios-core/rest/RestEndpointGroup';

/**
 * Maps URL path prefixes to RestEndpointGroups and enforces group-level access control.
 *
 * - Returns `null` when the request may proceed to a handler.
 * - Returns a `Response` with 403 when the matched group is disabled.
 * - Returns a `Response` with 404 when no group matches the path.
 */

/** Ordered prefix → group mapping. Longer prefixes should come first for specificity. */
const PATH_GROUP_MAP: ReadonlyArray<[string, RestEndpointGroup]> = [
    ['/hazelcast/health',                RestEndpointGroup.HEALTH_CHECK],
    ['/hazelcast/rest/cluster',          RestEndpointGroup.CLUSTER_READ],
    ['/hazelcast/rest/instance',         RestEndpointGroup.CLUSTER_READ],
    ['/hazelcast/rest/log-level',        RestEndpointGroup.CLUSTER_WRITE],
    ['/hazelcast/rest/management',       RestEndpointGroup.CLUSTER_WRITE],
    ['/hazelcast/rest/maps',             RestEndpointGroup.DATA],
    ['/hazelcast/rest/queues',           RestEndpointGroup.DATA],
    ['/helios/monitor',                  RestEndpointGroup.MONITOR],
];

const DISABLED_GROUP_BODY = JSON.stringify({
    status: 403,
    message: 'This REST endpoint group is disabled. Enable it via RestApiConfig.',
});
const UNKNOWN_PATH_BODY = JSON.stringify({
    status: 404,
    message: 'Unknown REST endpoint.',
});
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export class RestApiFilter {
    constructor(private readonly _config: RestApiConfig) {}

    /** Returns the RestEndpointGroup for a given URL pathname, or null if unknown. */
    getGroupForPath(pathname: string): RestEndpointGroup | null {
        for (const [prefix, group] of PATH_GROUP_MAP) {
            if (pathname === prefix || pathname.startsWith(prefix + '/')) {
                return group;
            }
        }
        return null;
    }

    /**
     * Filters an incoming request.
     * Returns a Response (403 or 404) if the request should be blocked,
     * or null if the request should proceed to the handler.
     */
    filter(req: Request): Response | null {
        const pathname = new URL(req.url).pathname;
        const group = this.getGroupForPath(pathname);

        if (group === null) {
            return new Response(UNKNOWN_PATH_BODY, { status: 404, headers: JSON_HEADERS });
        }

        if (!this._config.isGroupEnabled(group)) {
            return new Response(DISABLED_GROUP_BODY, { status: 403, headers: JSON_HEADERS });
        }

        return null;
    }
}
