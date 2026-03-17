/**
 * Port of {@code com.hazelcast.projection.impl.MultiAttributeProjection}.
 *
 * Projection that extracts the values of multiple attribute paths from an Extractable input,
 * returning them as an array.
 * The attributePaths do not support the [any] operator.
 */
import type { Projection } from '@zenystx/helios-core/projection/Projection';
import type { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import type { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import type { IdentifiedDataSerializable } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { PROJECTION_DS_FACTORY_ID, MULTI_ATTRIBUTE } from '@zenystx/helios-core/projection/impl/ProjectionDataSerializerHook';

/** Interface for objects that support attribute-path extraction. */
interface Extractable {
    getAttributeValue(path: string): unknown;
}

function isExtractable(v: unknown): v is Extractable {
    return v != null && typeof v === 'object' && typeof (v as Extractable).getAttributeValue === 'function';
}

export class MultiAttributeProjection<I> implements Projection<I, unknown[]>, IdentifiedDataSerializable {
    private _attributePaths: string[];

    constructor(...attributePaths: string[]) {
        if (attributePaths.length === 0) {
            throw new Error('You need to specify at least one attributePath');
        }
        for (const path of attributePaths) {
            if (!path || path.trim().length === 0) {
                throw new Error('attributePath must not be null or empty');
            }
            if (path.includes('[any]')) {
                throw new Error('attributePath must not contain [any] operators');
            }
        }
        this._attributePaths = attributePaths;
    }

    transform(input: I): unknown[] {
        if (isExtractable(input)) {
            const result: unknown[] = new Array(this._attributePaths.length);
            for (let i = 0; i < this._attributePaths.length; i++) {
                result[i] = input.getAttributeValue(this._attributePaths[i]);
            }
            return result;
        }
        throw new Error('The given map entry is not extractable');
    }

    getAttributePaths(): string[] {
        return this._attributePaths;
    }

    getFactoryId(): number {
        return PROJECTION_DS_FACTORY_ID;
    }

    getClassId(): number {
        return MULTI_ATTRIBUTE;
    }

    writeData(out: ByteArrayObjectDataOutput): void {
        out.writeStringArray(this._attributePaths);
    }

    readData(inp: ByteArrayObjectDataInput): void {
        this._attributePaths = inp.readStringArray()!;
    }
}
