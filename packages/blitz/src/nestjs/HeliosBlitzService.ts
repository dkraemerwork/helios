import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { BlitzService, type BlitzEventListener } from '../BlitzService.ts';
import { type Pipeline } from '../Pipeline.ts';
import { type BatchPipeline } from '../batch/BatchPipeline.ts';

/**
 * NestJS-injectable wrapper around {@link BlitzService}.
 *
 * Handles lifecycle management (calls `shutdown()` on module destroy) and
 * proxies all {@link BlitzService} methods for convenience.
 *
 * Registered by {@link HeliosBlitzModule} under the `HELIOS_BLITZ_SERVICE_TOKEN` token.
 * Use {@link InjectBlitz} to inject it into your services.
 */
@Injectable()
export class HeliosBlitzService implements OnModuleDestroy {
    constructor(readonly blitz: BlitzService) {}

    /** `true` when the underlying NATS connection has been closed. */
    get isClosed(): boolean {
        return this.blitz.isClosed;
    }

    /** Register a listener for BlitzEvents. Returns `this` for chaining. */
    on(listener: BlitzEventListener): this {
        this.blitz.on(listener);
        return this;
    }

    /** Remove a previously registered BlitzEvent listener. Returns `this` for chaining. */
    off(listener: BlitzEventListener): this {
        this.blitz.off(listener);
        return this;
    }

    /** Create a new pipeline builder with the given name. */
    pipeline(name: string): Pipeline {
        return this.blitz.pipeline(name);
    }

    /** Create a new bounded batch pipeline with the given name. */
    batch(name: string): BatchPipeline {
        return this.blitz.batch(name);
    }

    /** Validate and submit a pipeline for execution. */
    async submit(p: Pipeline): Promise<void> {
        return this.blitz.submit(p);
    }

    /** Cancel a running pipeline by name. */
    async cancel(name: string): Promise<void> {
        return this.blitz.cancel(name);
    }

    /** Returns `true` if a pipeline with the given name is currently running. */
    isRunning(name: string): boolean {
        return this.blitz.isRunning(name);
    }

    /**
     * NestJS lifecycle hook — gracefully shuts down the NATS connection when the
     * module is destroyed (e.g., on `app.close()`).
     * Safe to call multiple times: a no-op when already closed.
     */
    async onModuleDestroy(): Promise<void> {
        if (!this.blitz.isClosed) {
            await this.blitz.shutdown();
        }
    }
}
