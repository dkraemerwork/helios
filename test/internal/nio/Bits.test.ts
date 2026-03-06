import { describe, test, expect, beforeAll } from "bun:test";
import { Bits } from "@zenystx/helios-core/internal/nio/Bits";

// Fixed 8-byte buffer — matches BitsTest random buffer initialisation
// Using distinct bytes so big-endian vs little-endian reads differ.
let readBuffer: Buffer;

// Sign-extend a 32-bit bit-manipulation result back to signed byte (–128..127).
// Needed because TypeScript has no `byte` type; JS bitwise ops are 32-bit.
const toByte = (v: number): number => (v << 24) >> 24;

beforeAll(() => {
    readBuffer = Buffer.from([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]);
});

// ── read char (unsigned 16-bit) ──────────────────────────────────────────────

describe("BitsTest – readChar", () => {
    test("testReadCharBigEndian", () => {
        const ch1 = Bits.readChar(readBuffer, 0, true);
        const ch2 = readBuffer.readUInt16BE(0);
        expect(ch1).toBe(ch2);
    });

    test("testReadCharLittleEndian", () => {
        const ch1 = Bits.readChar(readBuffer, 0, false);
        const ch2 = readBuffer.readUInt16LE(0);
        expect(ch1).toBe(ch2);
    });
});

// ── read short (signed 16-bit) ───────────────────────────────────────────────

describe("BitsTest – readShort", () => {
    test("testReadShortBigEndian", () => {
        const s1 = Bits.readShort(readBuffer, 0, true);
        const s2 = readBuffer.readInt16BE(0);
        expect(s1).toBe(s2);
    });

    test("testReadShortLittleEndian", () => {
        const s1 = Bits.readShort(readBuffer, 0, false);
        const s2 = readBuffer.readInt16LE(0);
        expect(s1).toBe(s2);
    });
});

// ── read int (signed 32-bit) ─────────────────────────────────────────────────

describe("BitsTest – readInt", () => {
    test("testReadIntBigEndian", () => {
        const i1 = Bits.readInt(readBuffer, 0, true);
        const i2 = readBuffer.readInt32BE(0);
        expect(i1).toBe(i2);
    });

    test("testReadIntLittleEndian", () => {
        const i1 = Bits.readInt(readBuffer, 0, false);
        const i2 = readBuffer.readInt32LE(0);
        expect(i1).toBe(i2);
    });
});

// ── read long (signed 64-bit → bigint) ──────────────────────────────────────

describe("BitsTest – readLong", () => {
    test("testReadLongBigEndian", () => {
        const l1 = Bits.readLong(readBuffer, 0, true);
        const l2 = readBuffer.readBigInt64BE(0);
        expect(l1).toBe(l2);
    });

    test("testReadLongLittleEndian", () => {
        const l1 = Bits.readLong(readBuffer, 0, false);
        const l2 = readBuffer.readBigInt64LE(0);
        expect(l1).toBe(l2);
    });
});

// ── write char ───────────────────────────────────────────────────────────────

describe("BitsTest – writeChar", () => {
    const C = 0xabcd; // distinct high/low bytes → endian-visible

    test("testWriteCharBigEndian", () => {
        const bb = Buffer.alloc(2);
        Bits.writeChar(bb, 0, C, true);
        const expected = Buffer.alloc(2);
        expected.writeUInt16BE(C, 0);
        expect(bb).toEqual(expected);
    });

    test("testWriteCharLittleEndian", () => {
        const bb = Buffer.alloc(2);
        Bits.writeChar(bb, 0, C, false);
        const expected = Buffer.alloc(2);
        expected.writeUInt16LE(C, 0);
        expect(bb).toEqual(expected);
    });
});

// ── write short ──────────────────────────────────────────────────────────────

describe("BitsTest – writeShort", () => {
    const S = -0x1234; // negative signed short (-4660)

    test("testWriteShortBigEndian", () => {
        const bb = Buffer.alloc(2);
        Bits.writeShort(bb, 0, S, true);
        const expected = Buffer.alloc(2);
        expected.writeInt16BE(S, 0);
        expect(bb).toEqual(expected);
    });

    test("testWriteShortLittleEndian", () => {
        const bb = Buffer.alloc(2);
        Bits.writeShort(bb, 0, S, false);
        const expected = Buffer.alloc(2);
        expected.writeInt16LE(S, 0);
        expect(bb).toEqual(expected);
    });
});

// ── write int ────────────────────────────────────────────────────────────────

