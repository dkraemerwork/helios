export class TopicConfig {
  private readonly _name: string;
  private _globalOrderingEnabled = false;
  private _statisticsEnabled = true;

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
}
