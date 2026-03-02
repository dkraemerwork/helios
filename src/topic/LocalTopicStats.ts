/**
 * Statistics for an ITopic.
 * Port of com.hazelcast.topic.LocalTopicStats.
 */
export interface LocalTopicStats {
    /** Number of times publish/publishAll was called on this topic. */
    getPublishOperationCount(): number;
    /** Number of messages received by all listeners on this topic. */
    getReceiveOperationCount(): number;
}

/** Mutable stats implementation used internally by TopicImpl. */
export class LocalTopicStatsImpl implements LocalTopicStats {
    private publishCount = 0;
    private receiveCount = 0;

    incrementPublish(count = 1): void {
        this.publishCount += count;
    }

    incrementReceive(count = 1): void {
        this.receiveCount += count;
    }

    getPublishOperationCount(): number {
        return this.publishCount;
    }

    getReceiveOperationCount(): number {
        return this.receiveCount;
    }
}
