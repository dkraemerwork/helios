import { NodeState } from '@zenystx/core/instance/lifecycle/NodeState';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * State provider interface for the health check handler.
 * Implemented by HeliosInstanceImpl and injectable in tests.
 */
export interface HealthCheckState {
    getNodeState(): NodeState;
    getClusterState(): string;
    isClusterSafe(): boolean;
    getClusterSize(): number;
    getMemberVersion(): string;
    getInstanceName(): string;
}

/**
 * Handles the HEALTH_CHECK endpoint group: /hazelcast/health/*.
 *
 * Endpoints:
 *  GET /hazelcast/health              — full health JSON
 *  GET /hazelcast/health/ready        — 200 UP / 503 DOWN (K8s readiness probe)
 *  GET /hazelcast/health/node-state   — {"nodeState":"..."}
 *  GET /hazelcast/health/cluster-state — {"clusterState":"..."}
 *  GET /hazelcast/health/cluster-safe — {"clusterSafe":boolean}
 *  GET /hazelcast/health/cluster-size — {"clusterSize":number}
 *
 * Analogous to com.hazelcast.internal.management.rest.HealthCheckHandler.
 */
export class HealthCheckHandler {
    constructor(private readonly _state: HealthCheckState) {}

    handle(req: Request): Response {
        const path = new URL(req.url).pathname;

        if (path === '/hazelcast/health' || path === '/hazelcast/health/') {
            return this._fullHealth();
        }
        if (path === '/hazelcast/health/ready') {
            return this._ready();
        }
        if (path === '/hazelcast/health/node-state') {
            return this._json({ nodeState: this._state.getNodeState() });
        }
        if (path === '/hazelcast/health/cluster-state') {
            return this._json({ clusterState: this._state.getClusterState() });
        }
        if (path === '/hazelcast/health/cluster-safe') {
            return this._json({ clusterSafe: this._state.isClusterSafe() });
        }
        if (path === '/hazelcast/health/cluster-size') {
            return this._json({ clusterSize: this._state.getClusterSize() });
        }

        return new Response(
            JSON.stringify({ status: 404, message: 'Unknown health endpoint.' }),
            { status: 404, headers: JSON_HEADERS },
        );
    }

    private _fullHealth(): Response {
        return this._json({
            nodeState: this._state.getNodeState(),
            clusterState: this._state.getClusterState(),
            clusterSafe: this._state.isClusterSafe(),
            clusterSize: this._state.getClusterSize(),
            memberVersion: this._state.getMemberVersion(),
            instanceName: this._state.getInstanceName(),
        });
    }

    private _ready(): Response {
        const isActive = this._state.getNodeState() === NodeState.ACTIVE;
        const status = isActive ? 200 : 503;
        return new Response(
            JSON.stringify({ status: isActive ? 'UP' : 'DOWN' }),
            { status, headers: JSON_HEADERS },
        );
    }

    private _json(body: unknown): Response {
        return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
    }
}
