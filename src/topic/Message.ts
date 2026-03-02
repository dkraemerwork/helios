/**
 * Message wrapper for ITopic published messages.
 * Port of com.hazelcast.topic.Message.
 */
export class Message<T> {
    constructor(
        private readonly topicName: string,
        private readonly messageObject: T,
        private readonly publishTime: number,
        private readonly publishingMemberId: string | null = null,
    ) {}

    /** The actual message payload. */
    getMessageObject(): T {
        return this.messageObject;
    }

    /** The topic name this message was published to. */
    getSource(): string {
        return this.topicName;
    }

    /** Timestamp (ms) when the message was published. */
    getPublishTime(): number {
        return this.publishTime;
    }

    getPublishingMemberId(): string | null {
        return this.publishingMemberId;
    }
}
