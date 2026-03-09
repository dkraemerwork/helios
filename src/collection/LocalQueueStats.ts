export interface LocalQueueStats {
  getCreationTime(): number;
  getOwnedItemCount(): number;
  getBackupItemCount(): number;
  getMinAge(): number;
  getMaxAge(): number;
  getAverageAge(): number;
  getOfferOperationCount(): number;
  getRejectedOfferOperationCount(): number;
  getPollOperationCount(): number;
  getEmptyPollOperationCount(): number;
  getOtherOperationCount(): number;
  getEventOperationCount(): number;
}

export interface LocalQueueStatsSnapshot {
  creationTime: number;
  ownedItemCount: number;
  backupItemCount: number;
  minAge: number;
  maxAge: number;
  averageAge: number;
  offerOperationCount: number;
  rejectedOfferOperationCount: number;
  pollOperationCount: number;
  emptyPollOperationCount: number;
  otherOperationCount: number;
  eventOperationCount: number;
}

export class LocalQueueStatsImpl implements LocalQueueStats {
  constructor(private readonly _snapshot: LocalQueueStatsSnapshot) {}

  getCreationTime(): number {
    return this._snapshot.creationTime;
  }

  getOwnedItemCount(): number {
    return this._snapshot.ownedItemCount;
  }

  getBackupItemCount(): number {
    return this._snapshot.backupItemCount;
  }

  getMinAge(): number {
    return this._snapshot.minAge;
  }

  getMaxAge(): number {
    return this._snapshot.maxAge;
  }

  getAverageAge(): number {
    return this._snapshot.averageAge;
  }

  getOfferOperationCount(): number {
    return this._snapshot.offerOperationCount;
  }

  getRejectedOfferOperationCount(): number {
    return this._snapshot.rejectedOfferOperationCount;
  }

  getPollOperationCount(): number {
    return this._snapshot.pollOperationCount;
  }

  getEmptyPollOperationCount(): number {
    return this._snapshot.emptyPollOperationCount;
  }

  getOtherOperationCount(): number {
    return this._snapshot.otherOperationCount;
  }

  getEventOperationCount(): number {
    return this._snapshot.eventOperationCount;
  }

  toJSON(): LocalQueueStatsSnapshot {
    return { ...this._snapshot };
  }
}
