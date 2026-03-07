/**
 * Helios Smoke Test — bun:test version
 * Block 12.A3: Updated to use async IMap methods.
 *
 * Validates that a single-node Helios instance can:
 *   - Create and use IMap (put, get, remove, putIfAbsent, putAll, getAll)
 *   - Create and use IQueue (offer, poll, peek, drainTo)
 *   - Create and use ITopic (publish, subscribe, unsubscribe)
 *   - Create and use IList (add, get, indexOf)
 *   - Create and use ISet (add with dedup, contains)
 *   - Create and use MultiMap (multi-value per key)
 *   - Return same instance for same name
 *   - Shutdown cleanly
 */
import { TestHeliosInstance } from '@zenystx/helios-core/test-support/TestHeliosInstance';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

describe('Helios Smoke Test', () => {
    let hz: TestHeliosInstance;

    beforeAll(() => {
        hz = new TestHeliosInstance();
    });

    afterAll(() => {
        hz.shutdown();
    });

    describe('IMap', () => {
        it('should put and get values', async () => {
            const map = hz.getMap<string, { name: string; age: number }>('users');

            await map.put('user-1', { name: 'Alice', age: 30 });
            await map.put('user-2', { name: 'Bob', age: 25 });

            const alice = await map.get('user-1');
            expect(alice).not.toBeNull();
            expect(alice!.name).toBe('Alice');
            expect(alice!.age).toBe(30);

            const bob = await map.get('user-2');
            expect(bob).not.toBeNull();
            expect(bob!.name).toBe('Bob');
        });

        it('should return null for missing keys', async () => {
            const map = hz.getMap<string, string>('missing-test');
            expect(await map.get('no-such-key')).toBeNull();
        });

        it('should report correct size', async () => {
            const map = hz.getMap<string, number>('size-test');
            expect(map.size()).toBe(0);
            expect(map.isEmpty()).toBe(true);

            await map.put('a', 1);
            await map.put('b', 2);
            expect(map.size()).toBe(2);
            expect(map.isEmpty()).toBe(false);
        });

        it('should support containsKey', async () => {
            const map = hz.getMap<string, number>('contains-test');
            await map.put('x', 42);
            expect(map.containsKey('x')).toBe(true);
            expect(map.containsKey('y')).toBe(false);
        });

        it('should support putIfAbsent', async () => {
            const map = hz.getMap<string, string>('putifabsent-test');

            const r1 = await map.putIfAbsent('k', 'first');
            expect(r1).toBeNull(); // new key → null

            const r2 = await map.putIfAbsent('k', 'second');
            expect(r2).toBe('first'); // existing → returns old value

            expect(await map.get('k')).toBe('first'); // unchanged
        });

        it('should return old value on put', async () => {
            const map = hz.getMap<string, string>('replace-test');
            const old1 = await map.put('k', 'v1');
            expect(old1).toBeNull();

            const old2 = await map.put('k', 'v2');
            expect(old2).toBe('v1');
        });

        it('should support remove', async () => {
            const map = hz.getMap<string, string>('remove-test');
            await map.put('k', 'v');

            const removed = await map.remove('k');
            expect(removed).toBe('v');
            expect(map.containsKey('k')).toBe(false);
            expect(await map.remove('k')).toBeNull(); // already gone
        });

        it('should support putAll and getAll', async () => {
            const map = hz.getMap<string, number>('batch-test');
            await map.putAll([
                ['a', 1],
                ['b', 2],
                ['c', 3],
            ]);

            const results = await map.getAll(['a', 'b', 'c', 'missing']);
            expect(results.get('a')).toBe(1);
            expect(results.get('b')).toBe(2);
            expect(results.get('c')).toBe(3);
            expect(results.get('missing')).toBeNull();
        });

        it('should support clear', async () => {
            const map = hz.getMap<string, string>('clear-test');
            await map.put('a', '1');
            await map.put('b', '2');
            expect(map.size()).toBe(2);

            await map.clear();
            expect(map.size()).toBe(0);
            expect(map.isEmpty()).toBe(true);
        });
    });

    describe('IQueue', () => {
        it('should offer and poll in FIFO order', () => {
            const queue = hz.getQueue<string>('work-queue');

            queue.offer('task-1');
            queue.offer('task-2');
            queue.offer('task-3');

            expect(queue.size()).toBe(3);
            expect(queue.poll()).toBe('task-1');
            expect(queue.poll()).toBe('task-2');
            expect(queue.poll()).toBe('task-3');
            expect(queue.poll()).toBeNull();
        });

        it('should peek without removing', () => {
            const queue = hz.getQueue<string>('peek-queue');
            queue.offer('first');
            queue.offer('second');

            expect(queue.peek()).toBe('first');
            expect(queue.peek()).toBe('first'); // still there
            expect(queue.size()).toBe(2);
        });

        it('should drainTo a target array', () => {
            const queue = hz.getQueue<number>('drain-queue');
            queue.offer(10);
            queue.offer(20);
            queue.offer(30);

            const target: number[] = [];
            const count = queue.drainTo(target);

            expect(count).toBe(3);
            expect(target).toEqual([10, 20, 30]);
            expect(queue.isEmpty()).toBe(true);
        });

        it('should report isEmpty correctly', () => {
            const queue = hz.getQueue<string>('empty-queue');
            expect(queue.isEmpty()).toBe(true);
            queue.offer('x');
            expect(queue.isEmpty()).toBe(false);
            queue.poll();
            expect(queue.isEmpty()).toBe(true);
        });
    });

    describe('ITopic', () => {
        it('should deliver published messages to listeners', () => {
            const topic = hz.getTopic<string>('events');
            const received: string[] = [];

            topic.addMessageListener((msg) => {
                received.push(msg.getMessageObject());
            });

            topic.publish('event-1');
            topic.publish('event-2');

            expect(received).toEqual(['event-1', 'event-2']);
        });

        it('should stop delivering after listener is removed', () => {
            const topic = hz.getTopic<string>('unsub-test');
            const received: string[] = [];

            const id = topic.addMessageListener((msg) => {
                received.push(msg.getMessageObject());
            });

            topic.publish('before');
            topic.removeMessageListener(id);
            topic.publish('after');

            expect(received).toEqual(['before']);
        });

        it('should track publish and receive stats', () => {
            const topic = hz.getTopic<string>('stats-topic');

            const listener1Id = topic.addMessageListener(() => {});
            const listener2Id = topic.addMessageListener(() => {});

            topic.publish('msg');

            const stats = topic.getLocalTopicStats();
            expect(stats.getPublishOperationCount()).toBe(1);
            expect(stats.getReceiveOperationCount()).toBe(2); // 2 listeners

            topic.removeMessageListener(listener1Id);
            topic.removeMessageListener(listener2Id);
        });
    });

    describe('IList', () => {
        it('should add and retrieve by index', () => {
            const list = hz.getList<string>('my-list');
            list.add('alpha');
            list.add('beta');
            list.add('gamma');

            expect(list.size()).toBe(3);
            expect(list.get(0)).toBe('alpha');
            expect(list.get(1)).toBe('beta');
            expect(list.get(2)).toBe('gamma');
        });

        it('should support indexOf', () => {
            const list = hz.getList<string>('index-list');
            list.add('x');
            list.add('y');
            list.add('z');

            expect(list.indexOf('y')).toBe(1);
            expect(list.indexOf('missing')).toBe(-1);
        });

        it('should support contains', () => {
            const list = hz.getList<string>('contains-list');
            list.add('hello');
            expect(list.contains('hello')).toBe(true);
            expect(list.contains('world')).toBe(false);
        });
    });

    describe('ISet', () => {
        it('should deduplicate entries', () => {
            const set = hz.getSet<string>('unique-set');
            expect(set.add('a')).toBe(true);
            expect(set.add('b')).toBe(true);
            expect(set.add('a')).toBe(false); // duplicate
            expect(set.size()).toBe(2);
        });

        it('should support contains', () => {
            const set = hz.getSet<string>('contains-set');
            set.add('present');
            expect(set.contains('present')).toBe(true);
            expect(set.contains('absent')).toBe(false);
        });
    });

    describe('MultiMap', () => {
        it('should store multiple values per key', () => {
            const mmap = hz.getMultiMap<string, string>('languages');
            mmap.put('alice', 'TypeScript');
            mmap.put('alice', 'Rust');
            mmap.put('alice', 'Go');
            mmap.put('bob', 'Python');

            expect(mmap.valueCount('alice')).toBe(3);
            expect(mmap.valueCount('bob')).toBe(1);
            expect(mmap.size()).toBe(4);
        });

        it('should support containsKey and containsEntry', () => {
            const mmap = hz.getMultiMap<string, number>('scores');
            mmap.put('player1', 100);
            mmap.put('player1', 200);

            expect(mmap.containsKey('player1')).toBe(true);
            expect(mmap.containsKey('player2')).toBe(false);
            expect(mmap.containsEntry('player1', 100)).toBe(true);
            expect(mmap.containsEntry('player1', 999)).toBe(false);
        });
    });

    describe('Instance identity', () => {
        it('should return same map instance for same name', () => {
            const m1 = hz.getMap('same-map');
            const m2 = hz.getMap('same-map');
            expect(m1).toBe(m2);
        });

        it('should return same queue instance for same name', () => {
            const q1 = hz.getQueue('same-queue');
            const q2 = hz.getQueue('same-queue');
            expect(q1).toBe(q2);
        });

        it('should return different instances for different names', () => {
            const m1 = hz.getMap('map-a');
            const m2 = hz.getMap('map-b');
            expect(m1).not.toBe(m2);
        });
    });

    describe('Lifecycle', () => {
        it('should report isRunning correctly', () => {
            const instance = new TestHeliosInstance();
            expect(instance.isRunning()).toBe(true);
            instance.shutdown();
            expect(instance.isRunning()).toBe(false);
        });
    });
});
