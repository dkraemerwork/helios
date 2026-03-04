/**
 * Port of {@code com.hazelcast.nio.serialization.HazelcastSerializationException}.
 *
 * Thrown for all serialization failures — unknown typeId, unsupported format,
 * factory lookup miss, buffer corruption, etc.
 */
export class HazelcastSerializationError extends Error {
    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'HazelcastSerializationError';
        if (cause instanceof Error) this.cause = cause;
    }
}
