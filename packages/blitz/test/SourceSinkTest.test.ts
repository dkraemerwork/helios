/**
 * Block 10.2 — Sources + Sinks
 *
 * Tests for BlitzCodec, all Source implementations, and all Sink implementations.
 * NATS integration tests are guarded by NATS_AVAILABLE.
 */
import { describe, test, expect, mock, beforeAll, afterAll, spyOn } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonCodec, StringCodec, BytesCodec } from '../src/codec/BlitzCodec.ts';
import { NatsSource } from '../src/source/NatsSource.ts';
import { NatsSink } from '../src/sink/NatsSink.ts';
import { HeliosMapSource } from '../src/source/HeliosMapSource.ts';
import { HeliosTopicSource } from '../src/source/HeliosTopicSource.ts';
import { HeliosMapSink } from '../src/sink/HeliosMapSink.ts';
import { HeliosTopicSink } from '../src/sink/HeliosTopicSink.ts';
import { FileSource } from '../src/source/FileSource.ts';
import { FileSink } from '../src/sink/FileSink.ts';
import { LogSink } from '../src/sink/LogSink.ts';
import { HttpWebhookSource } from '../src/source/HttpWebhookSource.ts';
import { Message } from '@helios/topic/Message';
import { BlitzService } from '../src/BlitzService.ts';
import type { IMap } from '@helios/map/IMap';
import type { ITopic } from '@helios/topic/ITopic';
import type { MessageListener } from '@helios/topic/MessageListener';

// ---------------------------------------------------------------------------
// 1 — BlitzCodec
// ---------------------------------------------------------------------------

describe('JsonCodec', () => {
  test('round-trips a plain object', () => {
    const codec = JsonCodec<{ x: number; y: string }>();
    const value = { x: 42, y: 'hello' };
    const encoded = codec.encode(value);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(codec.decode(encoded)).toEqual(value);
  });

  test('round-trips a number', () => {
    const codec = JsonCodec<number>();
    expect(codec.decode(codec.encode(99))).toBe(99);
  });

  test('round-trips an array', () => {
    const codec = JsonCodec<number[]>();
    expect(codec.decode(codec.encode([1, 2, 3]))).toEqual([1, 2, 3]);
  });
});

describe('StringCodec', () => {
  test('round-trips a plain string', () => {
    const codec = StringCodec();
    expect(codec.decode(codec.encode('hello world'))).toBe('hello world');
  });

  test('round-trips unicode', () => {
    const codec = StringCodec();
    const s = '🎉 héllo';
    expect(codec.decode(codec.encode(s))).toBe(s);
  });
});

describe('BytesCodec', () => {
  test('encode is a passthrough', () => {
    const codec = BytesCodec();
    const b = new Uint8Array([1, 2, 3]);
    expect(codec.encode(b)).toBe(b);
  });

  test('decode is a passthrough', () => {
    const codec = BytesCodec();
    const b = new Uint8Array([4, 5, 6]);
    expect(codec.decode(b)).toBe(b);
  });
});

describe('Codec independence', () => {
  test('multiple JsonCodec instances are independent', () => {
    const c1 = JsonCodec<{ a: number }>();
    const c2 = JsonCodec<{ b: string }>();
    const b1 = c1.encode({ a: 1 });
    const b2 = c2.encode({ b: 'x' });
    expect(c1.decode(b1)).toEqual({ a: 1 });
    expect(c2.decode(b2)).toEqual({ b: 'x' });
  });
});

// ---------------------------------------------------------------------------
// 2 — NatsSource descriptors (no NATS required)
// ---------------------------------------------------------------------------

