/**
 * Port of {@code com.hazelcast.internal.networking.nio.InboundHandlerWithCounters}.
 */
import { InboundHandler } from '@zenystx/core/internal/networking/InboundHandler';
import type { Counter } from '@zenystx/core/internal/util/counters/Counter';

export abstract class InboundHandlerWithCounters<S, D> extends InboundHandler<S, D> {
    protected normalPacketsRead!: Counter;
    protected priorityPacketsRead!: Counter;

    setNormalPacketsRead(counter: Counter): void {
        this.normalPacketsRead = counter;
    }

    setPriorityPacketsRead(counter: Counter): void {
        this.priorityPacketsRead = counter;
    }
}
