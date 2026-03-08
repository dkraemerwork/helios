/**
 * Block C — Topic Service Protocol Handlers
 *
 * Registers handlers for all Topic opcodes required by hazelcast-client@5.6.x:
 *
 *   Topic.Publish             (0x040100)
 *   Topic.AddMessageListener  (0x0b0a00)
 *   Topic.RemoveMessageListener (0x0b0b00)
 *   Topic.PublishAll          (0x040200)
 */

import type { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { TopicPublishCodec } from '@zenystx/helios-core/client/impl/protocol/codec/TopicPublishCodec.js';
import { TopicAddMessageListenerCodec } from '@zenystx/helios-core/client/impl/protocol/codec/TopicAddMessageListenerCodec.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { TopicServiceOperations } from './ServiceOperations.js';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';

// ── Message type constants ─────────────────────────────────────────────────────

const TOPIC_REMOVE_LISTENER_REQUEST_TYPE  = 0x0b0b00;
const TOPIC_REMOVE_LISTENER_RESPONSE_TYPE = 0x0b0b01;
const TOPIC_PUBLISH_ALL_REQUEST_TYPE      = 0x040200;
const TOPIC_PUBLISH_ALL_RESPONSE_TYPE     = 0x040201;

const RESPONSE_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES; // 16

// ── Registration ──────────────────────────────────────────────────────────────

export function registerTopicServiceHandlers(
    dispatcher: ClientMessageDispatcher,
    operations: TopicServiceOperations,
): void {
    // Topic.Publish
    dispatcher.register(TopicPublishCodec.REQUEST_MESSAGE_TYPE, async (msg, _session) => {
        const req = TopicPublishCodec.decodeRequest(msg);
        await operations.publish(req.name, req.message);
        return TopicPublishCodec.encodeResponse();
    });

    // Topic.AddMessageListener
    dispatcher.register(TopicAddMessageListenerCodec.REQUEST_MESSAGE_TYPE, async (msg, session) => {
        const req = TopicAddMessageListenerCodec.decodeRequest(msg);
        const registrationId = await operations.addMessageListener(req.name, msg.getCorrelationId(), session);
        return TopicAddMessageListenerCodec.encodeResponse(registrationId);
    });

    // Topic.RemoveMessageListener
    dispatcher.register(TOPIC_REMOVE_LISTENER_REQUEST_TYPE, async (msg, session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const registrationId = StringCodec.decode(iter);
        const result = await operations.removeMessageListener(registrationId, session);
        return _encodeBooleanResponse(TOPIC_REMOVE_LISTENER_RESPONSE_TYPE, result);
    });

    // Topic.PublishAll
    dispatcher.register(TOPIC_PUBLISH_ALL_REQUEST_TYPE, async (msg, _session) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        const name = StringCodec.decode(iter);
        const messages = _decodeDataList(iter);
        await operations.publishAll(name, messages);
        return _encodeEmptyResponse(TOPIC_PUBLISH_ALL_RESPONSE_TYPE);
    });
}

// ── Response helpers ──────────────────────────────────────────────────────────

function _encodeEmptyResponse(responseType: number): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    buf.fill(0);
    buf.writeUInt32LE(responseType >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}

function _encodeBooleanResponse(responseType: number, value: boolean): ClientMessage {
    const msg = CM.createForEncode();
    const buf = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE + BOOLEAN_SIZE_IN_BYTES);
    buf.fill(0);
    buf.writeUInt32LE(responseType >>> 0, 0);
    buf.writeUInt8(value ? 1 : 0, RESPONSE_HEADER_SIZE);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(buf, UNFRAGMENTED_MESSAGE));
    msg.setFinal();
    return msg;
}

function _decodeDataList(iter: CM.ForwardFrameIterator): Data[] {
    const items: Data[] = [];
    if (!iter.hasNext()) return items;
    const beginFrame = iter.peekNext();
    if (!beginFrame || !beginFrame.isBeginFrame()) return items;
    iter.next();
    while (iter.hasNext()) {
        const next = iter.peekNext();
        if (next && next.isEndFrame()) { iter.next(); break; }
        if (next && next.isNullFrame()) { iter.next(); continue; }
        items.push(DataCodec.decode(iter));
    }
    return items;
}
