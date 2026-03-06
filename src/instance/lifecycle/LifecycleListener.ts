import type { LifecycleEvent } from '@zenystx/helios-core/instance/lifecycle/LifecycleEvent';

/**
 * Listener for HeliosInstance lifecycle state changes.
 * Port of com.hazelcast.core.LifecycleListener.
 */
export interface LifecycleListener {
  stateChanged(event: LifecycleEvent): void;
}
