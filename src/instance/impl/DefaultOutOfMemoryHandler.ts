import type { HeliosInstance } from '@zenystx/core/core/HeliosInstance';
import { OutOfMemoryHandler } from '@zenystx/core/instance/impl/OutOfMemoryHandler';

export interface MemoryInfoAccessor {
  getMaxMemory(): number;
  getTotalMemory(): number;
  getFreeMemory(): number;
}

class RuntimeMemoryInfoAccessor implements MemoryInfoAccessor {
  // In Bun/Node.js we approximate using process.memoryUsage()
  getMaxMemory(): number {
    return 512 * 1024 * 1024; // 512 MB default
  }

  getTotalMemory(): number {
    return process.memoryUsage().heapTotal;
  }

  getFreeMemory(): number {
    const usage = process.memoryUsage();
    return Math.max(0, usage.heapTotal - usage.heapUsed);
  }
}

/**
 * Default OutOfMemoryHandler that tries to shut down instances.
 * Port of com.hazelcast.instance.impl.DefaultOutOfMemoryHandler.
 */
export class DefaultOutOfMemoryHandler extends OutOfMemoryHandler {
  static readonly GC_OVERHEAD_LIMIT_EXCEEDED = 'GC overhead limit exceeded';
  static readonly FREE_MAX_PERCENTAGE_PROP = 'hazelcast.oome.handler.free_max.percentage';

  private readonly freeVersusMaxRatio: number;
  private readonly memoryInfoAccessor: MemoryInfoAccessor;

  constructor(
    freeVersusMaxRatio?: number,
    memoryInfoAccessor?: MemoryInfoAccessor,
  ) {
    super();
    const percentageStr = process.env[DefaultOutOfMemoryHandler.FREE_MAX_PERCENTAGE_PROP] ?? '10';
    const defaultRatio = parseInt(percentageStr, 10) / 100;
    this.freeVersusMaxRatio = freeVersusMaxRatio ?? defaultRatio;
    this.memoryInfoAccessor = memoryInfoAccessor ?? new RuntimeMemoryInfoAccessor();
  }

  override onOutOfMemory(_oome: Error, instances: HeliosInstance[]): void {
    for (const instance of instances) {
      try {
        instance.shutdown();
      } catch {
        // ignore
      }
    }
  }

  override shouldHandle(oome: Error): boolean {
    try {
      if (oome.message === DefaultOutOfMemoryHandler.GC_OVERHEAD_LIMIT_EXCEEDED) {
        return true;
      }

      const maxMemory = this.memoryInfoAccessor.getMaxMemory();
      const totalMemory = this.memoryInfoAccessor.getTotalMemory();

      // if total has not reached max, no need to handle
      if (totalMemory < maxMemory - 1024 * 1024) {
        return false;
      }

      const freeMemory = this.memoryInfoAccessor.getFreeMemory();
      if (freeMemory > maxMemory * this.freeVersusMaxRatio) {
        return false;
      }
    } catch {
      // ignore
    }

    return true;
  }
}
