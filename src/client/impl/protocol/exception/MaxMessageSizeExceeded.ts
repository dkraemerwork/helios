/**
 * Port of {@code com.hazelcast.client.impl.protocol.exception.MaxMessageSizeExceeded}.
 */
export class MaxMessageSizeExceeded extends Error {
    constructor(message?: string) {
        super(message);
        this.name = 'MaxMessageSizeExceeded';
        Object.setPrototypeOf(this, MaxMessageSizeExceeded.prototype);
    }
}