describe('NatsSource — descriptor', () => {
  test('fromSubject() name is nats-subject:<subject>', () => {
    const src = NatsSource.fromSubject(null as any, 'orders.raw', JsonCodec<string>());
    expect(src.name).toBe('nats-subject:orders.raw');
  });

  test('fromSubject() stores the codec', () => {
    const codec = JsonCodec<string>();
    const src = NatsSource.fromSubject(null as any, 'orders.raw', codec);
    expect(src.codec).toBe(codec);
  });

  test('fromStream() name is nats-stream:<stream>/<consumer>', () => {
    const src = NatsSource.fromStream(null as any, 'my-stream', 'my-consumer', JsonCodec<string>());
    expect(src.name).toBe('nats-stream:my-stream/my-consumer');
  });
});

// ---------------------------------------------------------------------------
// 3 — NatsSink descriptors (no NATS required)
// ---------------------------------------------------------------------------

describe('NatsSink — descriptor', () => {
  test('toSubject() name is nats-sink:<subject>', () => {
    const sink = NatsSink.toSubject(null as any, 'orders.out', JsonCodec<string>());
    expect(sink.name).toBe('nats-sink:orders.out');
  });

  test('toSubject() stores the codec', () => {
    const codec = JsonCodec<string>();
    const sink = NatsSink.toSubject(null as any, 'orders.out', codec);
    expect((sink as any).codec).toBe(codec);
  });

  test('toStream() name is nats-stream-sink:<stream>', () => {
    const sink = NatsSink.toStream(null as any, 'my-stream', JsonCodec<string>());
    expect(sink.name).toBe('nats-stream-sink:my-stream');
  });
});

// ---------------------------------------------------------------------------
// 4 — HeliosMapSource
// ---------------------------------------------------------------------------

function makeMap<K, V>(entries: Map<K, V>): IMap<K, V> {
  const putFn = mock(async (_k: K, _v: V) => null as V | null);
  return {
    getName: () => 'mock-map',
    put: putFn,
    entrySet: () => new Map(entries),
  } as unknown as IMap<K, V>;
}

describe('HeliosMapSource', () => {
  test('snapshot() name is helios-map-source:<mapName>', () => {
    const map = makeMap(new Map([['a', 1]]));
    const src = HeliosMapSource.snapshot(map);
    expect(src.name).toBe('helios-map-source:mock-map');
  });

  test('snapshot() yields all entries as {key, value} pairs', async () => {
    const entries = new Map<string, number>([['a', 1], ['b', 2]]);
    const map = makeMap(entries);
    const src = HeliosMapSource.snapshot(map);
    const results: Array<{ key: string; value: number }> = [];
    for await (const msg of src.messages()) {
      results.push(msg.value);
      msg.ack();
    }
    expect(results.length).toBe(2);
    expect(results).toContainEqual({ key: 'a', value: 1 });
    expect(results).toContainEqual({ key: 'b', value: 2 });
  });
});

// ---------------------------------------------------------------------------
// 5 — HeliosMapSink
// ---------------------------------------------------------------------------

describe('HeliosMapSink', () => {
  test('put() name is helios-map-sink:<mapName>', () => {
    const map = makeMap(new Map<string, number>());
    const sink = HeliosMapSink.put(map);
    expect(sink.name).toBe('helios-map-sink:mock-map');
  });

  test('put() calls map.put(key, value) on write', async () => {
    const putFn = mock(async (_k: string, _v: number) => null as number | null);
    const map = { getName: () => 'mock-map', put: putFn } as unknown as IMap<string, number>;
    const sink = HeliosMapSink.put(map);
    await sink.write({ key: 'hello', value: 42 });
    expect(putFn).toHaveBeenCalledWith('hello', 42);
  });
});

// ---------------------------------------------------------------------------
// 6 — HeliosTopicSource / HeliosTopicSink
// ---------------------------------------------------------------------------

