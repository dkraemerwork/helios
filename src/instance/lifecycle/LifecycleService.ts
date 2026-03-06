import type { LifecycleListener } from '@zenystx/core/instance/lifecycle/LifecycleListener';

/**
 * LifecycleService interface — manages instance lifecycle state and listener notification.
 * Port of com.hazelcast.core.LifecycleService.
 */
export interface LifecycleService {
    /**
     * Registers a lifecycle listener.
     * @returns A registration ID for later removal.
     */
    addLifecycleListener(listener: LifecycleListener): string;

    /**
     * Removes a lifecycle listener.
     * @returns true if the listener was found and removed.
     */
    removeLifecycleListener(id: string): boolean;

    /** Returns true if the instance is currently running. */
    isRunning(): boolean;

    /** Shuts down the instance cleanly. */
    shutdown(): void;
}
