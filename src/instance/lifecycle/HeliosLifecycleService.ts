import { LifecycleEvent, LifecycleState } from '@helios/instance/lifecycle/LifecycleEvent';
import type { LifecycleListener } from '@helios/instance/lifecycle/LifecycleListener';

let _idCounter = 0;

/**
 * Manages the lifecycle state of a HeliosInstance.
 * Port of com.hazelcast.instance.impl.LifecycleServiceImpl.
 */
export class HeliosLifecycleService {
  private readonly listeners = new Map<string, LifecycleListener>();
  private running = true;

  addLifecycleListener(listener: LifecycleListener): string {
    if (listener == null) throw new Error('lifecycleListener must not be null');
    const id = `lifecycle-${++_idCounter}-${Date.now()}`;
    this.listeners.set(id, listener);
    return id;
  }

  removeLifecycleListener(id: string): boolean {
    return this.listeners.delete(id);
  }

  fireLifecycleEvent(state: LifecycleState): void {
    const event = new LifecycleEvent(state);
    for (const listener of this.listeners.values()) {
      try {
        listener.stateChanged(event);
      } catch {
        // ignore listener errors
      }
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  shutdown(): void {
    this._shutdown();
  }

  terminate(): void {
    this._shutdown();
  }

  private _shutdown(): void {
    if (!this.running) return;
    this.fireLifecycleEvent(LifecycleState.SHUTTING_DOWN);
    this.running = false;
    this.fireLifecycleEvent(LifecycleState.SHUTDOWN);
  }
}
