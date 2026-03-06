import type { HeliosInstance } from '@zenystx/helios-core/core/HeliosInstance';

/**
 * Handler for out-of-memory conditions.
 * Port of com.hazelcast.core.OutOfMemoryHandler.
 * Note: JavaScript/TypeScript does not have a true OutOfMemoryError; we use Error.
 */
export abstract class OutOfMemoryHandler {
  /**
   * Called when an out-of-memory condition is detected.
   */
  abstract onOutOfMemory(oome: Error, instances: HeliosInstance[]): void;

  /**
   * Returns true if this handler should handle the given error.
   */
  shouldHandle(_oome: Error): boolean {
    return true;
  }
}
