#!/usr/bin/env bun
/**
 * Helios Smoke Test — Example App
 *
 * Demonstrates a single-node Helios instance with:
 *   1. IMap  — put, get, putIfAbsent, getAll, size, containsKey
 *   2. IQueue — offer, poll, peek, drainTo
 *   3. ITopic — publish/subscribe with message listeners
 *   4. IList  — add, get, indexOf
 *   5. ISet   — add (dedup), contains
 *   6. MultiMap — put multiple values per key
 *
 * Run:  bun run examples/helios-smoke-test.ts
 */
import { TestHeliosInstance } from '@zenystx/helios-core/test-support/TestHeliosInstance';

// ─── Spin up a Helios instance ──────────────────────────────────────────────
const hz = new TestHeliosInstance();
console.log(`\n✅ Helios instance "${hz.getName()}" started\n`);

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
    if (condition) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${label}`);
        failed++;
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. IMap — distributed map operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('── IMap ──');

const userMap = hz.getMap<string, { name: string; age: number }>('users');

// put + get
userMap.put('user-1', { name: 'Alice', age: 30 });
userMap.put('user-2', { name: 'Bob', age: 25 });
userMap.put('user-3', { name: 'Charlie', age: 35 });

const alice = userMap.get('user-1');
assert(alice !== null && alice.name === 'Alice' && alice.age === 30, 'get("user-1") returns Alice');

// size
assert(userMap.size() === 3, 'map size is 3');

// containsKey
assert(userMap.containsKey('user-2') === true, 'containsKey("user-2") is true');
assert(userMap.containsKey('user-99') === false, 'containsKey("user-99") is false');

// putIfAbsent — should return null (inserted)
const result1 = userMap.putIfAbsent('user-4', { name: 'Diana', age: 28 });
assert(result1 === null, 'putIfAbsent("user-4") returns null (new key)');

// putIfAbsent — should return existing value
const result2 = userMap.putIfAbsent('user-1', { name: 'Alice2', age: 99 });
assert(result2 !== null && result2.name === 'Alice', 'putIfAbsent("user-1") returns existing Alice');

// put returns old value
const oldBob = userMap.put('user-2', { name: 'Bob Updated', age: 26 });
assert(oldBob !== null && oldBob.name === 'Bob', 'put("user-2") returns old Bob');

const newBob = userMap.get('user-2');
assert(newBob !== null && newBob.name === 'Bob Updated', 'get("user-2") returns updated Bob');

// remove
const removed = userMap.remove('user-3');
assert(removed !== null && removed.name === 'Charlie', 'remove("user-3") returns Charlie');
assert(userMap.containsKey('user-3') === false, 'user-3 is gone after remove');

// putAll + getAll
userMap.putAll([
    ['user-10', { name: 'Eve', age: 22 }],
    ['user-11', { name: 'Frank', age: 40 }],
]);
const batch = userMap.getAll(['user-10', 'user-11', 'user-99']);
assert(batch.get('user-10')?.name === 'Eve', 'getAll returns Eve for user-10');
assert(batch.get('user-11')?.name === 'Frank', 'getAll returns Frank for user-11');
assert(batch.get('user-99') === null, 'getAll returns null for missing user-99');

console.log(`  Map final size: ${userMap.size()}\n`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. IQueue — distributed queue operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('── IQueue ──');

const taskQueue = hz.getQueue<string>('tasks');

// offer items
taskQueue.offer('task-A');
taskQueue.offer('task-B');
taskQueue.offer('task-C');
assert(taskQueue.size() === 3, 'queue size is 3 after 3 offers');

// peek (does not remove)
const peeked = taskQueue.peek();
assert(peeked === 'task-A', 'peek() returns task-A (head)');
assert(taskQueue.size() === 3, 'size still 3 after peek');

// poll (removes head)
const polled1 = taskQueue.poll();
assert(polled1 === 'task-A', 'poll() returns task-A');
assert(taskQueue.size() === 2, 'size is 2 after poll');

const polled2 = taskQueue.poll();
assert(polled2 === 'task-B', 'poll() returns task-B');

// drainTo
taskQueue.offer('task-D');
taskQueue.offer('task-E');
const drained: string[] = [];
const drainCount = taskQueue.drainTo(drained);
assert(drainCount === 3, 'drainTo drained 3 items');
assert(drained.join(',') === 'task-C,task-D,task-E', 'drained items are C,D,E');
assert(taskQueue.isEmpty(), 'queue is empty after drainTo');

// poll on empty queue
const polledEmpty = taskQueue.poll();
assert(polledEmpty === null, 'poll() on empty queue returns null');

console.log('');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. ITopic — pub/sub messaging
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('── ITopic ──');

const newsTopic = hz.getTopic<string>('news');
const received: string[] = [];

const listenerId = newsTopic.addMessageListener((msg) => {
    received.push(msg.getMessageObject());
});

newsTopic.publish('Breaking: Helios is alive!');
newsTopic.publish('Update: All data structures working');

assert(received.length === 2, 'listener received 2 messages');
assert(received[0] === 'Breaking: Helios is alive!', 'first message correct');
assert(received[1] === 'Update: All data structures working', 'second message correct');

// Stats
const topicStats = newsTopic.getLocalTopicStats();
assert(topicStats.getPublishOperationCount() === 2, 'topic publish count is 2');
assert(topicStats.getReceiveOperationCount() === 2, 'topic receive count is 2');

// Remove listener, publish again — should not receive
newsTopic.removeMessageListener(listenerId);
newsTopic.publish('This should not be received');
assert(received.length === 2, 'no new messages after listener removed');

console.log('');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. IList — distributed list
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('── IList ──');

const todoList = hz.getList<string>('todos');
todoList.add('Buy groceries');
todoList.add('Walk the dog');
todoList.add('Write code');

assert(todoList.size() === 3, 'list size is 3');
assert(todoList.get(0) === 'Buy groceries', 'get(0) returns first item');
assert(todoList.indexOf('Walk the dog') === 1, 'indexOf("Walk the dog") is 1');
assert(todoList.contains('Write code'), 'contains("Write code") is true');

console.log('');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. ISet — distributed set (dedup)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('── ISet ──');

const tagSet = hz.getSet<string>('tags');
assert(tagSet.add('typescript') === true, 'add("typescript") returns true (new)');
assert(tagSet.add('bun') === true, 'add("bun") returns true (new)');
assert(tagSet.add('typescript') === false, 'add("typescript") returns false (duplicate)');
assert(tagSet.size() === 2, 'set size is 2 (no duplicates)');
assert(tagSet.contains('bun'), 'contains("bun") is true');

console.log('');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. MultiMap — multiple values per key
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('── MultiMap ──');

const skillsMap = hz.getMultiMap<string, string>('skills');
skillsMap.put('alice', 'TypeScript');
skillsMap.put('alice', 'Rust');
skillsMap.put('alice', 'Go');
skillsMap.put('bob', 'Python');
skillsMap.put('bob', 'Java');

assert(skillsMap.valueCount('alice') === 3, 'alice has 3 skills');
assert(skillsMap.valueCount('bob') === 2, 'bob has 2 skills');
assert(skillsMap.size() === 5, 'multimap total size is 5');
assert(skillsMap.containsEntry('alice', 'Rust'), 'containsEntry(alice, Rust) is true');

console.log('');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. Same-name returns same instance
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('── Instance Identity ──');

const map1 = hz.getMap('users');
const map2 = hz.getMap('users');
assert(map1 === map2, 'getMap("users") returns same instance both times');

const q1 = hz.getQueue('tasks');
const q2 = hz.getQueue('tasks');
assert(q1 === q2, 'getQueue("tasks") returns same instance both times');

console.log('');

// ── Shutdown ────────────────────────────────────────────────────────────────
hz.shutdown();
assert(!hz.isRunning(), 'instance is not running after shutdown');

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (failed > 0) {
    process.exit(1);
}
