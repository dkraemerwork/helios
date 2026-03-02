/**
 * Lifecycle state of a HeliosInstance.
 * Port of com.hazelcast.core.LifecycleEvent.LifecycleState.
 */
export enum LifecycleState {
  STARTING = 'STARTING',
  STARTED = 'STARTED',
  SHUTTING_DOWN = 'SHUTTING_DOWN',
  SHUTDOWN = 'SHUTDOWN',
  MERGING = 'MERGING',
  MERGED = 'MERGED',
  MERGE_FAILED = 'MERGE_FAILED',
  CLIENT_CONNECTED = 'CLIENT_CONNECTED',
  CLIENT_DISCONNECTED = 'CLIENT_DISCONNECTED',
  CLIENT_CHANGED_CLUSTER = 'CLIENT_CHANGED_CLUSTER',
}

/**
 * Immutable event fired during HeliosInstance lifecycle state changes.
 * Port of com.hazelcast.core.LifecycleEvent.
 */
export class LifecycleEvent {
  constructor(private readonly state: LifecycleState) {}

  getState(): LifecycleState {
    return this.state;
  }

  equals(other: unknown): boolean {
    if (!(other instanceof LifecycleEvent)) return false;
    return this.state === other.state;
  }

  toString(): string {
    return `LifecycleEvent[state=${this.state}]`;
  }
}
