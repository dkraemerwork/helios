import { BIG_ENDIAN, ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';

const INITIAL_OUTPUT_CAPACITY = 4096;
const MAX_OUTPUT_BUFFERS = 3;
const MAX_INPUT_BUFFERS = 3;

export class WireBufferPool {
    private readonly _outputPool: ByteArrayObjectDataOutput[] = [];
    private readonly _inputPool: ByteArrayObjectDataInput[] = [];

    takeOutputBuffer(): ByteArrayObjectDataOutput {
        const out = this._outputPool.pop();
        if (out !== undefined) {
            out.reset();
            return out;
        }
        return new ByteArrayObjectDataOutput(INITIAL_OUTPUT_CAPACITY, null, BIG_ENDIAN);
    }

    returnOutputBuffer(out: ByteArrayObjectDataOutput | null | undefined): void {
        if (out == null) {
            return;
        }
        out.reset();
        if (this._outputPool.length < MAX_OUTPUT_BUFFERS) {
            this._outputPool.push(out);
        }
    }

    takeInputBuffer(data: Buffer): ByteArrayObjectDataInput {
        const inp = this._inputPool.pop();
        if (inp !== undefined) {
            inp.init(data, 0);
            return inp;
        }
        return new ByteArrayObjectDataInput(data, null as never, BIG_ENDIAN);
    }

    returnInputBuffer(inp: ByteArrayObjectDataInput | null | undefined): void {
        if (inp == null) {
            return;
        }
        inp.clear();
        if (this._inputPool.length < MAX_INPUT_BUFFERS) {
            this._inputPool.push(inp);
        }
    }

    clear(): void {
        this._outputPool.length = 0;
        this._inputPool.length = 0;
    }
}

export const wireBufferPool = new WireBufferPool();
