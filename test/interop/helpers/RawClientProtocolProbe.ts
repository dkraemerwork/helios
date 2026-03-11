import { MapPutCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapPutCodec";
import type { ClientMessage } from "@zenystx/helios-core/client/impl/protocol/ClientMessage";
import { ClientMessageWriter } from "@zenystx/helios-core/client/impl/protocol/ClientMessageWriter";
import { ByteBuffer } from "@zenystx/helios-core/internal/networking/ByteBuffer";
import { SerializationConfig } from "@zenystx/helios-core/internal/serialization/impl/SerializationConfig";
import { SerializationServiceImpl } from "@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl";

export type RawSocketConnection = {
  socket: Awaited<ReturnType<typeof Bun.connect>>;
  receivedBuffers: Buffer[];
  waitForClose: Promise<void>;
};

export async function openRawSocket(port: number, host = "127.0.0.1"): Promise<RawSocketConnection> {
  const receivedBuffers: Buffer[] = [];
  let resolveClose!: () => void;
  const waitForClose = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });

  const socket = await Bun.connect({
    hostname: host,
    port,
    socket: {
      data(_socket, data) {
        receivedBuffers.push(Buffer.from(data));
      },
      open() {},
      close() {
        resolveClose();
      },
      error() {},
    },
  });

  return { socket, receivedBuffers, waitForClose };
}

export function buildUnauthenticatedMapPutRequest(
  mapName: string,
  key: string,
  value: string,
  correlationId = 1,
): Buffer {
  const serializationService = new SerializationServiceImpl(new SerializationConfig());

  try {
    const keyData = serializationService.toData(key);
    const valueData = serializationService.toData(value);

    if (keyData === null || valueData === null) {
      throw new Error("Failed to serialize malformed-input probe payload");
    }

    const message = MapPutCodec.encodeRequest(mapName, keyData, valueData, 0n, -1n);
    message.setCorrelationId(correlationId);
    message.setPartitionId(0);

    return serializeClientMessage(message);
  } finally {
    serializationService.destroy();
  }
}

function serializeClientMessage(message: ClientMessage): Buffer {
  const buffer = ByteBuffer.allocate(message.getFrameLength());
  const writer = new ClientMessageWriter();
  const complete = writer.writeTo(buffer, message);

  if (!complete) {
    throw new Error("ClientMessageWriter did not complete");
  }

  buffer.flip();
  const serialized = Buffer.alloc(buffer.remaining());
  buffer.getBytes(serialized, 0, serialized.length);
  return serialized;
}
