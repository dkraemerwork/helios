#!/usr/bin/env bun
/**
 * Scatter channel benchmark — measures actual SAB ring-buffer throughput.
 *
 * Tests one-way push throughput (the architecturally relevant metric)
 * and compares against sync on main thread.
 *
 * Run:  bun run examples/native-app/src/bench-channels.ts
 */

import { scatter, Channel } from '@zenystx/scatterjs';

const N = 100_000;
const RING = 32 * 1024 * 1024; // 32 MB — never backpressure at this payload size

// ── Payload ────────────────────────────────────────────────────────
const keyBuf = Buffer.from(JSON.stringify({ type: 2, data: 'stress-key-00042' }));
const valueBuf = Buffer.alloc(120);
for (let i = 0; i < valueBuf.length; i++) valueBuf[i] = 0x41 + (i % 26);

const operationMsg = {
    type: 'OPERATION' as const,
    callId: 123456,
    partitionId: 42,
    operationType: 'MAP_SET_OP',
    payload: {
        mapName: 'stress-map',
        key: keyBuf.toString('base64'),
        value: valueBuf.toString('base64'),
        ttl: -1,
        maxIdle: -1,
    },
    senderId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
};

const jsonStr = JSON.stringify(operationMsg);
const jsonBytes = new TextEncoder().encode(jsonStr);
const enc = new TextEncoder();

console.log('='.repeat(72));
console.log('  Scatter Channel Benchmark');
console.log(`  N=${N.toLocaleString()}, payload=${jsonBytes.length}B, ring=${RING / 1024 / 1024}MB`);
console.log('='.repeat(72));
console.log();

type R = { label: string; nsPerOp: number };

function fmtNs(ns: number): string {
    if (ns >= 1_000_000) return `${(ns / 1_000_000).toFixed(1)} ms`;
    if (ns >= 1000) return `${(ns / 1000).toFixed(1)} us`;
    return `${ns.toFixed(0)} ns`;
}

// ═══════════════════════════════════════════════════════════════════
// 1. SYNC BASELINE: stringify + encode + frame on main thread
// ═══════════════════════════════════════════════════════════════════
function test1_sync(): R {
    let sink: unknown;
    // warmup
    for (let i = 0; i < 5000; i++) {
        const j = JSON.stringify(operationMsg);
        sink = enc.encode(j);
    }
    const start = Bun.nanoseconds();
    for (let i = 0; i < N; i++) {
        const j = JSON.stringify(operationMsg);
        const p = enc.encode(j);
        const f = new Uint8Array(4 + p.length);
        new DataView(f.buffer).setUint32(0, p.length);
        f.set(p, 4);
        sink = f;
    }
    void sink;
    return { label: 'SYNC: stringify+encode+frame (main thread)', nsPerOp: (Bun.nanoseconds() - start) / N };
}

// ═══════════════════════════════════════════════════════════════════
// 2. RAW CHANNEL: main pushes pre-encoded bytes, worker just counts
//    Measures: pure ring-buffer write throughput from main thread
// ═══════════════════════════════════════════════════════════════════
async function test2_rawPush(): Promise<R> {
    const handle = scatter.spawn(
        (ctx: any) => {
            const ch = ctx.channel('data');
            const d = ctx.channel('done');
            let c = 0;
            while (true) { const m = ch.readBlocking(); if (m === null) break; c++; }
            d.write(c);
            d.close();
        },
        { channels: { data: Channel.in<Uint8Array>({ codec: 'raw', capacity: RING }), done: Channel.out<number>({ codec: 'number' }) } as any },
    );
    const w = (handle as any).channels.data;
    const d = (handle as any).channels.done;
    // warmup
    for (let i = 0; i < 5000; i++) w.write(jsonBytes);
    const start = Bun.nanoseconds();
    for (let i = 0; i < N; i++) w.write(jsonBytes);
    const elapsed = Bun.nanoseconds() - start;
    w.close();
    const processed = await d.readAsync();
    await handle.shutdown();
    console.log(`    raw push: ${processed! + 5000} consumed`);
    return { label: 'RAW PUSH: bytes → ring (main thread cost)', nsPerOp: elapsed / N };
}

