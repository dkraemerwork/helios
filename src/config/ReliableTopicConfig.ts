/**
 * Configuration for a reliable topic backed by a ringbuffer.
 * Port of com.hazelcast.config.ReliableTopicConfig.
 */

export enum TopicOverloadPolicy {
  /** Discard the oldest item in the ringbuffer to make space. */
  DISCARD_OLDEST = "DISCARD_OLDEST",
  /** Discard the newest (current) message — silently drop. */
  DISCARD_NEWEST = "DISCARD_NEWEST",
  /** Block the caller until space becomes available (with exponential backoff). */
  BLOCK = "BLOCK",
  /** Fail immediately with a TopicOverloadException. */
  ERROR = "ERROR",
}

export class ReliableTopicConfig {
  static readonly DEFAULT_READ_BATCH_SIZE = 10;
  static readonly DEFAULT_TOPIC_OVERLOAD_POLICY = TopicOverloadPolicy.BLOCK;
  static readonly DEFAULT_STATISTICS_ENABLED = true;

  private readonly _name: string;
  private _readBatchSize: number = ReliableTopicConfig.DEFAULT_READ_BATCH_SIZE;
  private _topicOverloadPolicy: TopicOverloadPolicy = ReliableTopicConfig.DEFAULT_TOPIC_OVERLOAD_POLICY;
  private _statisticsEnabled: boolean = ReliableTopicConfig.DEFAULT_STATISTICS_ENABLED;

  constructor(name: string) {
    this._name = name;
  }

  getName(): string {
    return this._name;
  }

  getReadBatchSize(): number {
    return this._readBatchSize;
  }

  setReadBatchSize(readBatchSize: number): this {
    if (readBatchSize <= 0) {
      throw new Error(`readBatchSize must be positive, got: ${readBatchSize}`);
    }
    this._readBatchSize = readBatchSize;
    return this;
  }

  getTopicOverloadPolicy(): TopicOverloadPolicy {
    return this._topicOverloadPolicy;
  }

  setTopicOverloadPolicy(policy: TopicOverloadPolicy): this {
    if (policy == null) {
      throw new Error("topicOverloadPolicy must not be null");
    }
    this._topicOverloadPolicy = policy;
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
