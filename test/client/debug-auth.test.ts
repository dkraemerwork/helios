import { test } from "bun:test";
import { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { ClientAuthenticationCodec } from "@zenystx/helios-core/client/impl/protocol/codec/ClientAuthenticationCodec";
import { ClientMessage } from "@zenystx/helios-core/client/impl/protocol/ClientMessage";
import { ClientMessageWriter } from "@zenystx/helios-core/client/impl/protocol/ClientMessageWriter";
import { ClientMessageReader } from "@zenystx/helios-core/client/impl/protocol/ClientMessageReader";
import { ByteBuffer } from "@zenystx/helios-core/internal/networking/ByteBuffer";

function serialize(msg: ClientMessage): Buffer {
    const totalLen = msg.getFrameLength();
    const buf = ByteBuffer.allocate(totalLen);
    const writer = new ClientMessageWriter();
    writer.writeTo(buf, msg);
    buf.flip();
    const result = Buffer.alloc(buf.remaining());
    buf.getBytes(result, 0, result.length);
    return result;
}

function deserialize(data: Buffer): ClientMessage {
    const reader = new ClientMessageReader();
    const buf = ByteBuffer.wrap(data);
    const ok = reader.readFrom(buf, true);
    if (!ok) throw new Error("reader did not complete");
    return reader.getClientMessage();
}

test("debug helios instance auth", async () => {
    const config = new HeliosConfig("e2e-cluster");
    config.getNetworkConfig().setClientProtocolPort(0);
    const instance = new HeliosInstanceImpl(config);
    await Bun.sleep(50);
    const clientPort = instance.getClientProtocolPort();
    console.log("clientPort:", clientPort);

    const received: Buffer[] = [];
    let resolveAuth: () => void;
    const authDone = new Promise<void>(r => { resolveAuth = r; });

    const socket = await Bun.connect({
        hostname: "127.0.0.1",
        port: clientPort,
        socket: {
            data(_socket, data) {
                console.log("received data:", data.length, "bytes");
                console.log("data hex:", Buffer.from(data).slice(0, 60).toString('hex'));
                received.push(Buffer.from(data));
                resolveAuth();
            },
            open() { console.log("socket open"); },
            close() { console.log("socket close"); },
            error(s, e) { console.log("socket error:", e); },
        },
    });

    const authReq = ClientAuthenticationCodec.encodeRequest(
        "e2e-cluster", null, null, null, "BUN", 1, "1.0.0", "test-client", [],
    );
    authReq.setCorrelationId(1);
    authReq.setPartitionId(-1);
    const authBytes = serialize(authReq);
    console.log("sending auth bytes:", authBytes.length, "bytes");
    socket.write(authBytes);

    await authDone;
    await Bun.sleep(20);

    const combined = Buffer.concat(received);
    console.log("combined length:", combined.length);
    const responseMsg = deserialize(combined);
    const response = ClientAuthenticationCodec.decodeResponse(responseMsg);
    console.log("status:", response.status, "(0=AUTHENTICATED, 1=CREDENTIALS_FAILED, 3=NOT_ALLOWED)");
    console.log("message type:", responseMsg.getMessageType().toString(16));
    console.log("correlation id:", responseMsg.getCorrelationId());
    
    // Print all frames
    const iter = responseMsg.forwardFrameIterator();
    let i = 0;
    while (iter.hasNext()) {
        const f = iter.next();
        console.log(`frame ${i++}: flags=${f.flags.toString(16)} len=${f.content.length} content=${f.content.slice(0, 20).toString('hex')}`);
    }

    socket.end();
    instance.shutdown();
}, 10000);
