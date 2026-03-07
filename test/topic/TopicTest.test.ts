import { ITopic } from '@zenystx/helios-core/topic/ITopic';
import { TopicImpl } from '@zenystx/helios-core/topic/impl/TopicImpl';
import { describe, expect, it } from 'bun:test';

function makeTopic<T>(name?: string): ITopic<T> {
    return new TopicImpl<T>(name ?? 'testTopic');
}

describe('TopicTest', () => {
    describe('testName', () => {
        it('returns the topic name', () => {
            const topic = makeTopic<string>('myTopic');
            expect(topic.getName()).toBe('myTopic');
        });
    });

    describe('addMessageListener', () => {
        it('receives published message', async () => {
            const topic = makeTopic<string>();
            const received: string[] = [];
            topic.addMessageListener(msg => received.push(msg.getMessageObject()));
            topic.publish('hello');
            expect(received).toEqual(['hello']);
        });
    });

    describe('addTwoMessageListener', () => {
        it('both listeners receive the same message', () => {
            const topic = makeTopic<string>();
            const r1: string[] = [];
            const r2: string[] = [];
            topic.addMessageListener(msg => r1.push(msg.getMessageObject()));
            topic.addMessageListener(msg => r2.push(msg.getMessageObject()));
            topic.publish('hello');
            expect(r1).toEqual(['hello']);
            expect(r2).toEqual(['hello']);
        });
    });

    describe('removeMessageListener', () => {
        it('removed listener no longer receives messages', () => {
            const topic = makeTopic<string>();
            const received: string[] = [];
            const id = topic.addMessageListener(msg => received.push(msg.getMessageObject()));
            topic.publish('first');
            expect(received).toEqual(['first']);

            expect(topic.removeMessageListener(id)).toBe(true);
            topic.publish('second');
            expect(received).toHaveLength(1);
        });

        it('removeMessageListener returns false for unknown id', () => {
            const topic = makeTopic<string>();
            expect(topic.removeMessageListener('unknown-id')).toBe(false);
        });
    });

    describe('addTwoListenerAndRemoveOne', () => {
        it('remaining listener still receives after one is removed', () => {
            const topic = makeTopic<string>();
            const r1: string[] = [];
            const r2: string[] = [];
            const id1 = topic.addMessageListener(msg => r1.push(msg.getMessageObject()));
            topic.addMessageListener(msg => r2.push(msg.getMessageObject()));
            topic.publish('first');
            expect(r1).toHaveLength(1);
            expect(r2).toHaveLength(1);

            topic.removeMessageListener(id1);
            topic.publish('second');
            expect(r1).toHaveLength(1);   // still 1
            expect(r2).toHaveLength(2);   // now 2
        });
    });

    describe('publishAsync', () => {
        it('resolves and delivers message', async () => {
            const topic = makeTopic<string>();
            const received: string[] = [];
            topic.addMessageListener(msg => received.push(msg.getMessageObject()));
            await topic.publishAsync('async-hello');
            expect(received).toEqual(['async-hello']);
        });
    });

    describe('publishAll', () => {
        it('delivers all messages in order', () => {
            const topic = makeTopic<string>();
            const received: string[] = [];
            topic.addMessageListener(msg => received.push(msg.getMessageObject()));
            topic.publishAll(['a', 'b', 'c']);
            expect(received).toEqual(['a', 'b', 'c']);
        });

        it('throws NullPointerException when collection contains null', () => {
            const topic = makeTopic<unknown>();
            expect(() => topic.publishAll([1, null, 3])).toThrow();
        });
    });

    describe('publishAllAsync', () => {
        it('resolves and delivers all messages', async () => {
            const topic = makeTopic<string>();
            const received: string[] = [];
            topic.addMessageListener(msg => received.push(msg.getMessageObject()));
            await topic.publishAllAsync(['x', 'y', 'z']);
            expect(received).toEqual(['x', 'y', 'z']);
        });
    });

    describe('topicStats', () => {
        it('tracks publish and receive operation counts', () => {
            const topic = makeTopic<string>();
            const stats = topic.getLocalTopicStats();
            topic.addMessageListener(() => {});
            topic.addMessageListener(() => {});

            for (let i = 0; i < 10; i++) {
                topic.publish('msg' + i);
            }

            expect(stats.getPublishOperationCount()).toBe(10);
            expect(stats.getReceiveOperationCount()).toBe(20); // 2 listeners × 10 messages
        });
    });

    describe('destroy', () => {
        it('destroy removes all listeners', () => {
            const topic = makeTopic<string>();
            const received: string[] = [];
            topic.addMessageListener(msg => received.push(msg.getMessageObject()));
            topic.destroy();
            topic.publish('after-destroy');
            expect(received).toHaveLength(0);
        });
    });
});
