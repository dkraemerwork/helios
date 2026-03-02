/**
 * Minimal task scheduler interface for Near Cache expiration scheduling.
 * Port of {@code com.hazelcast.spi.impl.executionservice.TaskScheduler}.
 */

export interface ScheduledTask {
    cancel(): void;
}

export interface TaskScheduler {
    schedule(task: () => void, delaySeconds: number): ScheduledTask;
    scheduleWithRepetition(task: () => void, initialDelaySeconds: number, periodSeconds: number): ScheduledTask;
}

/** No-op scheduler — used in tests where expiration is driven by direct doExpiration() calls. */
export class NoOpTaskScheduler implements TaskScheduler {
    schedule(_task: () => void, _delaySeconds: number): ScheduledTask {
        return { cancel: () => {} };
    }
    scheduleWithRepetition(_task: () => void, _initialDelaySeconds: number, _periodSeconds: number): ScheduledTask {
        return { cancel: () => {} };
    }
}

/** Real scheduler using Bun/Node setTimeout/setInterval. */
export class BunTaskScheduler implements TaskScheduler {
    schedule(task: () => void, delaySeconds: number): ScheduledTask {
        const handle = setTimeout(task, delaySeconds * 1000);
        return { cancel: () => clearTimeout(handle) };
    }

    scheduleWithRepetition(task: () => void, initialDelaySeconds: number, periodSeconds: number): ScheduledTask {
        let interval: ReturnType<typeof setInterval> | null = null;
        const initialHandle = setTimeout(() => {
            task();
            interval = setInterval(task, periodSeconds * 1000);
        }, initialDelaySeconds * 1000);

        return {
            cancel: () => {
                clearTimeout(initialHandle);
                if (interval !== null) clearInterval(interval);
            },
        };
    }
}
