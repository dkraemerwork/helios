#!/usr/bin/env bun
/**
 * Serialization pipeline microbenchmark for Helios cluster messages.
 *
 * Measures ns/op for each stage of the OPERATION message hot path:
 *   Send: serializeOperation → JSON.stringify → Buffer.from (utf8) → length-prefix write
 *   Recv: Buffer.toString(utf8) → JSON.parse → deserializeOperation
 *
 * Run:  bun run examples/native-app/src/bench-ser.ts
 */

const ITERATIONS = 100_000;

/* ── Build a realistic OPERATION message matching IMap.set() ──────── */

// Simulate ~50-byte key and ~120-byte value (typical stress-test payloads)
const keyBuf = Buffer.from(
  JSON.stringify({ type: 2, data: "stress-key-00042" }),
);
const valueBuf = Buffer.alloc(120);
for (let i = 0; i < valueBuf.length; i++) valueBuf[i] = 0x41 + (i % 26);

const keyB64 = keyBuf.toString("base64");
const valueB64 = valueBuf.toString("base64");

const operationMsg = {
  type: "OPERATION" as const,
  callId: 123456,
  partitionId: 42,
  operationType: "MAP_SET_OP",
  payload: {
    mapName: "stress-map",
    key: keyB64,
    value: valueB64,
    ttl: -1,
    maxIdle: -1,
  },
  senderId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
};

/* Pre-compute strings needed by individual-step benchmarks */
const jsonStr = JSON.stringify(operationMsg);
const jsonBuf = Buffer.from(jsonStr, "utf8");
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/* ── Helpers ──────────────────────────────────────────────────────── */

function bench(
  label: string,
  iterations: number,
  fn: () => void,
): { label: string; totalMs: number; nsPerOp: number } {
  // Warmup — 1000 iterations or 10% whichever is smaller
  const warmup = Math.min(1000, Math.floor(iterations * 0.1));
  for (let i = 0; i < warmup; i++) fn();

  const start = Bun.nanoseconds();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = Bun.nanoseconds() - start;

  const totalMs = elapsed / 1_000_000;
  const nsPerOp = elapsed / iterations;
  return { label, totalMs, nsPerOp };
}

function fmtNs(ns: number): string {
  if (ns >= 1_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
  if (ns >= 1_000) return `${(ns / 1_000).toFixed(2)} us`;
  return `${ns.toFixed(1)} ns`;
}

/* ── Benchmarks ───────────────────────────────────────────────────── */

console.log("=".repeat(72));
console.log("  Helios Serialization Pipeline Microbenchmark");
console.log(`  Iterations: ${ITERATIONS.toLocaleString()}`);
console.log(`  JSON payload size: ${jsonStr.length} bytes`);
console.log(`  UTF-8 buffer size: ${jsonBuf.length} bytes`);
console.log(`  Key base64: ${keyB64.length} chars (from ${keyBuf.length} raw bytes)`);
console.log(`  Value base64: ${valueB64.length} chars (from ${valueBuf.length} raw bytes)`);
console.log("=".repeat(72));
console.log();

const results: ReturnType<typeof bench>[] = [];
let sink: unknown; // prevent dead-code elimination

// 1. JSON.stringify alone
results.push(
  bench("JSON.stringify(msg)", ITERATIONS, () => {
    sink = JSON.stringify(operationMsg);
  }),
);

// 2. Buffer.from(str, 'utf8') alone
results.push(
  bench("Buffer.from(jsonStr, 'utf8')", ITERATIONS, () => {
    sink = Buffer.from(jsonStr, "utf8");
  }),
);

// 3. JSON.parse alone
results.push(
  bench("JSON.parse(jsonStr)", ITERATIONS, () => {
    sink = JSON.parse(jsonStr);
  }),
);

// 4. Base64 encode (~50 byte buffer)
results.push(
  bench("base64 encode (keyBuf, 50B)", ITERATIONS, () => {
    sink = keyBuf.toString("base64");
  }),
);

// 5. Base64 decode
results.push(
  bench("base64 decode (keyB64 → Buffer)", ITERATIONS, () => {
    sink = Buffer.from(keyB64, "base64");
  }),
);

// 6. Base64 encode (~120 byte buffer)
results.push(
  bench("base64 encode (valueBuf, 120B)", ITERATIONS, () => {
    sink = valueBuf.toString("base64");
  }),
);

// 7. Base64 decode (~120 byte value)
results.push(
  bench("base64 decode (valueB64 → Buffer)", ITERATIONS, () => {
    sink = Buffer.from(valueB64, "base64");
  }),
);

// 8. TextEncoder.encode as alternative to Buffer.from
results.push(
  bench("TextEncoder.encode(jsonStr)", ITERATIONS, () => {
    sink = textEncoder.encode(jsonStr);
  }),
);

// 9. Full send pipeline: stringify + Buffer.from
results.push(
  bench("FULL SEND: stringify + Buffer.from", ITERATIONS, () => {
    const s = JSON.stringify(operationMsg);
    sink = Buffer.from(s, "utf8");
  }),
);

// 10. Full send pipeline: stringify + TextEncoder
results.push(
  bench("FULL SEND: stringify + TextEncoder", ITERATIONS, () => {
    const s = JSON.stringify(operationMsg);
    sink = textEncoder.encode(s);
  }),
);

// 11. Full receive pipeline: Buffer.toString + JSON.parse
results.push(
  bench("FULL RECV: buf.toString + JSON.parse", ITERATIONS, () => {
    const s = jsonBuf.toString("utf8");
    sink = JSON.parse(s);
  }),
);

// 12. Full receive pipeline: TextDecoder + JSON.parse
results.push(
  bench("FULL RECV: TextDecoder + JSON.parse", ITERATIONS, () => {
    const s = textDecoder.decode(jsonBuf);
    sink = JSON.parse(s);
  }),
);

// 13. Length-prefix framing (4-byte header + payload write)
results.push(
  bench("Length prefix (4B header + copy)", ITERATIONS, () => {
    const frame = Buffer.allocUnsafe(4 + jsonBuf.length);
    frame.writeUInt32BE(jsonBuf.length, 0);
    jsonBuf.copy(frame, 4);
    sink = frame;
  }),
);

/* ── Report ───────────────────────────────────────────────────────── */

console.log(
  "Step".padEnd(44) +
    "Total".padStart(10) +
    "ns/op".padStart(12) +
    "ops/sec".padStart(14),
);
console.log("-".repeat(80));

for (const r of results) {
  const opsPerSec = Math.round(1_000_000_000 / r.nsPerOp);
  console.log(
    r.label.padEnd(44) +
      `${r.totalMs.toFixed(1)} ms`.padStart(10) +
      fmtNs(r.nsPerOp).padStart(12) +
      opsPerSec.toLocaleString().padStart(14),
  );
}

console.log();
console.log(`(sink = ${typeof sink} to prevent DCE)`);
