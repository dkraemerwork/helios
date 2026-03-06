import { QuickMath } from '@zenystx/core/internal/util/QuickMath';

const MISSING_VALUE = -2147483648; // sentinel for empty slot (Integer.MIN_VALUE)

/**
 * Map implementation specialized for int keys using open addressing and linear probing.
 * Does NOT support null keys or null values.
 * Port of com.hazelcast.internal.util.collection.Int2ObjectHashMap.
 */
export class Int2ObjectHashMap<V> {
  static readonly DEFAULT_LOAD_FACTOR = 0.6;
  static readonly DEFAULT_INITIAL_CAPACITY = 8;

  private readonly _loadFactor: number;
  private _resizeThreshold: number;
  private _capacity: number;
  private _mask: number;
  private _size: number;
  private _keys: Int32Array;
  private _values: (V | undefined)[];

  constructor(initialCapacity = Int2ObjectHashMap.DEFAULT_INITIAL_CAPACITY,
              loadFactor = Int2ObjectHashMap.DEFAULT_LOAD_FACTOR) {
    this._loadFactor = loadFactor;
    this._capacity = QuickMath.nextPowerOfTwo(initialCapacity);
    this._mask = this._capacity - 1;
    this._resizeThreshold = Math.floor(this._capacity * loadFactor);
    this._size = 0;
    this._keys = new Int32Array(this._capacity).fill(MISSING_VALUE);
    this._values = new Array<V | undefined>(this._capacity);
  }

  loadFactor(): number {
    return this._loadFactor;
  }

  capacity(): number {
    return this._capacity;
  }

  resizeThreshold(): number {
    return this._resizeThreshold;
  }

  size(): number {
    return this._size;
  }

  isEmpty(): boolean {
    return this._size === 0;
  }

  get(key: number): V | null {
    let index = this._hash(key);
    while (this._keys[index] !== MISSING_VALUE) {
      if (this._keys[index] === key) return this._values[index] as V;
      index = (index + 1) & this._mask;
    }
    return null;
  }

  put(key: number, value: V): V | null {
    let index = this._hash(key);
    while (this._keys[index] !== MISSING_VALUE) {
      if (this._keys[index] === key) {
        const old = this._values[index] as V;
        this._values[index] = value;
        return old;
      }
      index = (index + 1) & this._mask;
    }
    this._keys[index] = key;
    this._values[index] = value;
    this._size++;
    if (this._size > this._resizeThreshold) this._rehash(this._capacity << 1);
    return null;
  }

  remove(key: number): V | null {
    let index = this._hash(key);
    while (this._keys[index] !== MISSING_VALUE) {
      if (this._keys[index] === key) {
        const old = this._values[index] as V;
        this._keys[index] = MISSING_VALUE;
        this._values[index] = undefined;
        this._size--;
        this._compactChain(index);
        return old;
      }
      index = (index + 1) & this._mask;
    }
    return null;
  }

  containsKey(key: number): boolean {
    return this.get(key) !== null;
  }

  containsValue(value: V): boolean {
    for (let i = 0; i < this._capacity; i++) {
      if (this._keys[i] !== MISSING_VALUE && this._values[i] === value) return true;
    }
    return false;
  }

  clear(): void {
    this._keys.fill(MISSING_VALUE);
    this._values.fill(undefined);
    this._size = 0;
  }

  compact(): void {
    const minCapacity = Math.max(
      Int2ObjectHashMap.DEFAULT_INITIAL_CAPACITY,
      QuickMath.nextPowerOfTwo(Math.ceil(this._size / this._loadFactor) + 1)
    );
    if (minCapacity < this._capacity) {
      this._rehash(minCapacity);
    }
  }

  values(): V[] {
    const result: V[] = [];
    for (let i = 0; i < this._capacity; i++) {
      if (this._keys[i] !== MISSING_VALUE) result.push(this._values[i] as V);
    }
    return result;
  }

  keys(): number[] {
    const result: number[] = [];
    for (let i = 0; i < this._capacity; i++) {
      if (this._keys[i] !== MISSING_VALUE) result.push(this._keys[i]);
    }
    return result;
  }

  entries(): [number, V][] {
    const result: [number, V][] = [];
    for (let i = 0; i < this._capacity; i++) {
      if (this._keys[i] !== MISSING_VALUE) result.push([this._keys[i], this._values[i] as V]);
    }
    return result;
  }

  private _hash(key: number): number {
    // Spread bits using a simple multiplicative hash
    const k = (key ^ (key >>> 16)) * 0x45d9f3b;
    return (k ^ (k >>> 16)) & this._mask;
  }

  private _compactChain(deleteIndex: number): void {
    let index = deleteIndex;
    while (true) {
      index = (index + 1) & this._mask;
      if (this._keys[index] === MISSING_VALUE) break;
      const hash = this._hash(this._keys[index]);
      // Check if the current element is out of place
      if ((index > deleteIndex && (hash <= deleteIndex || hash > index)) ||
          (index < deleteIndex && (hash <= deleteIndex && hash > index))) {
        this._keys[deleteIndex] = this._keys[index];
        this._values[deleteIndex] = this._values[index];
        this._keys[index] = MISSING_VALUE;
        this._values[index] = undefined;
        deleteIndex = index;
      }
    }
  }

  private _rehash(newCapacity: number): void {
    const oldKeys = this._keys;
    const oldValues = this._values;
    const oldCapacity = this._capacity;
    this._capacity = newCapacity;
    this._mask = newCapacity - 1;
    this._resizeThreshold = Math.floor(newCapacity * this._loadFactor);
    this._keys = new Int32Array(newCapacity).fill(MISSING_VALUE);
    this._values = new Array<V | undefined>(newCapacity);
    this._size = 0;
    for (let i = 0; i < oldCapacity; i++) {
      if (oldKeys[i] !== MISSING_VALUE) {
        this.put(oldKeys[i], oldValues[i] as V);
      }
    }
  }
}
