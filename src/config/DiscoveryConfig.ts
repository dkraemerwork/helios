import { DiscoveryStrategyConfig } from '@zenystx/core/config/DiscoveryStrategyConfig';

export class DiscoveryConfig {
    private _discoveryStrategyConfigs: DiscoveryStrategyConfig[] = [];
    private _nodeFilterClass: string | null = null;

    getDiscoveryStrategyConfigs(): DiscoveryStrategyConfig[] {
        return this._discoveryStrategyConfigs;
    }

    addDiscoveryStrategyConfig(config: DiscoveryStrategyConfig): this {
        this._discoveryStrategyConfigs.push(config);
        return this;
    }

    getNodeFilterClass(): string | null {
        return this._nodeFilterClass;
    }

    setNodeFilterClass(nodeFilterClass: string): this {
        this._nodeFilterClass = nodeFilterClass;
        return this;
    }
}
