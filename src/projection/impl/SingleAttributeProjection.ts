/**
 * Port of {@code com.hazelcast.projection.impl.SingleAttributeProjection}.
 *
 * Projection that extracts the value of a single attribute path from an Extractable input.
 * The attributePath does not support the [any] operator.
 */
import type { Projection } from '@zenystx/helios-core/projection/Projection';
import type { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import type { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import type { IdentifiedDataSerializable } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { PROJECTION_DS_FACTORY_ID, SINGLE_ATTRIBUTE } from '@zenystx/helios-core/projection/impl/ProjectionDataSerializerHook';

/** Interface for objects that support attribute-path extraction. */
interface Extractable {
    getAttributeValue(path: string): unknown;
}

function isExtractable(v: unknown): v is Extractable {
    return v != null && typeof v === 'object' && typeof (v as Extractable).getAttributeValue === 'function';
}

export class SingleAttributeProjection<I, O = unknown> implements Projection<I, O>, IdentifiedDataSerializable {
    private _attributePath: string;

    constructor(attributePath: string) {
        if (!attributePath || attributePath.trim().length === 0) {
            throw new Error('attributePath must not be null or empty');
        }
        if (attributePath.includes('[any]')) {
            throw new Error('attributePath must not contain [any] operators');
        }
        this._attributePath = attributePath;
    }

    transform(input: I): O {
        if (isExtractable(input)) {
            return input.getAttributeValue(this._attributePath) as O;
        }
        throw new Error('The given map entry is not extractable');
    }

    getAttributePath(): string {
        return this._attributePath;
    }

    getFactoryId(): number {
        return PROJECTION_DS_FACTORY_ID;
    }

    getClassId(): number {
        return SINGLE_ATTRIBUTE;
    }

    writeData(out: ByteArrayObjectDataOutput): void {
        out.writeString(this._attributePath);
    }

    readData(inp: ByteArrayObjectDataInput): void {
        this._attributePath = inp.readString()!;
    }
}
