import type { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import type { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';

export type IdsEncoder<T> = (out: ByteArrayObjectDataOutput, value: T) => void;
export type IdsDecoder<T> = (inp: ByteArrayObjectDataInput) => T;

interface IdsRegistration<T> {
    readonly factoryId: number;
    readonly classId: number;
    readonly encode: IdsEncoder<T>;
    readonly decode: IdsDecoder<T>;
}

export class IdentifiedDataSerializableRegistry<T> {
    private readonly _byCtor = new Map<Function, IdsRegistration<T>>();
    private readonly _byId = new Map<number, IdsRegistration<T>>();

    register<U extends T>(
        ctor: abstract new (...args: never[]) => U,
        factoryId: number,
        classId: number,
        encode: IdsEncoder<U>,
        decode: IdsDecoder<U>,
    ): void {
        const registration: IdsRegistration<T> = {
            factoryId,
            classId,
            encode: encode as IdsEncoder<T>,
            decode: decode as IdsDecoder<T>,
        };
        this._byCtor.set(ctor, registration);
        this._byId.set(this._compoundId(factoryId, classId), registration);
    }

    encode(out: ByteArrayObjectDataOutput, value: T): { factoryId: number; classId: number } {
        const registration = this._byCtor.get((value as object).constructor);
        if (registration === undefined) {
            throw new Error(`No IDS registration for ${this._describe(value)}`);
        }
        registration.encode(out, value);
        return { factoryId: registration.factoryId, classId: registration.classId };
    }

    decode(factoryId: number, classId: number, inp: ByteArrayObjectDataInput): T {
        const registration = this._byId.get(this._compoundId(factoryId, classId));
        if (registration === undefined) {
            throw new Error(`No IDS registration for factoryId=${factoryId}, classId=${classId}`);
        }
        return registration.decode(inp);
    }

    getIds(value: T): { factoryId: number; classId: number } {
        const registration = this._byCtor.get((value as object).constructor);
        if (registration === undefined) {
            throw new Error(`No IDS registration for ${this._describe(value)}`);
        }
        return { factoryId: registration.factoryId, classId: registration.classId };
    }

    private _compoundId(factoryId: number, classId: number): number {
        return factoryId * 65_536 + classId;
    }

    private _describe(value: T): string {
        return value !== null && typeof value === 'object'
            ? (value as object).constructor.name
            : String(value);
    }
}
