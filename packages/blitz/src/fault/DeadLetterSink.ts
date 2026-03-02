/**
 * Abstraction for publishing messages to a NATS destination.
 * Injected into DeadLetterSink to keep it testable without a real NATS connection.
 */
export interface DLPublisher {
    publish(subject: string, payload: Uint8Array, headers: Record<string, string>): Promise<void>;
}

export interface DeadLetterMessage {
    /** Original NATS subject the message was consumed from. */
    subject: string;
    /** Raw message payload. */
    payload: Uint8Array;
    /** Error description from the failed operator or sink. */
    errorMessage: string;
    /** Number of times this message was delivered (from JetStream metadata). */
    deliveryCount: number;
    /** Name of the sink that failed, if the failure originated in a sink stage. */
    sinkName?: string;
}

/**
 * Routes messages that have exhausted all retry attempts to a dedicated
 * dead-letter stream for later inspection and replay.
 *
 * The DL stream is a separate named stream (not mixed with live traffic).
 * Headers on the published message carry provenance metadata.
 */
export class DeadLetterSink {
    constructor(
        private readonly _publisher: DLPublisher,
        private readonly _streamName: string,
    ) {}

    get streamName(): string {
        return this._streamName;
    }

    async send(msg: DeadLetterMessage): Promise<void> {
        const headers: Record<string, string> = {
            'original-subject': msg.subject,
            'error-message': msg.errorMessage,
            'delivery-count': String(msg.deliveryCount),
        };
        if (msg.sinkName != null) {
            headers['sink-name'] = msg.sinkName;
        }
        await this._publisher.publish(this._streamName, msg.payload, headers);
    }
}
