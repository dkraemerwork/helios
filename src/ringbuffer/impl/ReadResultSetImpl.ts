import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { SerializationService } from '@zenystx/helios-core/internal/serialization/SerializationService';

/**
 * Port of {@code com.hazelcast.ringbuffer.impl.ReadResultSetImpl}.
 *
 * A list-like result container for ReadManyOperation.
 * Supports optional filter function and projection.
 *
 * @param O deserialized ringbuffer type
 * @param E result set type
 */
export class ReadResultSetImpl<O = unknown, E = O> {
    private readonly minSize: number;
    private readonly maxSize: number;
    private readonly serializationService: SerializationService;
    private readonly filter: ((item: O) => boolean) | null;

    private _items: Data[] | null = null;
    private _seqs: number[] | null = null;
    private _size: number = 0;
    private _readCount: number = 0;
    private _nextSeq: number = 0;

    constructor(
        minSize: number,
        maxSize: number,
        serializationService: SerializationService,
        filter: ((item: O) => boolean) | null = null,
    ) {
        this.minSize = minSize;
        this.maxSize = maxSize;
        this.serializationService = serializationService;
        this.filter = filter;
    }

    isMaxSizeReached(): boolean {
        return this._size === this.maxSize;
    }

    isMinSizeReached(): boolean {
        return this._size >= this.minSize;
    }

    isEmpty(): boolean {
        return this._size === 0;
    }

    size(): number {
        return this._size;
    }

    readCount(): number {
        return this._readCount;
    }

    /**
     * Add an item to the result set, applying filter if set.
     * Returns true if the item was added.
     */
    addItem(seq: number, item: unknown): boolean {
        this._readCount++;

        let resultItem: Data | null;
        if (this.filter !== null) {
            const objectItem = this.serializationService.toObject<O>(item instanceof Object && 'toByteArray' in item
                ? item as Data
                : this.serializationService.toData(item));
            if (objectItem === null) {
                return false;
            }
            if (!this.filter(objectItem)) {
                return false;
            }
            resultItem = this.serializationService.toData(objectItem);
        } else {
            resultItem = this.serializationService.toData(item);
        }

        // Lazily create arrays
        if (this._items === null) {
            this._items = new Array<Data>(this.maxSize);
            this._seqs = new Array<number>(this.maxSize).fill(0);
        }

        this._items[this._size] = resultItem!;
        this._seqs![this._size] = seq;
        this._size++;
        return true;
    }

    get(index: number): E {
        if (index < 0 || index >= this._size) {
            throw new Error(`index=${index}, size=${this._size}`);
        }
        const item = this._items![index];
        return this.serializationService.toObject<E>(item) as E;
    }

    getSequence(index: number): number {
        if (index < 0 || index >= this._size) {
            throw new Error(`index=${index}, size=${this._size}`);
        }
        return this._seqs !== null && this._seqs.length > index ? this._seqs[index] : -1;
    }

    getNextSequenceToReadFrom(): number {
        return this._nextSeq;
    }

    setNextSequenceToReadFrom(nextSeq: number): void {
        this._nextSeq = nextSeq;
    }

    /** Return items as an array for comparison in tests. */
    toArray(): E[] {
        const result: E[] = [];
        for (let i = 0; i < this._size; i++) {
            result.push(this.get(i));
        }
        return result;
    }

    /** Allow iteration */
    [Symbol.iterator](): Iterator<E> {
        let index = 0;
        return {
            next: () => {
                if (index < this._size) {
                    return { value: this.get(index++), done: false };
                }
                return { value: undefined as unknown as E, done: true };
            },
        };
    }
}