function makeTopic<T>(): { topic: ITopic<T>; fire(msg: T): void } {
  let listener: MessageListener<T> | null = null;
  const publishAsyncFn = mock(async (_msg: T) => {});
  const topic = {
    getName: () => 'mock-topic',
    publish: mock((_msg: T) => {}),
    publishAsync: publishAsyncFn,
    publishAll: mock((_msgs: any) => {}),
    publishAllAsync: mock(async (_msgs: any) => {}),
    addMessageListener: mock((l: MessageListener<T>) => { listener = l; return 'reg-1'; }),
    removeMessageListener: mock((_id: string) => true),
    getLocalTopicStats: () => ({} as any),
    destroy: mock(() => {}),
  } as unknown as ITopic<T>;
  return {
    topic,
    fire: (msg: T) => { listener?.(new Message('mock-topic', msg, Date.now())); },
  };
}

describe('HeliosTopicSource', () => {
  test('fromTopic() name is helios-topic-source:<topicName>', () => {
    const { topic } = makeTopic<string>();
    const src = HeliosTopicSource.fromTopic(topic);
    expect(src.name).toBe('helios-topic-source:mock-topic');
  });

  test('fromTopic() has a codec', () => {
    const { topic } = makeTopic<string>();
    const src = HeliosTopicSource.fromTopic(topic);
    expect(src.codec).toBeDefined();
  });

  test('fromTopic() yields messages published to the topic', async () => {
    const { topic, fire } = makeTopic<string>();
    const src = HeliosTopicSource.fromTopic(topic);
    const iter = src.messages()[Symbol.asyncIterator]();
    const nextPromise = iter.next(); // starts generator, registers listener
    fire('hello');
    const { value: msg } = await nextPromise;
    expect(msg.value).toBe('hello');
    msg.ack();
    await iter.return?.();
  });
});

describe('HeliosTopicSink', () => {
  test('publish() name is helios-topic-sink:<topicName>', () => {
    const { topic } = makeTopic<string>();
    const sink = HeliosTopicSink.publish(topic);
    expect(sink.name).toBe('helios-topic-sink:mock-topic');
  });

  test('publish() calls topic.publishAsync() on write', async () => {
    const { topic } = makeTopic<string>();
    const sink = HeliosTopicSink.publish(topic);
    await sink.write('hello');
    expect(topic.publishAsync).toHaveBeenCalledWith('hello');
  });
});

// ---------------------------------------------------------------------------
// 7 — FileSource / FileSink
// ---------------------------------------------------------------------------

describe('FileSource', () => {
  let tmpSrc: string;

  beforeAll(async () => {
    tmpSrc = join(tmpdir(), `blitz-file-src-${Date.now()}.txt`);
    await Bun.write(tmpSrc, 'line1\nline2\nline3\n');
  });

  test('lines() name is file-source:<path>', () => {
    const src = FileSource.lines(tmpSrc);
    expect(src.name).toBe(`file-source:${tmpSrc}`);
  });

  test('lines() yields each non-empty line via StringCodec by default', async () => {
    const src = FileSource.lines(tmpSrc);
    const lines: string[] = [];
    for await (const msg of src.messages()) {
      lines.push(msg.value);
      msg.ack();
    }
    expect(lines).toEqual(['line1', 'line2', 'line3']);
  });

  test('lines() uses a custom codec to transform each line', async () => {
    const tmpNum = join(tmpdir(), `blitz-file-num-${Date.now()}.txt`);
    await Bun.write(tmpNum, '10\n20\n30\n');
    const numCodec = {
      encode: (v: number) => new TextEncoder().encode(String(v)),
      decode: (b: Uint8Array) => parseInt(new TextDecoder().decode(b), 10),
    };
    const src = FileSource.lines(tmpNum, numCodec);
    const nums: number[] = [];
    for await (const msg of src.messages()) {
      nums.push(msg.value);
    }
    expect(nums).toEqual([10, 20, 30]);
  });
});

