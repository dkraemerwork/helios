import { HeliosTestCluster } from "./helpers/HeliosTestCluster";
import { ClientAuthenticationCodec } from "../../src/client/impl/protocol/codec/ClientAuthenticationCodec";
import { ClientMessageWriter } from "../../src/client/impl/protocol/ClientMessageWriter";
import { ByteBuffer } from "@zenystx/helios-core/internal/networking/ByteBuffer";

const cluster = new HeliosTestCluster("connect-test");
const info = await cluster.startSingle();

// Patch server for debugging
const inst = (cluster as any)._instances[0];
const server = (inst as any)._clientProtocolServer;

// Patch _handleMessage
const origHandle = server._handleMessage.bind(server);
server._handleMessage = async function(msg: any, session: any) {
    console.log("[SERVER _handleMessage] type:", msg.getMessageType(), "corId:", msg.getCorrelationId());
    try {
        const result = await origHandle(msg, session);
        console.log("[SERVER _handleMessage] result:", result);
        return result;
    } catch (e: any) {
        console.error("[SERVER _handleMessage] ERROR:", e.message);
        console.error("[SERVER _handleMessage] Stack:", e.stack?.split('\n').slice(0,5).join('\n'));
        throw e;
    }
};

// Patch _processBuffer to catch errors
const origProcess = server._processBuffer.bind(server);
server._processBuffer = async function(ch: any, state: any) {
    try {
        return await origProcess(ch, state);
    } catch (e: any) {
        console.error("[SERVER _processBuffer] ERROR:", e.message);
        throw e;
    }
};

// Connect with raw TCP
const net = await import("net");
const socket = new net.Socket();

socket.connect(info.members[0]!.clientPort, info.members[0]!.host, () => {
    console.log("TCP connected!");
    socket.write(Buffer.from("CP2"));
    
    const authMsg = ClientAuthenticationCodec.encodeRequest(
        info.clusterName, null, null, crypto.randomUUID(), "NJS", 1, "5.6.0", "test-client", [],
    );
    authMsg.setCorrelationId(1);
    authMsg.setPartitionId(-1);
    
    const totalLen = authMsg.getFrameLength();
    const buf = ByteBuffer.allocate(totalLen);
    const writer = new ClientMessageWriter();
    writer.writeTo(buf, authMsg);
    buf.flip();
    const rawBuf = Buffer.alloc(buf.remaining());
    buf.getBytes(rawBuf, 0, rawBuf.length);
    
    console.log("Sending auth:", rawBuf.length, "bytes");
    socket.write(rawBuf);
});

socket.on("data", (data: Buffer) => {
    console.log("Received", data.length, "bytes");
    socket.end();
});

socket.on("error", (err: any) => {
    console.error("Socket error:", err.message);
});

socket.on("close", () => {
    console.log("Socket closed");
    cluster.shutdown().then(() => process.exit(0));
});

setTimeout(() => {
    console.log("TIMEOUT");
    socket.end();
    cluster.shutdown().then(() => process.exit(1));
}, 5000);
