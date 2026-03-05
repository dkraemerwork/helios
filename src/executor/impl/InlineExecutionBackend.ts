/**
 * Default inline execution backend — runs task factories directly in the current thread.
 *
 * This is the baseline backend used before Scatter worker-thread integration.
 */
import type { ExecutionBackend } from '@helios/executor/impl/ExecutionBackend.js';

export class InlineExecutionBackend implements ExecutionBackend {
    async execute(factory: (input: unknown) => unknown | Promise<unknown>, inputData: Buffer): Promise<unknown> {
        const input = JSON.parse(inputData.toString('utf8'));
        return factory(input);
    }

    destroy(): void {
        // No resources to release for inline execution.
    }
}
