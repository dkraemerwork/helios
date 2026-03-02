/**
 * Port of {@code com.hazelcast.core.HazelcastException}.
 *
 * Base runtime exception for Helios. All Helios-specific exceptions extend this.
 */
export class HeliosException extends Error {
    override readonly cause?: unknown;

    constructor(message?: string, cause?: unknown) {
        super(message);
        this.name = 'HeliosException';
        if (cause !== undefined) {
            this.cause = cause;
        }
    }
}