describe('FileSink', () => {
  let tmpSinkFile: string;

  beforeAll(() => {
    tmpSinkFile = join(tmpdir(), `blitz-file-sink-${Date.now()}.txt`);
  });

  test('appendLines() name is file-sink:<path>', () => {
    const sink = FileSink.appendLines(tmpSinkFile);
    expect(sink.name).toBe(`file-sink:${tmpSinkFile}`);
  });

  test('appendLines() appends each value as a newline', async () => {
    const sink = FileSink.appendLines(tmpSinkFile);
    await sink.write('alpha');
    await sink.write('beta');
    const content = await Bun.file(tmpSinkFile).text();
    expect(content).toContain('alpha');
    expect(content).toContain('beta');
  });
});

// ---------------------------------------------------------------------------
// 8 — LogSink
// ---------------------------------------------------------------------------

describe('LogSink', () => {
  test('console() has name "log-sink"', () => {
    const sink = LogSink.console<string>();
    expect(sink.name).toBe('log-sink');
  });

  test('console() calls console.log with [LogSink] prefix on write', async () => {
    const spy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      const sink = LogSink.console<string>();
      await sink.write('test-value');
      expect(spy).toHaveBeenCalledWith('[LogSink]', 'test-value');
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// 9 — HttpWebhookSource
// ---------------------------------------------------------------------------

describe('HttpWebhookSource', () => {
  test('listen() name is http-webhook-source:<port><path>', () => {
    const src = HttpWebhookSource.listen(40099, '/hook');
    expect(src.name).toBe('http-webhook-source:40099/hook');
  });

  test('listen() receives a POST body and yields the decoded message', async () => {
    const port = 40098;
    const codec = JsonCodec<{ msg: string }>();
    const src = HttpWebhookSource.listen<{ msg: string }>(port, '/webhook', codec);
    const iter = src.messages()[Symbol.asyncIterator]();
    const nextPromise = iter.next(); // starts generator → starts Bun.serve()
    await Bun.sleep(20);            // give server a moment to bind
    const res = await fetch(`http://localhost:${port}/webhook`, {
      method: 'POST',
      body: JSON.stringify({ msg: 'hello-webhook' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const { value: msg } = await nextPromise;
    expect(msg.value).toEqual({ msg: 'hello-webhook' });
    msg.ack();
    await iter.return?.(); // stops server
  });
});

// ---------------------------------------------------------------------------
// NATS integration (requires running NATS server — skipped by default)
// ---------------------------------------------------------------------------

const NATS_AVAILABLE = !!process.env.NATS_URL || !!process.env.CI;

describe.skipIf(!NATS_AVAILABLE)(
  'NatsSource + NatsSink — NATS integration (requires NATS)',
  () => {
    let natsServer: ReturnType<typeof Bun.spawn>;
    let blitz: BlitzService;

    beforeAll(async () => {
      natsServer = Bun.spawn(
        [require.resolve('nats-server/bin/nats-server'), '-js', '-p', '4335'],
        { stdout: 'ignore', stderr: 'ignore' },
      );
      const { connect } = await import('@nats-io/transport-node');
      for (let i = 0; i < 30; i++) {
        try {
          const nc = await connect({ servers: 'nats://localhost:4335' });
          await nc.close();
          break;
        } catch {
          await Bun.sleep(100);
        }
      }
      blitz = await BlitzService.connect({ servers: 'nats://localhost:4335' });
    });

    afterAll(async () => {
      await blitz.shutdown();
      natsServer.kill();
    });

    test('NatsSink.toSubject encodes and NatsSource.fromSubject decodes', async () => {
      const codec = JsonCodec<{ order: number }>();
      const subject = 'blitz-test.orders.1';
      const src = NatsSource.fromSubject(blitz.nc, subject, codec);
      const sink = NatsSink.toSubject(blitz.nc, subject, codec);
      const iter = src.messages()[Symbol.asyncIterator]();
      const nextPromise = iter.next(); // start subscription
      await Bun.sleep(10);
      await sink.write({ order: 42 });
      const { value: msg } = await nextPromise;
      expect(msg.value).toEqual({ order: 42 });
      msg.ack();
      await iter.return?.();
    });
  },
);
