/**
 * Port of {@code com.hazelcast.internal.serialization.impl.DataSerializableHeader}.
 *
 * The serialization header consists of one byte:
 *   bit 0: 0=DataSerializable, 1=IdentifiedDataSerializable
 *   bit 1: 0=non-versioned, 1=versioned
 */
export const DataSerializableHeader = {
    FACTORY_AND_CLASS_ID_BYTE_LENGTH: 8,
    EE_BYTE_LENGTH: 2,

    isIdentifiedDataSerializable(header: number): boolean {
        return (header & 0x01) !== 0;
    },

    isVersioned(header: number): boolean {
        return (header & 0x02) !== 0;
    },

    createHeader(identified: boolean, versioned: boolean): number {
        let header = 0;
        if (identified) header |= 0x01;
        if (versioned) header |= 0x02;
        return header;
    },
} as const;
