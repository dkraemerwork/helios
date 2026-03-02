import type { LifecycleEvent } from '@helios/instance/lifecycle/LifecycleEvent';

/**
 * Listener for HeliosInstance lifecycle state changes.
 * Port of com.hazelcast.core.LifecycleListener.
 */
export interface LifecycleListener {
  stateChanged(event: LifecycleEvent): void;
}
