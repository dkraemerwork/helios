import { JsonValue } from '@zenystx/helios-core/internal/json/JsonValue';
import { Json } from '@zenystx/helios-core/internal/json/Json';
import type { JsonWriter } from '@zenystx/helios-core/internal/json/JsonWriter';

/** A name/value pair in a JSON object. */
export class Member {
  constructor(
    readonly name: string,
    readonly value: JsonValue,
  ) {}

  getName(): string { return this.name; }
  getValue(): JsonValue { return this.value; }

  equals(other: unknown): boolean {
    if (this === other) return true;
    if (!(other instanceof Member)) return false;
    return this.name === other.name && this.value.equals(other.value);
  }

  hashCode(): number {
    let h = 1;
    h = (Math.imul(31, h) + stringHash(this.name)) | 0;
    h = (Math.imul(31, h) + (this.value as unknown as { hashCode(): number }).hashCode()) | 0;
    return h;
  }
}

function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

/** 32-slot hash table mapping name → last-known index+1 (0 = empty). */
export class HashIndexTable {
  private readonly hashTable: Uint8Array = new Uint8Array(32); // must be power of 2

  constructor(original?: HashIndexTable) {
    if (original) {
      this.hashTable.set(original.hashTable);
    }
  }

  add(name: string, index: number): void {
    const slot = this.hashSlotFor(name);
    if (index < 0xff) {
      this.hashTable[slot] = index + 1;
    } else {
      this.hashTable[slot] = 0;
    }
  }

  remove(index: number): void {
    for (let i = 0; i < this.hashTable.length; i++) {
      if (this.hashTable[i] === index + 1) {
        this.hashTable[i] = 0;
      } else if (this.hashTable[i] > index + 1) {
        this.hashTable[i]--;
      }
    }
  }

  get(name: string): number {
    const slot = this.hashSlotFor(name);
    return (this.hashTable[slot] & 0xff) - 1;
  }

  private hashSlotFor(name: string): number {
    return stringHash(name) & (this.hashTable.length - 1);
  }
}

/** Ordered JSON object (name/value pairs) with O(1) name lookup. */
export class JsonObject extends JsonValue implements Iterable<Member> {
  private readonly _names: string[];
  private readonly values: JsonValue[];
  private table: HashIndexTable;
  private readonly _unmodifiable: boolean;

  constructor(object?: JsonObject) {
    super();
    if (object !== undefined) {
      if (object === null) throw new Error('object is null');
      this._names = [...object._names];
      this.values = [...object.values];
      this.table = new HashIndexTable();
      this._unmodifiable = false;
      this.updateHashIndex();
    } else {
      this._names = [];
      this.values = [];
      this.table = new HashIndexTable();
      this._unmodifiable = false;
    }
  }

  static unmodifiableObject(object: JsonObject): JsonObject {
    const inst = Object.create(JsonObject.prototype) as JsonObject;
    // @ts-expect-error private field assignment
    inst._names = object._names; // backed by same arrays
    // @ts-expect-error private field assignment
    inst.values = object.values;
    inst.table = new HashIndexTable();
    // @ts-expect-error private field assignment
    inst._unmodifiable = true;
    (inst as unknown as { updateHashIndex(): void }).updateHashIndex();
    return inst;
  }

  private checkModifiable(): void {
    if (this._unmodifiable) {
      throw new Error('object is not modifiable');
    }
  }

  add(name: string, value: number | boolean | string | JsonValue | null): this {
    this.checkModifiable();
    if (name === null || name === undefined) throw new Error('name is null');
    const jv = value instanceof JsonValue ? value : Json.value(value as never);
    if (jv === null) throw new Error('value is null');
    this.table.add(name, this._names.length);
    this._names.push(name);
    this.values.push(jv);
    return this;
  }

