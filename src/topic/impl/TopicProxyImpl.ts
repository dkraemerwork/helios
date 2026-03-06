import type { Data } from "@helios/internal/serialization/Data";
import type { SerializationService } from "@helios/internal/serialization/SerializationService";
import type { ITopic } from "@helios/topic/ITopic";
import type { LocalTopicStats } from "@helios/topic/LocalTopicStats";
import type { MessageListener } from "@helios/topic/MessageListener";
import { DistributedTopicService } from "@helios/topic/impl/DistributedTopicService";

export class TopicProxyImpl<T> implements ITopic<T> {
  constructor(
    private readonly _name: string,
    private readonly _service: DistributedTopicService,
    private readonly _serializationService: SerializationService,
  ) {}

  getName(): string {
    return this._name;
  }

  publish(message: T): Promise<void> {
    return this.publishAsync(message);
  }

  publishAsync(message: T): Promise<void> {
    return this._service.publish(this._name, this._toData(message));
  }

  publishAll(messages: Iterable<T | null>): Promise<void> {
    return this.publishAllAsync(messages);
  }

  async publishAllAsync(messages: Iterable<T | null>): Promise<void> {
    for (const message of Array.from(messages)) {
      if (message === null || message === undefined) {
        throw new Error("NullPointerException: message in collection is null");
      }
      await this.publishAsync(message);
    }
  }

  addMessageListener(listener: MessageListener<T>): string {
    return this._service.addMessageListener(this._name, listener);
  }

  removeMessageListener(registrationId: string): boolean {
    return this._service.removeMessageListener(this._name, registrationId);
  }

  getLocalTopicStats(): LocalTopicStats {
    return this._service.getLocalTopicStats(this._name);
  }

  destroy(): void {
    this._service.destroy(this._name);
  }

  private _toData(value: T): Data {
    const data = this._serializationService.toData(value);
    if (data === null) {
      throw new Error("NullPointerException: message is null");
    }
    return data;
  }
}
