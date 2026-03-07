/**
 * ITopic proxy backed by ReliableTopicService (ringbuffer-backed).
 * Port of com.hazelcast.topic.impl.reliable.ReliableTopicProxy.
 */
import type { ITopic } from "@zenystx/helios-core/topic/ITopic";
import type { LocalTopicStats } from "@zenystx/helios-core/topic/LocalTopicStats";
import type { MessageListener } from "@zenystx/helios-core/topic/MessageListener";
import type { ReliableTopicService } from "@zenystx/helios-core/topic/impl/reliable/ReliableTopicService";

export class ReliableTopicProxyImpl<T> implements ITopic<T> {
  private readonly _name: string;
  private readonly _service: ReliableTopicService;
  private _destroyed = false;
  private _onDestroy: (() => void) | null = null;

  constructor(name: string, service: ReliableTopicService, onDestroy?: () => void) {
    this._name = name;
    this._service = service;
    this._onDestroy = onDestroy ?? null;
  }

  getName(): string {
    return this._name;
  }

  publish(message: T): void {
    this._checkDestroyed();
    this._service.publish(this._name, message);
  }

  publishAsync(message: T): Promise<void> {
    this._checkDestroyed();
    return this._service.publishAsync(this._name, message);
  }

  publishAll(messages: Iterable<T | null>): void {
    for (const message of Array.from(messages)) {
      if (message === null || message === undefined) {
        throw new Error("NullPointerException: message in collection is null");
      }
      this.publish(message);
    }
  }

  publishAllAsync(messages: Iterable<T | null>): Promise<void> {
    return Promise.resolve().then(() => this.publishAll(messages));
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
    if (this._destroyed) return;
    this._destroyed = true;
    this._service.destroy(this._name);
    this._onDestroy?.();
  }

  private _checkDestroyed(): void {
    if (this._destroyed) {
      throw new Error(`Topic '${this._name}' has been destroyed`);
    }
  }
}