  set(name: string, value: number | boolean | string | JsonValue | null): this {
    this.checkModifiable();
    if (name === null || name === undefined) throw new Error('name is null');
    const jv = value instanceof JsonValue ? value : Json.value(value as never);
    if (jv === null) throw new Error('value is null');
    const index = this.indexOf(name);
    if (index !== -1) {
      this.values[index] = jv;
    } else {
      this.table.add(name, this._names.length);
      this._names.push(name);
      this.values.push(jv);
    }
    return this;
  }

  remove(name: string): this {
    this.checkModifiable();
    if (name === null || name === undefined) throw new Error('name is null');
    const index = this.indexOf(name);
    if (index !== -1) {
      this.table.remove(index);
      this._names.splice(index, 1);
      this.values.splice(index, 1);
    }
    return this;
  }

  merge(object: JsonObject): this {
    this.checkModifiable();
    if (object === null || object === undefined) throw new Error('object is null');
    for (const member of object) {
      this.set(member.name, member.value);
    }
    return this;
  }

  get(name: string): JsonValue | null {
    if (name === null || name === undefined) throw new Error('name is null');
    const index = this.indexOf(name);
    return index !== -1 ? this.values[index] : null;
  }

  getInt(name: string, defaultValue: number): number {
    const value = this.get(name);
    return value !== null ? value.asInt() : defaultValue;
  }

  getLong(name: string, defaultValue: number): number {
    const value = this.get(name);
    return value !== null ? value.asLong() : defaultValue;
  }

  getFloat(name: string, defaultValue: number): number {
    const value = this.get(name);
    return value !== null ? value.asFloat() : defaultValue;
  }

  getDouble(name: string, defaultValue: number): number {
    const value = this.get(name);
    return value !== null ? value.asDouble() : defaultValue;
  }

  getBoolean(name: string, defaultValue: boolean): boolean {
    const value = this.get(name);
    return value !== null ? value.asBoolean() : defaultValue;
  }

  getString(name: string, defaultValue: string): string {
    const value = this.get(name);
    return value !== null ? value.asString() : defaultValue;
  }

  size(): number { return this._names.length; }
  isEmpty(): boolean { return this._names.length === 0; }

  names(): string[] {
    return [...this._names];
  }

  [Symbol.iterator](): Iterator<Member> {
    let i = 0;
    const ns = this._names;
    const vs = this.values;
    return {
      next(): IteratorResult<Member> {
        if (i < ns.length) {
          return { value: new Member(ns[i], vs[i++]), done: false };
        }
        return { value: undefined as unknown as Member, done: true };
      },
    };
  }

  write(writer: JsonWriter): void {
    writer.writeObjectOpen();
    let first = true;
    for (let i = 0; i < this._names.length; i++) {
      if (!first) writer.writeObjectSeparator();
      writer.writeMemberName(this._names[i]);
      writer.writeMemberSeparator();
      this.values[i].write(writer);
      first = false;
    }
    writer.writeObjectClose();
  }

  override isObject(): boolean { return true; }
  override asObject(): JsonObject { return this; }

  indexOf(name: string): number {
    const index = this.table.get(name);
    if (index !== -1 && name === this._names[index]) {
      return index;
    }
    return this._names.lastIndexOf(name);
  }

  private updateHashIndex(): void {
    for (let i = 0; i < this._names.length; i++) {
      this.table.add(this._names[i], i);
    }
  }

  equals(other: unknown): boolean {
    if (this === other) return true;
    if (!(other instanceof JsonObject)) return false;
    if (this._names.length !== other._names.length) return false;
    for (let i = 0; i < this._names.length; i++) {
      if (this._names[i] !== other._names[i]) return false;
      if (!this.values[i].equals(other.values[i])) return false;
    }
    return true;
  }

  hashCode(): number {
    let h = 1;
    for (const name of this._names) h = (Math.imul(31, h) + stringHash(name)) | 0;
    for (const value of this.values) {
      h = (Math.imul(31, h) + (value as unknown as { hashCode(): number }).hashCode()) | 0;
    }
    return h;
  }
}
