/**
 * Configuration for a classic distributed topic.
 * Port of com.hazelcast.config.TopicConfig.
 */
export class TopicConfig {
  private readonly _name: string;
  private _globalOrderingEnabled = false;
  private _statisticsEnabled = true;
  private _multiThreadingEnabled = false;

  constructor(name: string) {
    this._name = name;
  }

  getName(): string {
    return this._name;
  }

  isGlobalOrderingEnabled(): boolean {
    return this._globalOrderingEnabled;
  }

  setGlobalOrderingEnabled(globalOrderingEnabled: boolean): this {
    if (this._multiThreadingEnabled && globalOrderingEnabled) {
      throw new Error(
        "Global ordering cannot be enabled when multi-threading is used.",
      );
    }
    this._globalOrderingEnabled = globalOrderingEnabled;
    return this;
  }

  isStatisticsEnabled(): boolean {
    return this._statisticsEnabled;
  }

  setStatisticsEnabled(statisticsEnabled: boolean): this {
    this._statisticsEnabled = statisticsEnabled;
    return this;
  }

  isMultiThreadingEnabled(): boolean {
    return this._multiThreadingEnabled;
  }

  setMultiThreadingEnabled(multiThreadingEnabled: boolean): this {
    if (this._globalOrderingEnabled && multiThreadingEnabled) {
      throw new Error(
        "Multi-threading cannot be enabled when global ordering is used.",
      );
    }
    this._multiThreadingEnabled = multiThreadingEnabled;
    return this;
  }
}