// ═══════════════════════════════════════════════════════════════════
// 3. JSON CHANNEL: main pushes objects via json codec, worker stringifies
//    Main thread cost: JSON.stringify + TextEncoder.encode + ring push
//    Worker cost: ring pop + TextDecoder.decode + JSON.parse + JSON.stringify
// ═══════════════════════════════════════════════════════════════════
async function test3_jsonPush(): Promise<R> {
    const handle = scatter.spawn(
        (ctx: any) => {
            const ch = ctx.channel('data');
            const d = ctx.channel('done');
            const e = new TextEncoder();
            let c = 0;
            while (true) {
                const m = ch.readBlocking();
                if (m === null) break;
                // Worker re-stringifies (the work we want offloaded)
                e.encode(JSON.stringify(m));
                c++;
            }
            d.write(c);
            d.close();
        },
        { channels: { data: Channel.in({ codec: 'json', capacity: RING }), done: Channel.out<number>({ codec: 'number' }) } as any },
    );
    const w = (handle as any).channels.data;
    const d = (handle as any).channels.done;
    for (let i = 0; i < 5000; i++) w.write(operationMsg);
    const start = Bun.nanoseconds();
    for (let i = 0; i < N; i++) w.write(operationMsg);
    const elapsed = Bun.nanoseconds() - start;
    w.close();
    const processed = await d.readAsync();
    await handle.shutdown();
    console.log(`    json push: ${processed! + 5000} consumed`);
    return { label: 'JSON PUSH: obj → json codec → ring (main cost)', nsPerOp: elapsed / N };
}

// ═══════════════════════════════════════════════════════════════════
// 4. END-TO-END: push objects, worker produces frames, main reads frames
//    This is the full proposed architecture measured as total wall time
// ═══════════════════════════════════════════════════════════════════
async function test4_endToEnd(): Promise<R> {
    const handle = scatter.spawn(
        (ctx: any) => {
            const input = ctx.channel('input');
            const output = ctx.channel('output');
            const e = new TextEncoder();
            while (true) {
                const msg = input.readBlocking();
                if (msg === null) break;
                const json = JSON.stringify(msg);
                const p = e.encode(json);
                const f = new Uint8Array(4 + p.length);
                new DataView(f.buffer).setUint32(0, p.length);
                f.set(p, 4);
                output.write(f);
            }
            output.close();
        },
        {
            channels: {
                input: Channel.in({ codec: 'json', capacity: RING }),
                output: Channel.out<Uint8Array>({ codec: 'raw', capacity: RING }),
            } as any,
        },
    );

    const w = (handle as any).channels.input;
    const r = (handle as any).channels.output;

    // Push all messages first (one-way), then drain all results
    // This measures the pipeline throughput, not per-message latency
    console.log('    pushing...');
    const start = Bun.nanoseconds();
    for (let i = 0; i < N; i++) w.write(operationMsg);
    w.close();

    console.log('    draining...');
    let received = 0;
    while (true) {
        const frame = await r.readAsync();
        if (frame === null) break;
        received++;
    }
    const elapsed = Bun.nanoseconds() - start;
    await handle.shutdown();

    console.log(`    e2e: ${received} frames received`);
    return { label: 'E2E: push→worker stringify→drain frames', nsPerOp: elapsed / received };
}

// ═══════════════════════════════════════════════════════════════════
// 5. PARALLEL WORKERS: 2 workers, round-robin push, drain both
//    Demonstrates scaling serialization across cores
// ═══════════════════════════════════════════════════════════════════
async function test5_parallel(): Promise<R> {
    const workerFn = (ctx: any) => {
        const input = ctx.channel('input');
        const output = ctx.channel('output');
        const e = new TextEncoder();
        while (true) {
            const msg = input.readBlocking();
            if (msg === null) break;
            const json = JSON.stringify(msg);
            const p = e.encode(json);
            const f = new Uint8Array(4 + p.length);
            new DataView(f.buffer).setUint32(0, p.length);
            f.set(p, 4);
            output.write(f);
        }
        output.close();
    };
    const mkChannels = () => ({
        input: Channel.in({ codec: 'json', capacity: RING }),
        output: Channel.out<Uint8Array>({ codec: 'raw', capacity: RING }),
    } as any);

    const h1 = scatter.spawn(workerFn, { channels: mkChannels() });
    const h2 = scatter.spawn(workerFn, { channels: mkChannels() });

    const w1 = (h1 as any).channels.input;
    const w2 = (h2 as any).channels.input;
    const r1 = (h1 as any).channels.output;
    const r2 = (h2 as any).channels.output;

    console.log('    pushing to 2 workers...');
    const start = Bun.nanoseconds();
    for (let i = 0; i < N; i++) {
        if (i % 2 === 0) w1.write(operationMsg);
        else w2.write(operationMsg);
    }
    w1.close();
    w2.close();

    let received = 0;
    const drain = async (reader: any) => {
        while (true) {
            const f = await reader.readAsync();
            if (f === null) break;
            received++;
        }
    };
    await Promise.all([drain(r1), drain(r2)]);
    const elapsed = Bun.nanoseconds() - start;

    await Promise.all([h1.shutdown(), h2.shutdown()]);
    console.log(`    parallel: ${received} frames`);
    return { label: 'PARALLEL: 2 workers round-robin', nsPerOp: elapsed / received };
}

