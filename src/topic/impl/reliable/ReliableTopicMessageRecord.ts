/**
 * Envelope stored in the backing ringbuffer for reliable topic messages.
 * Port of com.hazelcast.topic.impl.reliable.ReliableTopicMessage.
 */
export class ReliableTopicMessageRecord {
  readonly publishTime: number;
  readonly publisherAddress: string | null;
  readonly payload: unknown;

  constructor(payload: unknown, publisherAddress: string | null, publishTime?: number) {
    this.publishTime = publishTime ?? Date.now();
    this.publisherAddress = publisherAddress;
    this.payload = payload;
  }
}
