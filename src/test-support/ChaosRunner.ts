/**
 * ChaosRunner — randomly kills/isolates nodes during a continuous workload.
 *
 * Block 16.INT — Integration Test Infrastructure
 */
import type { TestCluster } from '@zenystx/helios-core/test-support/TestCluster';

export interface ChaosAction {
    readonly type: 'kill' | 'isolate';
    readonly nodeId: string;
    readonly timestampMs: number;
}

export interface ChaosRunnerConfig {
    /** Minimum interval between chaos actions (ms). */
    readonly minIntervalMs: number;
    /** Maximum interval between chaos actions (ms). */
    readonly maxIntervalMs: number;
    /** Maximum number of chaos actions to perform. */
    readonly maxActions: number;
    /** Minimum nodes that must survive (won't kill/isolate below this count). */
    readonly minSurvivors: number;
    /** Allowed action types. Default: ['kill']. */
    readonly actions?: ('kill' | 'isolate')[];
}

export interface ChaosRunResult {
    readonly actions: ChaosAction[];
    readonly stopped: boolean;
}

export class ChaosRunner {
    private readonly _cluster: TestCluster;
    private readonly _config: ChaosRunnerConfig;
    private _stopped = false;

    constructor(cluster: TestCluster, config: ChaosRunnerConfig) {
        this._cluster = cluster;
        this._config = config;
    }

    /** Stop the chaos runner (can be called from a workload callback). */
    stop(): void {
        this._stopped = true;
    }

    /**
     * Run chaos actions against the cluster.
     * Returns the list of actions taken.
     */
    async run(): Promise<ChaosRunResult> {
        const actions: ChaosAction[] = [];
        const allowedTypes = this._config.actions ?? ['kill'];

        for (let i = 0; i < this._config.maxActions && !this._stopped; i++) {
            const delay = this._config.minIntervalMs +
                Math.random() * (this._config.maxIntervalMs - this._config.minIntervalMs);
            await new Promise(r => setTimeout(r, delay));

            if (this._stopped) break;

            const nodes = this._cluster.getNodes();
            if (nodes.length <= this._config.minSurvivors) continue;

            // Pick a random non-first node (avoid killing master for simplicity)
            const candidates = nodes.slice(1);
            if (candidates.length === 0) continue;

            const target = candidates[Math.floor(Math.random() * candidates.length)];
            const actionType = allowedTypes[Math.floor(Math.random() * allowedTypes.length)];

            const action: ChaosAction = {
                type: actionType,
                nodeId: target.nodeId,
                timestampMs: Date.now(),
            };

            if (actionType === 'kill') {
                await this._cluster.killNode(target.nodeId);
            } else {
                this._cluster.isolateNode(target.nodeId);
            }

            actions.push(action);
        }

        return { actions, stopped: this._stopped };
    }
}
