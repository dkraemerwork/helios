import { BlitzError } from './BlitzError.ts';

/**
 * Thrown when a message has been routed to the dead-letter sink
 * after exhausting all retry attempts.
 */
export class DeadLetterError extends BlitzError {
    override readonly name = 'DeadLetterError';

    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
    }
}
