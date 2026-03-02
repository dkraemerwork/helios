import type { ITopic } from '../ITopic';
import type { MessageListener } from '../MessageListener';
import type { LocalTopicStats } from '../LocalTopicStats';
import { LocalTopicStatsImpl } from '../LocalTopicStats';
import { Message } from '../Message';

/**
 * In-memory single-node ITopic implementation.
 * Port of com.hazelcast.topic.impl.TopicProxy (single-node subset).
 */
export class TopicImpl<T> implements ITopic<T> {
    private readonly listeners = new Map<string, MessageListener<T>>();
    private readonly stats = new LocalTopicStatsImpl();
    private listenerCounter = 0;

    constructor(private readonly name: string) {}

    getName(): string {
        return this.name;
    }

    publish(message: T): void {
        if (message === null || message === undefined) {
            throw new Error('NullPointerException: message is null');
        }
        this.stats.incrementPublish(1);
        const msg = new Message<T>(this.name, message, Date.now());
        for (const listener of this.listeners.values()) {
            listener(msg);
            this.stats.incrementReceive(1);
        }
    }

    publishAsync(message: T): Promise<void> {
        return Promise.resolve().then(() => this.publish(message));
    }

    publishAll(messages: Iterable<T | null>): void {
        for (const m of messages) {
            if (m === null || m === undefined) {
                throw new Error('NullPointerException: message in collection is null');
            }
            this.publish(m);
        }
    }

    publishAllAsync(messages: Iterable<T | null>): Promise<void> {
        return Promise.resolve().then(() => this.publishAll(messages));
    }

    addMessageListener(listener: MessageListener<T>): string {
        const id = `listener-${++this.listenerCounter}`;
        this.listeners.set(id, listener);
        return id;
    }

    removeMessageListener(registrationId: string): boolean {
        return this.listeners.delete(registrationId);
    }

    getLocalTopicStats(): LocalTopicStats {
        return this.stats;
    }

    destroy(): void {
        this.listeners.clear();
    }
}
