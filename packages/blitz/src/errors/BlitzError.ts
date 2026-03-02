/**
 * Base error class for all Helios Blitz errors.
 */
export class BlitzError extends Error {
    override readonly name = 'BlitzError';

    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
    }
}
