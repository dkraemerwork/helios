import { HeliosTestCluster } from "./helpers/HeliosTestCluster";

const cluster = new HeliosTestCluster("connect-test");
const info = await cluster.startSingle();
console.log("Cluster started:", info.addresses[0]);

// Use raw TCP to connect and see what happens
const net = await import("net");
const socket = new net.Socket();

socket.connect(info.members[0]!.clientPort, info.members[0]!.host, () => {
    console.log("TCP connected!");
    
    // Send CP2 header
    socket.write(Buffer.from("CP2"));
    console.log("Sent CP2 header");
    
    // Now send a hand-crafted auth request using the official hazelcast-client codec
    const { ClientMessage, Frame } = require("/Users/zenystx/IdeaProjects/helios/test/interop/node_modules/hazelcast-client/lib/protocol/ClientMessage");
    const { ClientAuthenticationCodec } = require("/Users/zenystx/IdeaProjects/helios/test/interop/node_modules/hazelcast-client/lib/codec/ClientAuthenticationCodec");
    
    const authMsg = ClientAuthenticationCodec.encodeRequest(
        info.clusterName,
        null,  // username
        null,  // password
        crypto.randomUUID(),
        "NJS",
        1,
        "5.6.0",
        "test-client",
        [],
    );
    authMsg.setCorrelationId(1);
    authMsg.setPartitionId(-1);
    
    const buf = authMsg.toBuffer();
    console.log("Auth request size:", buf.length, "bytes");
    console.log("Auth request hex:", buf.toString("hex").substring(0, 100));
    
    socket.write(buf);
    console.log("Sent auth request");
});

socket.on("data", (data: Buffer) => {
    console.log("Received", data.length, "bytes");
    console.log("Hex:", data.toString("hex").substring(0, 200));
    
    // Parse frames
    let offset = 0;
    let frameNum = 0;
    while (offset < data.length) {
        if (offset + 6 > data.length) break;
        const frameLen = data.readInt32LE(offset);
        const flags = data.readUInt16LE(offset + 4);
        const contentLen = frameLen - 6;
        frameNum++;
        console.log(`  Frame ${frameNum}: len=${frameLen}, flags=0x${flags.toString(16).padStart(4, '0')}, content=${contentLen} bytes`);
        
        const isFinal = (flags & 0x2000) !== 0;
        const isNull = (flags & 0x0400) !== 0;
        const isBegin = (flags & 0x1000) !== 0;
        const isEnd = (flags & 0x0800) !== 0;
        console.log(`    IS_FINAL=${isFinal} IS_NULL=${isNull} BEGIN=${isBegin} END=${isEnd}`);
        
        if (isFinal) {
            console.log("  >>> Message complete!");
        }
        
        offset += frameLen;
    }
    
    socket.end();
});

socket.on("error", (err) => {
    console.error("Socket error:", err.message);
});

socket.on("close", () => {
    console.log("Socket closed");
    cluster.shutdown().then(() => process.exit(0));
});

// Timeout
setTimeout(() => {
    console.log("TIMEOUT");
    socket.end();
    cluster.shutdown().then(() => process.exit(1));
}, 5000);
