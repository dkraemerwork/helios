const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * State provider interface for the cluster-read handler.
 * Implemented by HeliosInstanceImpl and injectable in tests.
 */
export interface ClusterReadState {
    getClusterName(): string;
    getClusterState(): string;
    getMemberCount(): number;
    getInstanceName(): string;
}

/**
 * Handles the CLUSTER_READ endpoint group.
 *
 * Endpoints:
 *  GET /hazelcast/rest/cluster  — {"name":"...","state":"...","memberCount":N}
 *  GET /hazelcast/rest/instance — {"instanceName":"..."}
 *
 * Analogous to com.hazelcast.internal.management.rest.ClusterInfoHandler.
 */
export class ClusterReadHandler {
    constructor(private readonly _state: ClusterReadState) {}

    handle(req: Request): Response {
        const path = new URL(req.url).pathname;

        if (path === '/hazelcast/rest/cluster' || path === '/hazelcast/rest/cluster/') {
            return this._json({
                name: this._state.getClusterName(),
                state: this._state.getClusterState(),
                memberCount: this._state.getMemberCount(),
            });
        }

        if (path === '/hazelcast/rest/instance' || path === '/hazelcast/rest/instance/') {
            return this._json({ instanceName: this._state.getInstanceName() });
        }

        return new Response(
            JSON.stringify({ status: 404, message: 'Unknown cluster endpoint.' }),
            { status: 404, headers: JSON_HEADERS },
        );
    }

    private _json(body: unknown): Response {
        return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
    }
}
