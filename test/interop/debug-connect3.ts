import { HeliosTestCluster } from "./helpers/HeliosTestCluster";
import { ClientAuthenticationCodec } from "@zenystx/helios-core/client/impl/protocol/codec/ClientAuthenticationCodec";
import { ClientMessage, ClientMessageFrame } from "@zenystx/helios-core/client/impl/protocol/ClientMessage";
import { ClientMessageWriter } from "@zenystx/helios-core/client/impl/protocol/ClientMessageWriter";
import { ByteBuffer } from "@zenystx/helios-core/internal/networking/ByteBuffer";

const cluster = new HeliosTestCluster("connect-test");
const info = await cluster.startSingle();
console.log("Cluster started:", info.addresses[0]);

// Use raw TCP
const net = await import("net");
const socket = new net.Socket();

socket.connect(info.members[0]!.clientPort, info.members[0]!.host, () => {
    console.log("TCP connected!");
    
    // Send CP2 header
    socket.write(Buffer.from("CP2"));
    
    // Use our own codec to create the auth request
    const authMsg = ClientAuthenticationCodec.encodeRequest(
        info.clusterName,
        null,
        null,
        crypto.randomUUID(),
        "NJS",
        1,
        "5.6.0",
        "test-client",
        [],
    );
    authMsg.setCorrelationId(1);
    authMsg.setPartitionId(-1);
    
    // Serialize using our writer
    const totalLen = authMsg.getFrameLength();
    const buf = ByteBuffer.allocate(totalLen);
    const writer = new ClientMessageWriter();
    writer.writeTo(buf, authMsg);
    buf.flip();
    const rawBuf = Buffer.alloc(buf.remaining());
    buf.getBytes(rawBuf, 0, rawBuf.length);
    
    console.log("Sending auth request:", rawBuf.length, "bytes");
    socket.write(rawBuf);
});

socket.on("data", (data: Buffer) => {
    console.log("\nReceived", data.length, "bytes");
    
    // Parse frames
    let offset = 0;
    let frameNum = 0;
    while (offset < data.length) {
        if (offset + 6 > data.length) {
            console.log(`  Remaining ${data.length - offset} bytes (incomplete frame)`);
            break;
        }
        const frameLen = data.readInt32LE(offset);
        const flags = data.readUInt16LE(offset + 4);
        const contentLen = frameLen - 6;
        frameNum++;
        
        if (offset + frameLen > data.length) {
            console.log(`  Frame ${frameNum}: len=${frameLen}, incomplete (only ${data.length - offset} bytes available)`);
            break;
        }
        
        const content = data.subarray(offset + 6, offset + frameLen);
        console.log(`  Frame ${frameNum}: len=${frameLen}, flags=0x${flags.toString(16).padStart(4, '0')}, content=${contentLen} bytes`);
        
        const isFinal = (flags & 0x2000) !== 0;
        const isNull = (flags & 0x0400) !== 0;
        const isBegin = (flags & 0x1000) !== 0;
        const isEnd = (flags & 0x0800) !== 0;
        console.log(`    IS_FINAL=${isFinal} IS_NULL=${isNull} BEGIN=${isBegin} END=${isEnd}`);
        
        if (frameNum === 1) {
            // Parse initial frame
            console.log(`    messageType: 0x${content.readUInt32LE(0).toString(16)}`);
            console.log(`    correlationId: ${content.readInt32LE(4)}`);
            console.log(`    backupAcks: ${content.readUInt8(12)}`);
            console.log(`    status: ${content.readUInt8(13)}`);
        }
        
        offset += frameLen;
    }
    
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
    console.log("TIMEOUT - no response received");
    socket.end();
    cluster.shutdown().then(() => process.exit(1));
}, 5000);
