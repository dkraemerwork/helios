import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import { SimpleEntryView } from '@zenystx/helios-core/map/impl/SimpleEntryView.js';
import { ClientMessage } from '../../ClientMessage.js';
import { DataCodec } from '../builtin/DataCodec.js';
import {
    FixedSizeTypesCodec,
    LONG_SIZE_IN_BYTES,
} from '../builtin/FixedSizeTypesCodec.js';

const COST_FIELD_OFFSET = 0;
const CREATION_TIME_FIELD_OFFSET = COST_FIELD_OFFSET + LONG_SIZE_IN_BYTES;
const EXPIRATION_TIME_FIELD_OFFSET = CREATION_TIME_FIELD_OFFSET + LONG_SIZE_IN_BYTES;
const HITS_FIELD_OFFSET = EXPIRATION_TIME_FIELD_OFFSET + LONG_SIZE_IN_BYTES;
const LAST_ACCESS_TIME_FIELD_OFFSET = HITS_FIELD_OFFSET + LONG_SIZE_IN_BYTES;
const LAST_STORED_TIME_FIELD_OFFSET = LAST_ACCESS_TIME_FIELD_OFFSET + LONG_SIZE_IN_BYTES;
const LAST_UPDATE_TIME_FIELD_OFFSET = LAST_STORED_TIME_FIELD_OFFSET + LONG_SIZE_IN_BYTES;
const VERSION_FIELD_OFFSET = LAST_UPDATE_TIME_FIELD_OFFSET + LONG_SIZE_IN_BYTES;
const TTL_FIELD_OFFSET = VERSION_FIELD_OFFSET + LONG_SIZE_IN_BYTES;
const MAX_IDLE_FIELD_OFFSET = TTL_FIELD_OFFSET + LONG_SIZE_IN_BYTES;
const INITIAL_FRAME_SIZE = MAX_IDLE_FIELD_OFFSET + LONG_SIZE_IN_BYTES;

export class SimpleEntryViewCodec {
    static encode(clientMessage: ClientMessage, simpleEntryView: SimpleEntryView<Data, Data>): void {
        clientMessage.add(new ClientMessage.Frame(Buffer.alloc(0), ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));

        const initialFrame = new ClientMessage.Frame(Buffer.alloc(INITIAL_FRAME_SIZE));
        FixedSizeTypesCodec.encodeLong(initialFrame.content, COST_FIELD_OFFSET, BigInt(simpleEntryView.getCost()));
        FixedSizeTypesCodec.encodeLong(initialFrame.content, CREATION_TIME_FIELD_OFFSET, BigInt(simpleEntryView.getCreationTime()));
        FixedSizeTypesCodec.encodeLong(initialFrame.content, EXPIRATION_TIME_FIELD_OFFSET, BigInt(simpleEntryView.getExpirationTime()));
        FixedSizeTypesCodec.encodeLong(initialFrame.content, HITS_FIELD_OFFSET, BigInt(simpleEntryView.getHits()));
        FixedSizeTypesCodec.encodeLong(initialFrame.content, LAST_ACCESS_TIME_FIELD_OFFSET, BigInt(simpleEntryView.getLastAccessTime()));
        FixedSizeTypesCodec.encodeLong(initialFrame.content, LAST_STORED_TIME_FIELD_OFFSET, BigInt(simpleEntryView.getLastStoredTime()));
        FixedSizeTypesCodec.encodeLong(initialFrame.content, LAST_UPDATE_TIME_FIELD_OFFSET, BigInt(simpleEntryView.getLastUpdateTime()));
        FixedSizeTypesCodec.encodeLong(initialFrame.content, VERSION_FIELD_OFFSET, BigInt(simpleEntryView.getVersion()));
        FixedSizeTypesCodec.encodeLong(initialFrame.content, TTL_FIELD_OFFSET, BigInt(simpleEntryView.getTtl()));
        FixedSizeTypesCodec.encodeLong(initialFrame.content, MAX_IDLE_FIELD_OFFSET, BigInt(simpleEntryView.getMaxIdle()));
        clientMessage.add(initialFrame);

        DataCodec.encode(clientMessage, simpleEntryView.getKey());
        DataCodec.encode(clientMessage, simpleEntryView.getValue());

        clientMessage.add(new ClientMessage.Frame(Buffer.alloc(0), ClientMessage.END_DATA_STRUCTURE_FLAG));
    }

    static decode(iterator: ClientMessage.ForwardFrameIterator): SimpleEntryView<Data, Data> {
        iterator.next();
        const initialFrame = iterator.next();
        const view = new SimpleEntryView(DataCodec.decode(iterator), DataCodec.decode(iterator));
        if (iterator.hasNext() && iterator.peekNext()?.isEndFrame()) {
            iterator.next();
        }
        return view
            .setCost(Number(FixedSizeTypesCodec.decodeLong(initialFrame.content, COST_FIELD_OFFSET)))
            .setCreationTime(Number(FixedSizeTypesCodec.decodeLong(initialFrame.content, CREATION_TIME_FIELD_OFFSET)))
            .setExpirationTime(Number(FixedSizeTypesCodec.decodeLong(initialFrame.content, EXPIRATION_TIME_FIELD_OFFSET)))
            .setHits(Number(FixedSizeTypesCodec.decodeLong(initialFrame.content, HITS_FIELD_OFFSET)))
            .setLastAccessTime(Number(FixedSizeTypesCodec.decodeLong(initialFrame.content, LAST_ACCESS_TIME_FIELD_OFFSET)))
            .setLastStoredTime(Number(FixedSizeTypesCodec.decodeLong(initialFrame.content, LAST_STORED_TIME_FIELD_OFFSET)))
            .setLastUpdateTime(Number(FixedSizeTypesCodec.decodeLong(initialFrame.content, LAST_UPDATE_TIME_FIELD_OFFSET)))
            .setVersion(Number(FixedSizeTypesCodec.decodeLong(initialFrame.content, VERSION_FIELD_OFFSET)))
            .setTtl(Number(FixedSizeTypesCodec.decodeLong(initialFrame.content, TTL_FIELD_OFFSET)))
            .setMaxIdle(Number(FixedSizeTypesCodec.decodeLong(initialFrame.content, MAX_IDLE_FIELD_OFFSET)));
    }
}
