import type { HeliosInstance } from '@zenystx/helios-core/core/HeliosInstance';
import { DefaultOutOfMemoryHandler } from '@zenystx/helios-core/instance/impl/DefaultOutOfMemoryHandler';
import { OutOfMemoryHandler } from '@zenystx/helios-core/instance/impl/OutOfMemoryHandler';

const MAX_REGISTERED_INSTANCES = 50;

// Defined before OutOfMemoryErrorDispatcher to avoid TDZ (temporal dead zone) issue
class EmptyOutOfMemoryHandler extends OutOfMemoryHandler {
  override onOutOfMemory(_oome: Error, _instances: HeliosInstance[]): void {}
  override shouldHandle(_oome: Error): boolean { return false; }
}

/**
 * Dispatches out-of-memory errors to registered handlers.
 * Port of com.hazelcast.instance.impl.OutOfMemoryErrorDispatcher.
 */
export class OutOfMemoryErrorDispatcher {
  private static serverInstances: HeliosInstance[] = [];
  private static clientInstances: HeliosInstance[] = [];
  private static serverHandler: OutOfMemoryHandler = new DefaultOutOfMemoryHandler();
  private static clientHandler: OutOfMemoryHandler = new EmptyOutOfMemoryHandler();
  private static oomErrorCount = 0;

  private constructor() {}

  /** For testing: returns current registered server instances. */
  static current(): HeliosInstance[] {
    return [...OutOfMemoryErrorDispatcher.serverInstances];
  }

  static getOutOfMemoryErrorCount(): number {
    return OutOfMemoryErrorDispatcher.oomErrorCount;
  }

  static setServerHandler(handler: OutOfMemoryHandler): void {
    OutOfMemoryErrorDispatcher.serverHandler = handler;
  }

  static setClientHandler(handler: OutOfMemoryHandler): void {
    OutOfMemoryErrorDispatcher.clientHandler = handler;
  }

  static registerServer(instance: HeliosInstance): void {
    if (instance == null) throw new Error('instance must not be null');
    if (OutOfMemoryErrorDispatcher.serverInstances.length < MAX_REGISTERED_INSTANCES) {
      OutOfMemoryErrorDispatcher.serverInstances = [...OutOfMemoryErrorDispatcher.serverInstances, instance];
    }
  }

  static registerClient(instance: HeliosInstance): void {
    if (instance == null) throw new Error('instance must not be null');
    if (OutOfMemoryErrorDispatcher.clientInstances.length < MAX_REGISTERED_INSTANCES) {
      OutOfMemoryErrorDispatcher.clientInstances = [...OutOfMemoryErrorDispatcher.clientInstances, instance];
    }
  }

  static deregisterServer(instance: HeliosInstance): void {
    if (instance == null) throw new Error('instance must not be null');
    OutOfMemoryErrorDispatcher.serverInstances = OutOfMemoryErrorDispatcher.serverInstances.filter(i => i !== instance);
  }

  static deregisterClient(instance: HeliosInstance): void {
    if (instance == null) throw new Error('instance must not be null');
    OutOfMemoryErrorDispatcher.clientInstances = OutOfMemoryErrorDispatcher.clientInstances.filter(i => i !== instance);
  }

  static clearServers(): void {
    OutOfMemoryErrorDispatcher.serverInstances = [];
  }

  static clearClients(): void {
    OutOfMemoryErrorDispatcher.clientInstances = [];
  }

  static onOutOfMemory(oome: Error): void {
    OutOfMemoryErrorDispatcher.oomErrorCount++;

    const clientH = OutOfMemoryErrorDispatcher.clientHandler;
    if (clientH?.shouldHandle(oome)) {
      try {
        const clients = OutOfMemoryErrorDispatcher.clientInstances;
        OutOfMemoryErrorDispatcher.clientInstances = [];
        clientH.onOutOfMemory(oome, clients);
      } catch {
        // ignore
      }
    }

    const serverH = OutOfMemoryErrorDispatcher.serverHandler;
    if (serverH?.shouldHandle(oome)) {
      try {
        const instances = OutOfMemoryErrorDispatcher.serverInstances;
        OutOfMemoryErrorDispatcher.serverInstances = [];
        serverH.onOutOfMemory(oome, instances);
      } catch {
        // ignore
      }
    }
  }
}