describe("BitsTest – writeInt", () => {
    const I = 0x12345678; // positive 32-bit int

    test("testWriteIntBigEndian", () => {
        const bb = Buffer.alloc(4);
        Bits.writeInt(bb, 0, I, true);
        const expected = Buffer.alloc(4);
        expected.writeInt32BE(I, 0);
        expect(bb).toEqual(expected);
    });

    test("testWriteIntLittleEndian", () => {
        const bb = Buffer.alloc(4);
        Bits.writeInt(bb, 0, I, false);
        const expected = Buffer.alloc(4);
        expected.writeInt32LE(I, 0);
        expect(bb).toEqual(expected);
    });
});

// ── write long ───────────────────────────────────────────────────────────────

describe("BitsTest – writeLong", () => {
    const L = 0x0123456789abcdefn; // 64-bit bigint

    test("testWriteLongBigEndian", () => {
        const bb = Buffer.alloc(8);
        Bits.writeLong(bb, 0, L, true);
        const expected = Buffer.alloc(8);
        expected.writeBigInt64BE(L, 0);
        expect(bb).toEqual(expected);
    });

    test("testWriteLongLittleEndian", () => {
        const bb = Buffer.alloc(8);
        Bits.writeLong(bb, 0, L, false);
        const expected = Buffer.alloc(8);
        expected.writeBigInt64LE(L, 0);
        expect(bb).toEqual(expected);
    });
});

// ── writeUtf8Char ────────────────────────────────────────────────────────────

test("testWriteUtf8Char", () => {
    const bytes = Buffer.alloc(3);
    const c1 = 0x0010; // 1-byte UTF-8 (< 0x80)
    const c2 = 0x0080; // 2-byte UTF-8 (< 0x800)
    const c3 = 0x0800; // 3-byte UTF-8 (< 0x10000)
    expect(Bits.writeUtf8Char(bytes, 0, c1)).toBe(1);
    expect(Bits.writeUtf8Char(bytes, 0, c2)).toBe(2);
    expect(Bits.writeUtf8Char(bytes, 0, c3)).toBe(3);
});

// ── bit manipulation — byte context ─────────────────────────────────────────

test("testSetBitByte", () => {
    let b = 110;
    b = Bits.setBit(b, 0);
    expect(b).toBe(111);

    // In Java this is stored back as a `byte`, so bit 7 set → negative.
    // TypeScript has no byte type; apply explicit sign-extension.
    const asByte = toByte(Bits.setBit(b, 7));
    expect(asByte < 0).toBe(true);
});

test("testClearBitByte", () => {
    let b = 111;
    b = Bits.clearBit(b, 0);
    expect(b).toBe(110);

    // –111 as signed byte = 145 (0x91); clear bit 7 → 0x11 = 17 > 0
    const asByte = toByte(Bits.clearBit(-111 & 0xff, 7));
    expect(asByte > 0).toBe(true);
});

test("testInvertBitByte", () => {
    // –111 as unsigned byte = 0x91; invert bit 7 → 0x11 = 17 > 0
    const asByte = toByte(Bits.invertBit(-111 & 0xff, 7));
    expect(asByte > 0).toBe(true);
});

// ── bit manipulation — int context ──────────────────────────────────────────

test("testSetBitInteger", () => {
    let b = 110;
    b = Bits.setBit(b, 0);
    expect(b).toBe(111);

    b = Bits.setBit(b, 31); // set high bit → negative signed 32-bit
    expect(b < 0).toBe(true);
});

test("testClearBitInteger", () => {
    let b = 111;
    b = Bits.clearBit(b, 0);
    expect(b).toBe(110);

    b = -111;
    b = Bits.clearBit(b, 31); // clear high bit of negative → positive
    expect(b > 0).toBe(true);
});

test("testInvertBitInteger", () => {
    let b = -111111;
    b = Bits.invertBit(b, 31); // flip high bit → positive
    expect(b > 0).toBe(true);
});

// ── isBitSet ─────────────────────────────────────────────────────────────────

test("testIsBitSet", () => {
    expect(Bits.isBitSet(123, 31)).toBe(false);
    expect(Bits.isBitSet(-123, 31)).toBe(true);
    expect(Bits.isBitSet(222, 0)).toBe(false);
    expect(Bits.isBitSet(221, 0)).toBe(true);
});

// ── combineToInt / extractShort ──────────────────────────────────────────────

test("testCombineToInt", () => {
    const x = -100; // signed short
    const y = 200;  // signed short
    const k = Bits.combineToInt(x, y);
    expect(Bits.extractShort(k, false)).toBe(x);
    expect(Bits.extractShort(k, true)).toBe(y);
});

// ── combineToLong / extractInt ───────────────────────────────────────────────

test("testCombineToLong", () => {
    const x = -100000; // signed int
    const y = 200000;  // signed int
    const k = Bits.combineToLong(x, y);
    expect(Bits.extractInt(k, false)).toBe(x);
    expect(Bits.extractInt(k, true)).toBe(y);
});
