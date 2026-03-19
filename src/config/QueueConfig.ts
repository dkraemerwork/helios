import {
  DEFAULT_QUEUE_BACKUP_COUNT,
  DEFAULT_QUEUE_MAX_SIZE,
} from '@zenystx/helios-core/config/HazelcastDefaults.js';
import type { QueueStoreConfig } from '@zenystx/helios-core/config/QueueStoreConfig.js';

export class QueueConfig {
  static readonly DEFAULT_MAX_SIZE = DEFAULT_QUEUE_MAX_SIZE;
  static readonly DEFAULT_BACKUP_COUNT = DEFAULT_QUEUE_BACKUP_COUNT;
  static readonly DEFAULT_ASYNC_BACKUP_COUNT = 0;
  static readonly DEFAULT_EMPTY_QUEUE_TTL_SECONDS = 0;

  private readonly _name: string;
  private _maxSize = QueueConfig.DEFAULT_MAX_SIZE;
  private _backupCount = QueueConfig.DEFAULT_BACKUP_COUNT;
  private _asyncBackupCount = QueueConfig.DEFAULT_ASYNC_BACKUP_COUNT;
  private _emptyQueueTtlSeconds = QueueConfig.DEFAULT_EMPTY_QUEUE_TTL_SECONDS;
  private _statisticsEnabled = true;
  private _queueStoreConfig: QueueStoreConfig | null = null;
  private _splitBrainProtectionName: string | null = null;

  constructor(name: string) {
    this._name = name;
  }

  getName(): string {
    return this._name;
  }

  getMaxSize(): number {
    return this._maxSize;
  }

  setMaxSize(maxSize: number): this {
    if (maxSize < 0) {
      throw new Error(`maxSize must be >= 0, got: ${maxSize}`);
    }
    this._maxSize = maxSize;
    return this;
  }

  getBackupCount(): number {
    return this._backupCount;
  }

  setBackupCount(backupCount: number): this {
    if (backupCount < 0 || backupCount > 6) {
      throw new Error(
        `backupCount must be between 0 and 6, got: ${backupCount}`,
      );
    }
    this._backupCount = backupCount;
    return this;
  }

  getAsyncBackupCount(): number {
    return this._asyncBackupCount;
  }

  setAsyncBackupCount(asyncBackupCount: number): this {
    if (asyncBackupCount < 0 || asyncBackupCount > 6) {
      throw new Error(
        `asyncBackupCount must be between 0 and 6, got: ${asyncBackupCount}`,
      );
    }
    this._asyncBackupCount = asyncBackupCount;
    return this;
  }

  getTotalBackupCount(): number {
    return this._backupCount + this._asyncBackupCount;
  }

  getEmptyQueueTtlSeconds(): number {
    return this._emptyQueueTtlSeconds;
  }

  setEmptyQueueTtlSeconds(emptyQueueTtlSeconds: number): this {
    if (emptyQueueTtlSeconds < 0) {
      throw new Error(
        `emptyQueueTtlSeconds must be >= 0, got: ${emptyQueueTtlSeconds}`,
      );
    }
    this._emptyQueueTtlSeconds = emptyQueueTtlSeconds;
    return this;
  }

  isStatisticsEnabled(): boolean {
    return this._statisticsEnabled;
  }

  setStatisticsEnabled(statisticsEnabled: boolean): this {
    this._statisticsEnabled = statisticsEnabled;
    return this;
  }

  getQueueStoreConfig(): QueueStoreConfig | null {
    return this._queueStoreConfig;
  }

  setQueueStoreConfig(config: QueueStoreConfig): this {
    this._queueStoreConfig = config;
    return this;
  }

  getSplitBrainProtectionName(): string | null {
    return this._splitBrainProtectionName;
  }

  setSplitBrainProtectionName(name: string): this {
    this._splitBrainProtectionName = name;
    return this;
  }
}
