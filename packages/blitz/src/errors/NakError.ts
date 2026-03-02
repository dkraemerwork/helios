import { BlitzError } from './BlitzError.ts';

/**
 * Thrown when a JetStream message is nak'd (negative acknowledgement),
 * indicating a processing failure that exhausted the retry policy.
 *
 * When `BlitzService` catches a `NatsError` during reconnect or publish,
 * it wraps it as a `NakError` to trigger the standard retry/dead-letter policy.
 */
export class NakError extends BlitzError {
    override readonly name = 'NakError';

    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
    }
}
