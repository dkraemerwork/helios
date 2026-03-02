/**
 * Bun-native Eventloop transport parity tests.
 *
 * Behavioral requirements (replacing Java TPC engine):
 *   - TCP listen/connect round-trip with FIFO ordering
 *   - Bounded outbound buffering: write() returns false when limit exceeded
 *   - write() returns false after channel is closed
 *   - onClose fires when remote end closes
 *   - Multiple simultaneous connections are independent
 *   - bytesRead / bytesWritten counters are accurate
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { Eventloop, EventloopChannel, EventloopServer } from '@helios/internal/eventloop/Eventloop';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Spin-wait until predicate is true or timeout expires. */
async function waitUntil(pred: () => boolean, timeoutMs = 1500): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!pred() && Date.now() < deadline) {
        await Bun.sleep(5);
    }
}

/** Collect all chunks received by a channel into a single Buffer. */
function collector(): { chunks: Buffer[]; concat(): Buffer } {
    const chunks: Buffer[] = [];
    return {
        chunks,
        concat: () => Buffer.concat(chunks),
    };
}

// ─── test suite ───────────────────────────────────────────────────────────────

describe('Eventloop', () => {
    const servers: EventloopServer[] = [];
    const channels: EventloopChannel[] = [];

    afterEach(() => {
        for (const ch of channels.splice(0)) {
            if (!ch.isClosed()) ch.close();
        }
        for (const srv of servers.splice(0)) {
            srv.stop();
        }
    });

    // ── 1. client → server round-trip ──────────────────────────────────────
    test('client → server: data received by server', async () => {
        const received = collector();

        const srv = Eventloop.listen(0, '127.0.0.1', {
            onData: (_ch, data) => received.chunks.push(Buffer.from(data)),
        });
        servers.push(srv);

        const ch = await Eventloop.connect(srv.port(), '127.0.0.1', {});
        channels.push(ch);

        expect(ch.write(Buffer.from('hello-server'))).toBe(true);

        await waitUntil(() => received.concat().includes(Buffer.from('hello-server')));
        expect(received.concat().toString()).toBe('hello-server');
    });

    // ── 2. server → client round-trip ──────────────────────────────────────
    test('server → client: data received by client', async () => {
        const received = collector();

        const srv = Eventloop.listen(0, '127.0.0.1', {
            onConnect: (serverSide) => {
                serverSide.write(Buffer.from('hello-client'));
            },
        });
        servers.push(srv);

        const ch = await Eventloop.connect(srv.port(), '127.0.0.1', {
            onData: (_ch, data) => received.chunks.push(Buffer.from(data)),
        });
        channels.push(ch);

        await waitUntil(() => received.concat().includes(Buffer.from('hello-client')));
        expect(received.concat().toString()).toBe('hello-client');
    });

    // ── 3. FIFO ordering ───────────────────────────────────────────────────
    test('FIFO ordering: 10 sequential sends arrive in order', async () => {
        const received: number[] = [];

        const srv = Eventloop.listen(0, '127.0.0.1', {
            onData: (_ch, data) => {
                // each message is a 4-byte big-endian int
                for (let i = 0; i + 3 < data.length; i += 4) {
                    received.push(data.readInt32BE(i));
                }
            },
        });
        servers.push(srv);

        const ch = await Eventloop.connect(srv.port(), '127.0.0.1', {});
        channels.push(ch);

        const N = 10;
        for (let i = 0; i < N; i++) {
            const buf = Buffer.allocUnsafe(4);
            buf.writeInt32BE(i, 0);
            expect(ch.write(buf)).toBe(true);
        }

        await waitUntil(() => received.length >= N);
        expect(received).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    // ── 4. bounded buffer: single oversized write rejected ─────────────────
    test('bounded buffer: single write larger than limit returns false', async () => {
        const srv = Eventloop.listen(0, '127.0.0.1', {});
        servers.push(srv);

        const ch = await Eventloop.connect(srv.port(), '127.0.0.1', {}, {
            maxOutboundBytes: 100,
        });
        channels.push(ch);

        // 200-byte write exceeds 100-byte limit immediately
        const large = Buffer.alloc(200, 0x42);
        expect(ch.write(large)).toBe(false);
    });

    // ── 5. bounded buffer: cumulative pressure ────────────────────────────
    test('bounded buffer: cumulative writes rejected when limit crossed', async () => {
        const srv = Eventloop.listen(0, '127.0.0.1', {});
        servers.push(srv);

        const ch = await Eventloop.connect(srv.port(), '127.0.0.1', {}, {
            maxOutboundBytes: 100,
        });
        channels.push(ch);

        // First write fits (50 bytes pending)
        expect(ch.write(Buffer.alloc(50, 0xaa))).toBe(true);
        // Second write would bring total to 110 > 100 → reject
        // (no await between writes, so drain cannot have fired)
        expect(ch.write(Buffer.alloc(60, 0xbb))).toBe(false);
    });

    // ── 6. write after close returns false ────────────────────────────────
    test('write returns false after channel is closed', async () => {
        const srv = Eventloop.listen(0, '127.0.0.1', {});
        servers.push(srv);

        const ch = await Eventloop.connect(srv.port(), '127.0.0.1', {});
        channels.push(ch);

        ch.close();
        expect(ch.isClosed()).toBe(true);
        expect(ch.write(Buffer.from('ghost'))).toBe(false);
    });

    // ── 7. onClose fires when remote end closes ────────────────────────────
    test('onClose fires on client when server closes the channel', async () => {
        let clientCloseFired = false;

        const srv = Eventloop.listen(0, '127.0.0.1', {
            onConnect: (serverSide) => {
                // server immediately closes this connection
                serverSide.close();
            },
        });
        servers.push(srv);

        const ch = await Eventloop.connect(srv.port(), '127.0.0.1', {
            onClose: () => { clientCloseFired = true; },
        });
        channels.push(ch);

        await waitUntil(() => clientCloseFired);
        expect(clientCloseFired).toBe(true);
    });

    // ── 8. multiple simultaneous connections ──────────────────────────────
    test('multiple connections are independent', async () => {
        const serverReceived: Map<number, Buffer[]> = new Map();
        let connId = 0;

        const srv = Eventloop.listen(0, '127.0.0.1', {
            onConnect: (serverSide) => {
                const id = connId++;
                serverReceived.set(id, []);
                // Tag the channel so data callback can find it
                (serverSide as unknown as { _testId: number })._testId = id;
            },
            onData: (serverSide, data) => {
                const id = (serverSide as unknown as { _testId: number })._testId;
                serverReceived.get(id)?.push(Buffer.from(data));
            },
        });
        servers.push(srv);

        const port = srv.port();
        const [ch1, ch2, ch3] = await Promise.all([
            Eventloop.connect(port, '127.0.0.1', {}),
            Eventloop.connect(port, '127.0.0.1', {}),
            Eventloop.connect(port, '127.0.0.1', {}),
        ]);
        channels.push(ch1, ch2, ch3);

        ch1.write(Buffer.from('from-1'));
        ch2.write(Buffer.from('from-2'));
        ch3.write(Buffer.from('from-3'));

        await waitUntil(() => [...serverReceived.values()].filter(v => v.length > 0).length >= 3);

        const allData = [...serverReceived.values()]
            .map(chunks => Buffer.concat(chunks).toString())
            .sort();

        expect(allData).toEqual(['from-1', 'from-2', 'from-3'].sort());
    });

    // ── 9. bytesRead / bytesWritten counters ──────────────────────────────
    test('bytesRead and bytesWritten counters are accurate', async () => {
        let serverChannel: EventloopChannel | undefined;

        const srv = Eventloop.listen(0, '127.0.0.1', {
            onConnect: (ch) => { serverChannel = ch; },
        });
        servers.push(srv);

        const clientCh = await Eventloop.connect(srv.port(), '127.0.0.1', {});
        channels.push(clientCh);

        const msg = Buffer.from('count-me');
        clientCh.write(msg);

        await waitUntil(() => (serverChannel?.bytesRead() ?? 0) >= msg.length);

        expect(clientCh.bytesWritten()).toBe(msg.length);
        expect(serverChannel!.bytesRead()).toBe(msg.length);
    });
});
