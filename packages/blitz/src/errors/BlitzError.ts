/**
 * Base error class for all Helios Blitz errors.
 */
export class BlitzError extends Error {
    override readonly name: string = 'BlitzError';

    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
    }
}