// ═══════════════════════════════════════════════════════════════════
// 6. 4 PARALLEL WORKERS
// ═══════════════════════════════════════════════════════════════════
async function test6_parallel4(): Promise<R> {
    const WORKERS = 4;
    const workerFn = (ctx: any) => {
        const input = ctx.channel('input');
        const output = ctx.channel('output');
        const e = new TextEncoder();
        while (true) {
            const msg = input.readBlocking();
            if (msg === null) break;
            const json = JSON.stringify(msg);
            const p = e.encode(json);
            const f = new Uint8Array(4 + p.length);
            new DataView(f.buffer).setUint32(0, p.length);
            f.set(p, 4);
            output.write(f);
        }
        output.close();
    };
    const mkChannels = () => ({
        input: Channel.in({ codec: 'json', capacity: RING }),
        output: Channel.out<Uint8Array>({ codec: 'raw', capacity: RING }),
    } as any);

    const handles = Array.from({ length: WORKERS }, () => scatter.spawn(workerFn, { channels: mkChannels() }));
    const writers = handles.map((h: any) => h.channels.input);
    const readers = handles.map((h: any) => h.channels.output);

    console.log(`    pushing to ${WORKERS} workers...`);
    const start = Bun.nanoseconds();
    for (let i = 0; i < N; i++) {
        writers[i % WORKERS].write(operationMsg);
    }
    for (const w of writers) w.close();

    let received = 0;
    await Promise.all(readers.map(async (reader: any) => {
        while (true) {
            const f = await reader.readAsync();
            if (f === null) break;
            received++;
        }
    }));
    const elapsed = Bun.nanoseconds() - start;

    await Promise.all(handles.map((h: any) => h.shutdown()));
    console.log(`    parallel-4: ${received} frames`);
    return { label: `PARALLEL: ${WORKERS} workers round-robin`, nsPerOp: elapsed / received };
}

// ═══════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
    const results: R[] = [];

    console.log('1/6 Sync baseline...');
    results.push(test1_sync());

    console.log('2/6 Raw push throughput...');
    results.push(await test2_rawPush());

    console.log('3/6 JSON push throughput...');
    results.push(await test3_jsonPush());

    console.log('4/6 End-to-end single worker...');
    results.push(await test4_endToEnd());

    console.log('5/6 End-to-end 2 workers...');
    results.push(await test5_parallel());

    console.log('6/6 End-to-end 4 workers...');
    results.push(await test6_parallel4());

    console.log();
    console.log('='.repeat(84));
    console.log('  Test'.padEnd(56) + 'ns/op'.padStart(12) + 'ops/sec'.padStart(14));
    console.log('-'.repeat(84));

    for (const r of results) {
        console.log(
            `  ${r.label}`.padEnd(56) + fmtNs(r.nsPerOp).padStart(12)
            + Math.round(1e9 / r.nsPerOp).toLocaleString().padStart(14),
        );
    }

    const sync = results[0]!;
    console.log();
    console.log('── vs sync baseline ──');
    for (const r of results.slice(1)) {
        const ratio = r.nsPerOp / sync.nsPerOp;
        const pct = Math.round((ratio - 1) * 100);
        const arrow = ratio > 1.1 ? 'SLOWER' : ratio < 0.9 ? 'FASTER' : '~SAME';
        console.log(`  ${r.label.padEnd(52)} ${ratio.toFixed(2)}x (${pct > 0 ? '+' : ''}${pct}%) ${arrow}`);
    }
    console.log('='.repeat(84));
}

main().catch(console.error);
