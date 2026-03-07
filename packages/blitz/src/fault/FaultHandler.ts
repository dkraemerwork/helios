import { AckPolicy } from './AckPolicy.js';
import { RetryPolicy } from './RetryPolicy.js';
import type { DeadLetterSink } from './DeadLetterSink.js';
import { NakError } from '../errors/NakError.js';

/**
 * Minimal interface for a JetStream message passed to FaultHandler.
 * In production this is `JsMsg` from `@nats-io/jetstream`.
 * In tests, a plain object with these four members suffices.
 */
export interface FaultMessage {
    subject: string;
    data: Uint8Array;
    /** JetStream delivery count (1-based: 1 = first delivery, 2 = first retry, ...). */
    deliveryCount: number;
    ack(): void;
    nak(opts?: { delay?: number }): void;
}

export interface FaultHandlerOptions {
    ackPolicy: AckPolicy;
    retryPolicy: RetryPolicy;
    deadLetterSink?: DeadLetterSink;
    /** Name of the current sink stage, included in DL message headers on sink failures. */
    sinkName?: string;
}

/**
 * Orchestrates ack/retry/dead-letter decisions for a single pipeline execution.
 *
 * - AckPolicy.NONE:     call process(); ignore errors; never ack/nak.
 * - AckPolicy.EXPLICIT: on success → ack(); on error:
 *     - attempt < maxRetries → nak(delay); the server redelivers.
 *     - attempt >= maxRetries → route to dead-letter sink (if configured).
 *
 * The "attempt" is derived from `msg.deliveryCount - 1` (0-based).
 */
export class FaultHandler {
    constructor(private readonly _opts: FaultHandlerOptions) {}

    async handle<T>(msg: FaultMessage, process: () => Promise<T>): Promise<T | undefined> {
        if (this._opts.ackPolicy === AckPolicy.NONE) {
            try {
                return await process();
            } catch {
                return undefined;
            }
        }

        // AckPolicy.EXPLICIT
        try {
            const result = await process();
            msg.ack();
            return result;
        } catch (err) {
            const nakErr = err instanceof NakError ? err : new NakError(String(err), { cause: err });
            // attempt is 0-based: deliveryCount 1 → attempt 0, 2 → attempt 1, etc.
            const attempt = msg.deliveryCount - 1;
            if (this._opts.retryPolicy.shouldRetry(attempt)) {
                const delay = this._opts.retryPolicy.computeDelay(attempt);
                msg.nak({ delay });
            } else {
                // Retries exhausted — route to dead-letter sink
                if (this._opts.deadLetterSink) {
                    await this._opts.deadLetterSink.send({
                        subject: msg.subject,
                        payload: msg.data,
                        errorMessage: nakErr.message,
                        deliveryCount: msg.deliveryCount,
                        sinkName: this._opts.sinkName,
                    });
                }
            }
            return undefined;
        }
    }
}
