import { HeliosTestCluster } from "./helpers/HeliosTestCluster";
import { ClientAuthenticationCodec } from "@zenystx/helios-core/client/impl/protocol/codec/ClientAuthenticationCodec";
import { ClientMessageWriter } from "@zenystx/helios-core/client/impl/protocol/ClientMessageWriter";
import { ByteBuffer } from "@zenystx/helios-core/internal/networking/ByteBuffer";

const cluster = new HeliosTestCluster("connect-test");
const info = await cluster.startSingle();

const net = await import("net");
const socket = new net.Socket();

socket.connect(info.members[0]!.clientPort, info.members[0]!.host, () => {
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
    socket.write(rawBuf);
});

socket.on("data", (data: Buffer) => {
    console.log("Received", data.length, "bytes");
    console.log("Full hex:", data.toString("hex"));
    
    let offset = 0;
    let frameNum = 0;
    while (offset + 6 <= data.length) {
        const frameLen = data.readInt32LE(offset);
        const flags = data.readUInt16LE(offset + 4);
        
        if (offset + frameLen > data.length) {
            console.log(`Frame ${++frameNum}: len=${frameLen}, INCOMPLETE (only ${data.length - offset} bytes)`);
            break;
        }
        
        const content = data.subarray(offset + 6, offset + frameLen);
        console.log(`Frame ${++frameNum}: len=${frameLen}, flags=0x${flags.toString(16).padStart(4, '0')}, contentLen=${content.length}`);
        console.log(`  Content hex: ${content.toString("hex")}`);
        
        const isFinal = (flags & 0x2000) !== 0;
        const isBeginFrag = (flags & 0x8000) !== 0;
        const isEndFrag = (flags & 0x4000) !== 0;
        console.log(`  BEGIN_FRAG=${isBeginFrag} END_FRAG=${isEndFrag} IS_FINAL=${isFinal}`);
        
        if (frameNum === 1) {
            console.log(`  msgType: ${content.readUInt32LE(0)}`);
            console.log(`  corId(lo): ${content.readInt32LE(4)}`);
            console.log(`  corId(hi): ${content.readInt32LE(8)}`);
            console.log(`  backupAcks: ${content.readUInt8(12)}`);
            console.log(`  status: ${content.readUInt8(13)}`);
        }
        
        offset += frameLen;
    }
    
    socket.end();
});

socket.on("close", () => cluster.shutdown().then(() => process.exit(0)));
setTimeout(() => { socket.end(); cluster.shutdown().then(() => process.exit(1)); }, 5000);
