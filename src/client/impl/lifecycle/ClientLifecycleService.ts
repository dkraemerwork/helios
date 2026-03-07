/**
 * Client-side lifecycle service.
 *
 * Port of the lifecycle management from HazelcastClientInstanceImpl,
 * adapted for the Helios remote client.
 */
import type { LifecycleService } from '@zenystx/helios-core/instance/lifecycle/LifecycleService';
import type { LifecycleListener } from '@zenystx/helios-core/instance/lifecycle/LifecycleListener';
import { LifecycleEvent, LifecycleState } from '@zenystx/helios-core/instance/lifecycle/LifecycleEvent';

let _idCounter = 0;

export class ClientLifecycleService implements LifecycleService {
  private readonly _listeners = new Map<string, LifecycleListener>();
  private _running = true;

  addLifecycleListener(listener: LifecycleListener): string {
    if (listener == null) throw new Error('lifecycleListener must not be null');
    const id = `client-lifecycle-${++_idCounter}-${Date.now()}`;
    this._listeners.set(id, listener);
    return id;
  }

  removeLifecycleListener(id: string): boolean {
    return this._listeners.delete(id);
  }

  isRunning(): boolean {
    return this._running;
  }

  shutdown(): void {
    if (!this._running) return;
    this._fireEvent(LifecycleState.SHUTTING_DOWN);
    this._running = false;
    this._fireEvent(LifecycleState.SHUTDOWN);
  }

  private _fireEvent(state: LifecycleState): void {
    const event = new LifecycleEvent(state);
    for (const listener of this._listeners.values()) {
      try {
        listener.stateChanged(event);
      } catch {
        // ignore listener errors
      }
    }
  }
}
