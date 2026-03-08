import { describe, expect, it } from 'bun:test';
import { AsyncChannel } from '@zenystx/helios-core/job/engine/AsyncChannel.js';

describe('AsyncChannel', () => {
  it('should create with specified capacity', () => {
    const ch = new AsyncChannel<number>(4);
    expect(ch.capacity).toBe(4);
    expect(ch.size).toBe(0);
    expect(ch.isFull).toBe(false);
    expect(ch.isClosed).toBe(false);
  });

  it('should send and receive in FIFO order', async () => {
    const ch = new AsyncChannel<string>(8);
    await ch.send('a');
    await ch.send('b');
    await ch.send('c');
    expect(ch.size).toBe(3);
    expect(await ch.receive()).toBe('a');
    expect(await ch.receive()).toBe('b');
    expect(await ch.receive()).toBe('c');
    expect(ch.size).toBe(0);
  });

  it('should block sender when full (backpressure)', async () => {
    const ch = new AsyncChannel<number>(2);
    await ch.send(1);
    await ch.send(2);
    expect(ch.isFull).toBe(true);

    let sendCompleted = false;
    const sendPromise = ch.send(3).then(() => {
      sendCompleted = true;
    });

    // Give microtask queue a chance to flush
    await new Promise(r => setTimeout(r, 50));
    expect(sendCompleted).toBe(false); // sender is blocked

    // Drain one item to unblock
    const val = await ch.receive();
    expect(val).toBe(1);

    await sendPromise;
    expect(sendCompleted).toBe(true);
    expect(ch.size).toBe(2); // [2, 3]
  });

  it('should block receiver when empty', async () => {
    const ch = new AsyncChannel<number>(4);
    let receiveCompleted = false;
    let receivedValue: number | undefined;

    const receivePromise = ch.receive().then(v => {
      receiveCompleted = true;
      receivedValue = v;
    });

    await new Promise(r => setTimeout(r, 50));
    expect(receiveCompleted).toBe(false);

    await ch.send(42);
    await receivePromise;
    expect(receiveCompleted).toBe(true);
    expect(receivedValue).toBe(42);
  });

  it('tryReceive returns undefined when empty', () => {
    const ch = new AsyncChannel<number>(4);
    expect(ch.tryReceive()).toBeUndefined();
  });

  it('tryReceive returns item when available', async () => {
    const ch = new AsyncChannel<number>(4);
    await ch.send(99);
    expect(ch.tryReceive()).toBe(99);
    expect(ch.size).toBe(0);
  });

  it('close unblocks waiting receivers with error', async () => {
    const ch = new AsyncChannel<number>(4);

    const receivePromise = ch.receive();

    await new Promise(r => setTimeout(r, 10));
    ch.close();

    await expect(receivePromise).rejects.toThrow('closed');
  });

  it('close unblocks waiting senders with error', async () => {
    const ch = new AsyncChannel<number>(1);
    await ch.send(1); // fill it

    const sendPromise = ch.send(2);

    await new Promise(r => setTimeout(r, 10));
    ch.close();

    await expect(sendPromise).rejects.toThrow('closed');
  });

  it('send on closed channel throws', async () => {
    const ch = new AsyncChannel<number>(4);
    ch.close();
    await expect(ch.send(1)).rejects.toThrow('closed');
  });

  it('receive on closed non-empty channel drains first', async () => {
    const ch = new AsyncChannel<number>(4);
    await ch.send(10);
    await ch.send(20);
    ch.close();

    expect(await ch.receive()).toBe(10);
    expect(await ch.receive()).toBe(20);
    await expect(ch.receive()).rejects.toThrow('closed');
  });

  it('async iterator yields all items then stops on close', async () => {
    const ch = new AsyncChannel<number>(8);
    await ch.send(1);
    await ch.send(2);
    await ch.send(3);

    // Close after a short delay so the iterator terminates
    setTimeout(() => ch.close(), 50);

    const collected: number[] = [];
    for await (const item of ch) {
      collected.push(item);
    }
    expect(collected).toEqual([1, 2, 3]);
  });

  it('capacity limits are enforced — cannot exceed capacity', async () => {
    const ch = new AsyncChannel<number>(3);
    await ch.send(1);
    await ch.send(2);
    await ch.send(3);
    expect(ch.size).toBe(3);
    expect(ch.isFull).toBe(true);

    // Verify capacity is exactly 3, not more
    let blocked = false;
    const p = ch.send(4).then(() => { blocked = false; });
    blocked = true;
    await new Promise(r => setTimeout(r, 30));
    expect(blocked).toBe(true);

    // Clean up
    ch.close();
    await p.catch(() => {});
  });
});
