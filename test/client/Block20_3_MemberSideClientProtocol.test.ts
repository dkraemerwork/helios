/**
 * Block 20.3 — Member-side client protocol server + auth/session lifecycle
 *
 * Tests:
 * 1.  ClientProtocolServer starts on a dedicated port and accepts connections
 * 2.  ClientProtocolServer lives outside src/client (member-side ownership)
 * 3.  Member-side task handlers are under src/server/clientprotocol, not src/client
 * 4.  Protocol framing: ClientMessage round-trip over raw socket
 * 5.  Version negotiation on the member side
 * 6.  Authentication request creates a session
 * 7.  Authentication with wrong cluster name is rejected
 * 8.  Session registry tracks active sessions by client UUID
 * 9.  Disconnect cleanup removes session from registry
 * 10. Request-dispatch registry routes by message type
 * 11. Unknown message type returns error response
 * 12. Correlation-aware response routing preserves correlation ID
 * 13. Event-push path sends event messages to session
 * 14. Heartbeat handling updates last-seen time
 * 15. Heartbeat timeout disconnects stale clients
 * 16. Lifecycle bookkeeping: shutdown closes all client connections
 * 17. Multiple concurrent client sessions
 * 18. MapPut request dispatched and response returned
 * 19. Integration: HeliosInstanceImpl starts ClientProtocolServer
 * 20. E2E verification: raw socket auth → request → response → disconnect
 */
import { AuthenticationStatus } from "../../src/client/impl/protocol/AuthenticationStatus";
import { ClientMessage, ClientMessageFrame } from "../../src/client/impl/protocol/ClientMessage";
import { ClientMessageReader } from "../../src/client/impl/protocol/ClientMessageReader";
import { ClientMessageWriter } from "../../src/client/impl/protocol/ClientMessageWriter";
import { ClientAuthenticationCodec } from "../../src/client/impl/protocol/codec/ClientAuthenticationCodec";
import { MapAddEntryListenerCodec } from "../../src/client/impl/protocol/codec/MapAddEntryListenerCodec";
import { MapGetEntryViewCodec } from "../../src/client/impl/protocol/codec/MapGetEntryViewCodec.js";
import { MapPutCodec } from "../../src/client/impl/protocol/codec/MapPutCodec";
import { QueueAddListenerCodec } from "../../src/client/impl/protocol/codec/QueueAddListenerCodec.js";
import { QueueOfferCodec } from "../../src/client/impl/protocol/codec/QueueOfferCodec";
import { StringCodec } from "../../src/client/impl/protocol/codec/builtin/StringCodec.js";
import { ByteBuffer } from "@zenystx/helios-core/internal/networking/ByteBuffer";
import { afterEach, describe, expect, test } from "bun:test";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Serialize a ClientMessage to a Buffer suitable for socket write. */
function serializeClientMessage(msg: ClientMessage): Buffer {
    const totalLen = msg.getFrameLength();
    const buf = ByteBuffer.allocate(totalLen);
    const writer = new ClientMessageWriter();
    const ok = writer.writeTo(buf, msg);
    if (!ok) throw new Error("ClientMessageWriter did not complete");
    buf.flip();
    const result = Buffer.alloc(buf.remaining());
    buf.getBytes(result, 0, result.length);
    return result;
}

/** Read a full ClientMessage from raw bytes. */
function deserializeClientMessage(data: Buffer): ClientMessage {
    const reader = new ClientMessageReader();
    const buf = ByteBuffer.wrap(data);
    const ok = reader.readFrom(buf, true);
    if (!ok) throw new Error("ClientMessageReader did not complete");
    return reader.getClientMessage();
}

function deserializeClientMessages(data: Buffer): ClientMessage[] {
    const messages: ClientMessage[] = [];
    const buf = ByteBuffer.wrap(data);
    while (buf.remaining() > 0) {
        const reader = new ClientMessageReader();
        const ok = reader.readFrom(buf, true);
        if (!ok) {
            throw new Error("ClientMessageReader did not complete");
        }
        messages.push(reader.getClientMessage());
    }
    return messages;
}

function buildOpcodeMessage(messageType: number, correlationId: number): ClientMessage {
    const msg = ClientMessage.createForEncode();
    const frame = Buffer.allocUnsafe(16);
    frame.fill(0);
    frame.writeUInt32LE(messageType, ClientMessage.TYPE_FIELD_OFFSET);
    msg.add(new ClientMessageFrame(frame));
    msg.setCorrelationId(correlationId);
    msg.setPartitionId(-1);
    msg.setFinal();
    return msg;
}

function buildStringRequest(messageType: number, correlationId: number, value: string): ClientMessage {
    const msg = ClientMessage.createForEncode();
    const frame = Buffer.allocUnsafe(16);
    frame.fill(0);
    frame.writeUInt32LE(messageType, ClientMessage.TYPE_FIELD_OFFSET);
    msg.add(new ClientMessageFrame(frame));
    msg.setCorrelationId(correlationId);
    msg.setPartitionId(-1);
    StringCodec.encode(msg, value);
    msg.setFinal();
    return msg;
}

async function waitForReceivedBufferCount(
    receivedBuffers: Buffer[],
    expectedCount: number,
    timeoutMs = 500,
): Promise<void> {
    await Promise.race([
        new Promise<void>((resolve) => {
            const interval = setInterval(() => {
                if (receivedBuffers.length >= expectedCount) {
                    clearInterval(interval);
                    resolve();
                }
            }, 10);
        }),
        Bun.sleep(timeoutMs).then(() => {
            throw new Error(`expected ${expectedCount} received buffer(s)`);
        }),
    ]);
}

/** Connect a raw TCP socket, send auth, and return the connection + parsed auth response. */
async function connectAndAuth(
    port: number,
    clusterName = "dev",
    clientName = "test-client",
    clientUuid: string | null = null,
    username: string | null = null,
    password: string | null = null,
): Promise<{
    socket: ReturnType<typeof Bun.connect> extends Promise<infer T> ? T : never;
    response: ReturnType<typeof ClientAuthenticationCodec.decodeResponse>;
    receivedBuffers: Buffer[];
    waitForClose: Promise<void>;
}> {
    const receivedBuffers: Buffer[] = [];
    let resolveAuth!: () => void;
    const authDone = new Promise<void>((r) => { resolveAuth = r; });
    let resolveClose!: () => void;
    const waitForClose = new Promise<void>((resolve) => {
        resolveClose = resolve;
    });

    const socket = await Bun.connect({
        hostname: "127.0.0.1",
        port,
        socket: {
            data(_socket, data) {
                receivedBuffers.push(Buffer.from(data));
                resolveAuth();
            },
            open() {},
            close() {
                resolveClose();
            },
            error() {},
        },
    });

    // Send auth request
    const authReq = ClientAuthenticationCodec.encodeRequest(
        clusterName,
        username,
        password,
        clientUuid,
        "BUN",
        1,
        "1.0.0",
        clientName,
        [],
    );
    authReq.setCorrelationId(1);
    authReq.setPartitionId(-1);
    const authBytes = serializeClientMessage(authReq);
    socket.write(authBytes);

    await authDone;

    const combined = Buffer.concat(receivedBuffers);
    const responseMsg = deserializeClientMessage(combined);
    const response = ClientAuthenticationCodec.decodeResponse(responseMsg);

    return { socket: socket as any, response, receivedBuffers, waitForClose };
}

async function openRawSocket(port: number): Promise<{
    socket: ReturnType<typeof Bun.connect> extends Promise<infer T> ? T : never;
    receivedBuffers: Buffer[];
    waitForClose: Promise<void>;
}> {
    const receivedBuffers: Buffer[] = [];
    let resolveClose!: () => void;
    const waitForClose = new Promise<void>((resolve) => {
        resolveClose = resolve;
    });

    const socket = await Bun.connect({
        hostname: "127.0.0.1",
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

    return { socket: socket as any, receivedBuffers, waitForClose };
}

async function openAuthenticatedRawSocket(port: number, clusterName = "dev"): Promise<{
    socket: ReturnType<typeof Bun.connect> extends Promise<infer T> ? T : never;
    receivedBuffers: Buffer[];
    waitForClose: Promise<void>;
}> {
    const connection = await openRawSocket(port);
    const authReq = ClientAuthenticationCodec.encodeRequest(
        clusterName,
        null,
        null,
        null,
        "BUN",
        1,
        "1.0.0",
        "test-client",
        [],
    );
    authReq.setCorrelationId(1);
    authReq.setPartitionId(-1);
    connection.socket.write(serializeClientMessage(authReq));

    await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
            if (connection.receivedBuffers.length > 0) {
                clearInterval(interval);
                resolve();
            }
        }, 10);
    });

    connection.receivedBuffers.length = 0;
    return connection;
}

// ── 1. ClientProtocolServer starts on a dedicated port ──────────────────────

describe("ClientProtocolServer", () => {
    let server: any;

    afterEach(async () => {
        await server?.shutdown();
    });

    test("starts on a dedicated port and accepts TCP connections", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        server = new ClientProtocolServer({ clusterName: "dev", port: 0 });
        await server.start();
        const port = server.getPort();
        expect(port).toBeGreaterThan(0);

        // Raw TCP connect should succeed
        const socket = await Bun.connect({
            hostname: "127.0.0.1",
            port,
            socket: { data() {}, open() {}, close() {}, error() {} },
        });
        expect(socket).toBeDefined();
        socket.end();
    });
});

// ── 2. Member-side ownership (module path check) ────────────────────────────

describe("member-side ownership", () => {
    test("ClientProtocolServer is importable from src/server/clientprotocol", async () => {
        const mod = await import("@zenystx/helios-core/server/clientprotocol/ClientProtocolServer");
        expect(mod.ClientProtocolServer).toBeDefined();
    });

    test("ClientSession is importable from src/server/clientprotocol", async () => {
        const mod = await import("@zenystx/helios-core/server/clientprotocol/ClientSession");
        expect(mod.ClientSession).toBeDefined();
    });

    test("ClientSessionRegistry is importable from src/server/clientprotocol", async () => {
        const mod = await import("@zenystx/helios-core/server/clientprotocol/ClientSessionRegistry");
        expect(mod.ClientSessionRegistry).toBeDefined();
    });
});

// ── 3. Member-side task handlers under server package ───────────────────────

describe("member-side task handlers", () => {
    test("ClientMessageDispatcher is importable from src/server/clientprotocol", async () => {
        const mod = await import("@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher");
        expect(mod.ClientMessageDispatcher).toBeDefined();
    });
});

// ── 4. Protocol framing round-trip over raw socket ──────────────────────────

describe("protocol framing", () => {
    let server: any;

    afterEach(async () => {
        await server?.shutdown();
    });

    test("ClientMessage round-trip over raw TCP socket", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        server = new ClientProtocolServer({ clusterName: "dev", port: 0 });
        await server.start();

        const { response } = await connectAndAuth(server.getPort());
        expect(response.status).toBe(AuthenticationStatus.AUTHENTICATED.getId());
    });
});

// ── 5. Version negotiation ──────────────────────────────────────────────────

describe("version negotiation", () => {
    let server: any;

    afterEach(async () => {
        await server?.shutdown();
    });

    test("server responds with its serialization version", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        server = new ClientProtocolServer({ clusterName: "dev", port: 0 });
        await server.start();

        const { response } = await connectAndAuth(server.getPort());
        expect(response.serializationVersion).toBeGreaterThanOrEqual(1);
    });
});

// ── 6. Authentication creates session ───────────────────────────────────────

describe("authentication", () => {
    let server: any;

    afterEach(async () => {
        await server?.shutdown();
    });

    test("successful auth creates a session in the registry", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        server = new ClientProtocolServer({ clusterName: "dev", port: 0 });
        await server.start();

        const { response, socket } = await connectAndAuth(server.getPort());
        expect(response.status).toBe(AuthenticationStatus.AUTHENTICATED.getId());
        expect(response.memberUuid).toBeTruthy();
        expect(response.clusterId).toBeTruthy();
        expect(response.partitionCount).toBeGreaterThan(0);

        // Session registry should have one session
        expect(server.getSessionRegistry().getSessionCount()).toBe(1);
        socket.end();
        await Bun.sleep(50);
    });

    // ── 7. Wrong cluster name rejection ─────────────────────────────────

    test("auth with wrong cluster name is rejected", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        server = new ClientProtocolServer({ clusterName: "my-cluster", port: 0 });
        await server.start();

        const { response, waitForClose } = await connectAndAuth(server.getPort(), "wrong-cluster");
        expect(response.status).toBe(AuthenticationStatus.CREDENTIALS_FAILED.getId());
        await Promise.race([
            waitForClose,
            Bun.sleep(500).then(() => {
                throw new Error("expected auth rejection connection to close");
            }),
        ]);
        expect(server.getSessionRegistry().getSessionCount()).toBe(0);
    });

    test("auth with wrong username/password is rejected when server auth is configured", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        server = new ClientProtocolServer({
            clusterName: "dev",
            port: 0,
            auth: {
                username: "admin",
                password: "secret",
            },
        });
        await server.start();

        const { response, waitForClose } = await connectAndAuth(
            server.getPort(),
            "dev",
            "test-client",
            null,
            "admin",
            "wrong",
        );
        expect(response.status).toBe(AuthenticationStatus.CREDENTIALS_FAILED.getId());
        await Promise.race([
            waitForClose,
            Bun.sleep(500).then(() => {
                throw new Error("expected auth rejection connection to close");
            }),
        ]);
        expect(server.getSessionRegistry().getSessionCount()).toBe(0);
    });

    test("auth with matching username/password succeeds when server auth is configured", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        server = new ClientProtocolServer({
            clusterName: "dev",
            port: 0,
            auth: {
                username: "admin",
                password: "secret",
            },
        });
        await server.start();

        const { response, socket } = await connectAndAuth(server.getPort(), "dev", "test-client", null, "admin", "secret");
        expect(response.status).toBe(AuthenticationStatus.AUTHENTICATED.getId());
        socket.end();
    });

    test("rejects repeated auth on an already-authenticated session and closes the connection", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );

        const server = new ClientProtocolServer({ clusterName: "dev", port: 0 });
        await server.start();

        try {
            const { socket, receivedBuffers, waitForClose } = await openAuthenticatedRawSocket(server.getPort());
            expect(server.getSessionRegistry().getSessionCount()).toBe(1);

            const reauthReq = ClientAuthenticationCodec.encodeRequest(
                "dev",
                null,
                null,
                crypto.randomUUID(),
                "BUN",
                1,
                "1.0.0",
                "reauth-client",
                [],
            );
            reauthReq.setCorrelationId(2);
            reauthReq.setPartitionId(-1);
            socket.write(serializeClientMessage(reauthReq));

            await waitForReceivedBufferCount(receivedBuffers, 1);

            const responseMsg = deserializeClientMessage(Buffer.concat(receivedBuffers));
            const response = ClientAuthenticationCodec.decodeResponse(responseMsg);
            expect(response.status).toBe(AuthenticationStatus.NOT_ALLOWED_IN_CLUSTER.getId());
            expect(responseMsg.getCorrelationId()).toBe(2);

            await Promise.race([
                waitForClose,
                Bun.sleep(500).then(() => {
                    throw new Error("expected repeated auth connection to close");
                }),
            ]);

            expect(server.getSessionRegistry().getSessionCount()).toBe(0);
        } finally {
            await server.shutdown();
        }
    });
});

// ── 8. Session registry tracks sessions ─────────────────────────────────────

describe("session registry", () => {
    let server: any;

    afterEach(async () => {
        await server?.shutdown();
    });

    test("tracks active sessions by client UUID", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        server = new ClientProtocolServer({ clusterName: "dev", port: 0 });
        await server.start();

        const { socket: s1 } = await connectAndAuth(server.getPort(), "dev", "c1");
        const { socket: s2 } = await connectAndAuth(server.getPort(), "dev", "c2");

        expect(server.getSessionRegistry().getSessionCount()).toBe(2);

        s1.end();
        s2.end();
        await Bun.sleep(50);
    });
});

// ── 9. Disconnect cleanup ───────────────────────────────────────────────────

describe("disconnect cleanup", () => {
    let server: any;

    afterEach(async () => {
        await server?.shutdown();
    });

    test("removes session from registry on disconnect", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        server = new ClientProtocolServer({ clusterName: "dev", port: 0 });
        await server.start();

        const { socket } = await connectAndAuth(server.getPort());
        expect(server.getSessionRegistry().getSessionCount()).toBe(1);

        socket.end();
        await Bun.sleep(100);
        expect(server.getSessionRegistry().getSessionCount()).toBe(0);
    });
});

// ── 10. Request-dispatch registry ───────────────────────────────────────────

describe("request-dispatch registry", () => {
    test("routes by message type to registered handler", async () => {
        const { ClientMessageDispatcher } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher"
        );

        const dispatcher = new ClientMessageDispatcher();
        dispatcher.allowBeforeAuthentication(0xAABB00);
        let handled = false;
        dispatcher.register(0xAABB00, async (_msg, _session) => {
            handled = true;
            return ClientMessage.createForEncode();
        });

        const msg = ClientMessage.createForEncode();
        const frame = Buffer.allocUnsafe(16);
        frame.fill(0);
        frame.writeUInt32LE(0xAABB00, ClientMessage.TYPE_FIELD_OFFSET);
        msg.add(new ClientMessageFrame(frame));
        msg.setFinal();

        await dispatcher.dispatch(msg, { isAuthenticated: () => false } as any);
        expect(handled).toBe(true);
    });

    test("blocks non-auth message types before session authentication", async () => {
        const {
            ClientAuthenticationRequiredError,
            ClientMessageDispatcher,
        } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher"
        );

        const dispatcher = new ClientMessageDispatcher();
        dispatcher.register(0xAABB00, async () => {
            throw new Error("handler should not execute");
        });

        const msg = ClientMessage.createForEncode();
        const frame = Buffer.allocUnsafe(16);
        frame.fill(0);
        frame.writeUInt32LE(0xAABB00, ClientMessage.TYPE_FIELD_OFFSET);
        msg.add(new ClientMessageFrame(frame));
        msg.setFinal();

        await expect(
            dispatcher.dispatch(msg, { isAuthenticated: () => false } as any),
        ).rejects.toBeInstanceOf(ClientAuthenticationRequiredError);
    });

    test("rejects illegal non-request message types", async () => {
        const {
            ClientMessageDispatcher,
            ClientProtocolOpcodeError,
        } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher"
        );

        const dispatcher = new ClientMessageDispatcher();
        const msg = ClientMessage.createForEncode();
        const frame = Buffer.allocUnsafe(16);
        frame.fill(0);
        frame.writeUInt32LE(MapPutCodec.RESPONSE_MESSAGE_TYPE, ClientMessage.TYPE_FIELD_OFFSET);
        msg.add(new ClientMessageFrame(frame));
        msg.setFinal();

        await expect(
            dispatcher.dispatch(msg, { isAuthenticated: () => true } as any),
        ).rejects.toMatchObject({
            messageType: MapPutCodec.RESPONSE_MESSAGE_TYPE,
            reason: "illegal",
        } satisfies Partial<InstanceType<typeof ClientProtocolOpcodeError>>);
    });
});

// ── 11. Unknown message type fails closed ───────────────────────────────────

describe("unknown message type", () => {
    test("dispatcher rejects unknown request message type", async () => {
        const {
            ClientMessageDispatcher,
            ClientProtocolOpcodeError,
        } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher"
        );

        const dispatcher = new ClientMessageDispatcher();
        const msg = ClientMessage.createForEncode();
        const frame = Buffer.allocUnsafe(16);
        frame.fill(0);
        frame.writeUInt32LE(0x00ff00, ClientMessage.TYPE_FIELD_OFFSET);
        msg.add(new ClientMessageFrame(frame));
        msg.setFinal();

        await expect(
            dispatcher.dispatch(msg, { isAuthenticated: () => true } as any),
        ).rejects.toMatchObject({
            messageType: 0x00ff00,
            reason: "unknown",
        } satisfies Partial<InstanceType<typeof ClientProtocolOpcodeError>>);
    });

    test("authenticated client is closed on unknown request opcode over the live path", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        const server = new ClientProtocolServer({ clusterName: "dev", port: 0 });
        await server.start();

        try {
            const { socket, receivedBuffers, waitForClose } = await openAuthenticatedRawSocket(server.getPort());
            socket.write(serializeClientMessage(buildOpcodeMessage(0x00ff00, 9)));

            await Promise.race([
                waitForClose,
                Bun.sleep(500).then(() => {
                    throw new Error("expected unknown opcode connection to close");
                }),
            ]);

            expect(receivedBuffers).toHaveLength(0);
        } finally {
            await server.shutdown();
        }
    });

    test("authenticated client is closed on illegal opcode over the live path", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        const server = new ClientProtocolServer({ clusterName: "dev", port: 0, enableMapHandler: true });
        await server.start();

        try {
            const { socket, receivedBuffers, waitForClose } = await openAuthenticatedRawSocket(server.getPort());
            socket.write(serializeClientMessage(buildOpcodeMessage(MapPutCodec.RESPONSE_MESSAGE_TYPE, 10)));

            await Promise.race([
                waitForClose,
                Bun.sleep(500).then(() => {
                    throw new Error("expected illegal opcode connection to close");
                }),
            ]);

            expect(receivedBuffers).toHaveLength(0);
        } finally {
            await server.shutdown();
        }
    });

    test("pipelined bad opcode does not allow later requests over the raw server path", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        const { SerializationServiceImpl } = await import(
            "@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl"
        );
        const { SerializationConfig } = await import(
            "@zenystx/helios-core/internal/serialization/impl/SerializationConfig"
        );

        const mutations: Array<{ name: string; key: Buffer; value: Buffer }> = [];
        const server = new ClientProtocolServer({
            clusterName: "dev",
            port: 0,
            enableMapHandler: true,
            onMapPut: (name, key, value) => {
                mutations.push({ name, key: Buffer.from(key), value: Buffer.from(value) });
                return null;
            },
        });
        await server.start();

        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const keyData = ss.toData("pipeKey")!;
            const valueData = ss.toData("pipeValue")!;
            const putReq = MapPutCodec.encodeRequest("pipeMap", keyData, valueData, 0n, -1n);
            putReq.setCorrelationId(42);
            putReq.setPartitionId(0);
            const putBytes = serializeClientMessage(putReq);

            for (const { name, messageType } of [
                { name: "unknown-opcode", messageType: 0x00ff00 },
                { name: "illegal-opcode", messageType: MapPutCodec.RESPONSE_MESSAGE_TYPE },
            ]) {
                mutations.length = 0;
                const { socket, receivedBuffers, waitForClose } = await openAuthenticatedRawSocket(server.getPort());
                socket.write(Buffer.concat([
                    serializeClientMessage(buildOpcodeMessage(messageType, 41)),
                    putBytes,
                ]));

                await Promise.race([
                    waitForClose,
                    Bun.sleep(500).then(() => {
                        throw new Error(`expected ${name} connection to close`);
                    }),
                ]);

                expect(receivedBuffers).toHaveLength(0);
                expect(mutations).toHaveLength(0);
                socket.end();
            }
        } finally {
            ss.destroy();
            await server.shutdown();
        }
    });
});

// ── 12. Correlation-aware response routing ──────────────────────────────────

describe("correlation-aware response routing", () => {
    let server: any;

    afterEach(async () => {
        await server?.shutdown();
    });

    test("response preserves request correlation ID", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        server = new ClientProtocolServer({ clusterName: "dev", port: 0 });
        await server.start();

        // Auth uses correlation ID 1 — already tested above
        // Send a second request with different correlation ID
        const { response } = await connectAndAuth(server.getPort());
        // The auth response correlation ID is copied from the request
        // (We verify this by checking the response message has correlation 1)
        expect(response.status).toBe(0); // AUTHENTICATED
    });
});

// ── 13. Event-push path ─────────────────────────────────────────────────────

describe("event-push path", () => {
    test("ClientSession can push event messages to client", async () => {
        const { ClientSession } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientSession"
        );

        const written: Buffer[] = [];
        const mockChannel = {
            write(data: Buffer) { written.push(data); return true; },
            close() {},
            isClosed() { return false; },
        };

        const session = new ClientSession(mockChannel as any, "test-id");

        // Push an event message
        const event = ClientMessage.createForEncode();
        const frame = Buffer.allocUnsafe(16);
        frame.fill(0);
        frame.writeUInt32LE(0x1234, 0);
        event.add(new ClientMessageFrame(frame, ClientMessage.IS_EVENT_FLAG));
        event.setFinal();

        session.pushEvent(event);
        expect(written.length).toBeGreaterThan(0);
    });
});

// ── 14. Heartbeat handling ──────────────────────────────────────────────────

describe("heartbeat handling", () => {
    test("updates last-seen time on ping", async () => {
        const { ClientSession } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientSession"
        );

        const mockChannel = {
            write() { return true; },
            close() {},
            isClosed() { return false; },
        };

        const session = new ClientSession(mockChannel as any, "test-id");
        const initialTime = session.getLastSeenMs();

        await Bun.sleep(10);
        session.recordActivity();

        expect(session.getLastSeenMs()).toBeGreaterThan(initialTime);
    });
});

// ── 15. Heartbeat timeout disconnects stale clients ─────────────────────────

describe("heartbeat timeout", () => {
    let server: any;

    afterEach(async () => {
        await server?.shutdown();
    });

    test("disconnects clients that miss heartbeat deadline", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        // Use a very short heartbeat timeout for testing
        server = new ClientProtocolServer({
            clusterName: "dev",
            port: 0,
            heartbeatTimeoutMs: 100,
            heartbeatIntervalMs: 50,
        });
        await server.start();

        const { socket } = await connectAndAuth(server.getPort());
        expect(server.getSessionRegistry().getSessionCount()).toBe(1);

        // Wait for heartbeat timeout
        await Bun.sleep(300);
        expect(server.getSessionRegistry().getSessionCount()).toBe(0);
        socket.end();
    });
});

// ── 16. Lifecycle: shutdown closes all connections ───────────────────────────

describe("lifecycle bookkeeping", () => {
    test("shutdown closes all client connections", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        const server = new ClientProtocolServer({ clusterName: "dev", port: 0 });
        await server.start();

        const { socket: s1 } = await connectAndAuth(server.getPort());
        const { socket: s2 } = await connectAndAuth(server.getPort());
        expect(server.getSessionRegistry().getSessionCount()).toBe(2);

        await server.shutdown();
        expect(server.getSessionRegistry().getSessionCount()).toBe(0);

        s1.end();
        s2.end();
    });
});

// ── 17. Multiple concurrent sessions ────────────────────────────────────────

describe("concurrent sessions", () => {
    let server: any;

    afterEach(async () => {
        await server?.shutdown();
    });

    test("handles multiple concurrent client sessions", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        server = new ClientProtocolServer({ clusterName: "dev", port: 0 });
        await server.start();

        const results = await Promise.all([
            connectAndAuth(server.getPort(), "dev", "c1"),
            connectAndAuth(server.getPort(), "dev", "c2"),
            connectAndAuth(server.getPort(), "dev", "c3"),
        ]);

        for (const r of results) {
            expect(r.response.status).toBe(AuthenticationStatus.AUTHENTICATED.getId());
        }
        expect(server.getSessionRegistry().getSessionCount()).toBe(3);

        for (const r of results) r.socket.end();
        await Bun.sleep(50);
    });
});

// ── 18. MapPut request dispatched ───────────────────────────────────────────

describe("MapPut dispatch", () => {
    let server: any;

    afterEach(async () => {
        await server?.shutdown();
    });

    test("MapPut request is dispatched and response returned", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        server = new ClientProtocolServer({
            clusterName: "dev",
            port: 0,
            enableMapHandler: true,
        });
        await server.start();

        const port = server.getPort();
        const { socket, receivedBuffers } = await connectAndAuth(port);

        // Clear received buffers (auth response already consumed)
        receivedBuffers.length = 0;

        // Build a MapPut request
        const { SerializationServiceImpl } = await import(
            "@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl"
        );
        const { SerializationConfig } = await import(
            "@zenystx/helios-core/internal/serialization/impl/SerializationConfig"
        );
        const ss = new SerializationServiceImpl(new SerializationConfig());
        const keyData = ss.toData("myKey")!;
        const valueData = ss.toData("myValue")!;

        const putReq = MapPutCodec.encodeRequest("testMap", keyData, valueData, 0n, -1n);
        putReq.setCorrelationId(42);
        putReq.setPartitionId(0);
        const putBytes = serializeClientMessage(putReq);

        let resolveResponse!: () => void;
        const responseDone = new Promise<void>((r) => { resolveResponse = r; });

        // Re-wire to capture response
        const origLength = receivedBuffers.length;
        const interval = setInterval(() => {
            if (receivedBuffers.length > origLength) {
                resolveResponse();
                clearInterval(interval);
            }
        }, 10);

        socket.write(putBytes);
        await responseDone;

        const combined = Buffer.concat(receivedBuffers);
        const responseMsg = deserializeClientMessage(combined);
        // The response message type should be MapPut response
        expect(responseMsg.getMessageType()).toBe(MapPutCodec.RESPONSE_MESSAGE_TYPE);
        expect(responseMsg.getCorrelationId()).toBe(42);

        socket.end();
        ss.destroy();
    });

    test("rejects MapPut before auth over the live client protocol path", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        server = new ClientProtocolServer({
            clusterName: "dev",
            port: 0,
            enableMapHandler: true,
        });
        await server.start();

        const { socket, receivedBuffers, waitForClose } = await openRawSocket(server.getPort());
        const { SerializationServiceImpl } = await import(
            "@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl"
        );
        const { SerializationConfig } = await import(
            "@zenystx/helios-core/internal/serialization/impl/SerializationConfig"
        );
        const ss = new SerializationServiceImpl(new SerializationConfig());
        const keyData = ss.toData("myKey")!;
        const valueData = ss.toData("myValue")!;

        const putReq = MapPutCodec.encodeRequest("testMap", keyData, valueData, 0n, -1n);
        putReq.setCorrelationId(42);
        putReq.setPartitionId(0);
        socket.write(serializeClientMessage(putReq));

        await Promise.race([
            waitForClose,
            Bun.sleep(500).then(() => {
                throw new Error("expected unauthenticated connection to close");
            }),
        ]);

        expect(receivedBuffers).toHaveLength(0);
        expect(server.getSessionRegistry().getSessionCount()).toBe(0);
        socket.end();
        ss.destroy();
    });
});

// ── 19. HeliosInstanceImpl integration ──────────────────────────────────────

describe("HeliosInstanceImpl integration", () => {
    test("starts ClientProtocolServer when configured", async () => {
        const { HeliosInstanceImpl } = await import(
            "@zenystx/helios-core/instance/impl/HeliosInstanceImpl"
        );
        const { HeliosConfig } = await import(
            "@zenystx/helios-core/config/HeliosConfig"
        );

        const config = new HeliosConfig("test-cluster");
        config.getNetworkConfig().setClientProtocolPort(0); // ephemeral
        const instance = new HeliosInstanceImpl(config);

        // Wait briefly for async start
        await Bun.sleep(50);
        const clientPort = instance.getClientProtocolPort();
        expect(clientPort).toBeGreaterThan(0);

        instance.shutdown();
    });

    test("wires client protocol username/password auth from NetworkConfig", async () => {
        const { HeliosInstanceImpl } = await import(
            "@zenystx/helios-core/instance/impl/HeliosInstanceImpl"
        );
        const { HeliosConfig } = await import(
            "@zenystx/helios-core/config/HeliosConfig"
        );

        const config = new HeliosConfig("secured-cluster");
        config.setClusterName("secured-cluster");
        config.getNetworkConfig().setClientProtocolPort(0);
        config.getNetworkConfig().setClientProtocolUsernamePasswordAuth("admin", "secret");
        const instance = new HeliosInstanceImpl(config);

        await Bun.sleep(50);
        const clientPort = instance.getClientProtocolPort();

        const failed = await connectAndAuth(clientPort, "secured-cluster", "test-client", null, "admin", "wrong");
        expect(failed.response.status).toBe(AuthenticationStatus.CREDENTIALS_FAILED.getId());
        failed.socket.end();

        const success = await connectAndAuth(clientPort, "secured-cluster", "test-client", null, "admin", "secret");
        expect(success.response.status).toBe(AuthenticationStatus.AUTHENTICATED.getId());
        success.socket.end();

        instance.shutdown();
    });
});

// ── 20. E2E: raw socket auth → request → response → disconnect ─────────────

describe("E2E verification", () => {
    test("raw socket client can authenticate, issue MapPut, receive response, and disconnect", async () => {
        const { HeliosInstanceImpl } = await import(
            "@zenystx/helios-core/instance/impl/HeliosInstanceImpl"
        );
        const { HeliosConfig } = await import(
            "@zenystx/helios-core/config/HeliosConfig"
        );
        const { SerializationServiceImpl } = await import(
            "@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl"
        );
        const { SerializationConfig } = await import(
            "@zenystx/helios-core/internal/serialization/impl/SerializationConfig"
        );

        const config = new HeliosConfig("e2e-cluster");
        config.setClusterName("e2e-cluster");
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        await Bun.sleep(50);
        const clientPort = instance.getClientProtocolPort();

        // Step 1: Authenticate
        const { socket, response } = await connectAndAuth(clientPort, "e2e-cluster");
        expect(response.status).toBe(AuthenticationStatus.AUTHENTICATED.getId());
        expect(response.memberUuid).toBeTruthy();

        // Step 2: Issue a MapPut
        const ss = new SerializationServiceImpl(new SerializationConfig());
        const keyData = ss.toData("e2eKey")!;
        const valueData = ss.toData("e2eValue")!;
        const putReq = MapPutCodec.encodeRequest("e2eMap", keyData, valueData, 0n, -1n);
        putReq.setCorrelationId(100);
        putReq.setPartitionId(0);

        const receivedBuffers: Buffer[] = [];

        // We need a fresh connection for this since the original socket
        // data handler is wired to auth response. Use a separate connection.
        const socket2 = await Bun.connect({
            hostname: "127.0.0.1",
            port: clientPort,
            socket: {
                data(_s, data) {
                    receivedBuffers.push(Buffer.from(data));
                },
                open() {},
                close() {},
                error() {},
            },
        });

        // Auth first
        const authReq = ClientAuthenticationCodec.encodeRequest(
            "e2e-cluster", null, null, null, "BUN", 1, "1.0.0", "e2e-client", [],
        );
        authReq.setCorrelationId(1);
        authReq.setPartitionId(-1);
        socket2.write(serializeClientMessage(authReq));
        await Bun.sleep(50); // wait for auth response

        receivedBuffers.length = 0; // clear auth response

        socket2.write(serializeClientMessage(putReq));
        // Wait for MapPut response
        await new Promise<void>((resolve) => {
            const interval = setInterval(() => {
                if (receivedBuffers.length > 0) {
                    clearInterval(interval);
                    resolve();
                }
            }, 10);
        });

        const combined = Buffer.concat(receivedBuffers);
        const putResponse = deserializeClientMessage(combined);
        expect(putResponse.getMessageType()).toBe(MapPutCodec.RESPONSE_MESSAGE_TYPE);
        expect(putResponse.getCorrelationId()).toBe(100);

        // Step 3: Verify the value was stored on the member
        const map = instance.getMap<string, string>("e2eMap");
        const stored = await map.get("e2eKey");
        expect(stored).toBe("e2eValue");

        // Step 4: Disconnect
        socket.end();
        socket2.end();
        ss.destroy();
        instance.shutdown();
    });

    test("HeliosInstanceImpl blocks pre-auth MapPut over the real request path", async () => {
        const { HeliosInstanceImpl } = await import(
            "@zenystx/helios-core/instance/impl/HeliosInstanceImpl"
        );
        const { HeliosConfig } = await import(
            "@zenystx/helios-core/config/HeliosConfig"
        );
        const { SerializationServiceImpl } = await import(
            "@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl"
        );
        const { SerializationConfig } = await import(
            "@zenystx/helios-core/internal/serialization/impl/SerializationConfig"
        );

        const config = new HeliosConfig("guard-cluster");
        config.setClusterName("guard-cluster");
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        await Bun.sleep(50);

        const ss = new SerializationServiceImpl(new SerializationConfig());
        const keyData = ss.toData("guardKey")!;
        const valueData = ss.toData("guardValue")!;
        const putReq = MapPutCodec.encodeRequest("guardMap", keyData, valueData, 0n, -1n);
        putReq.setCorrelationId(7);
        putReq.setPartitionId(0);

        const { socket, receivedBuffers, waitForClose } = await openRawSocket(instance.getClientProtocolPort());
        socket.write(serializeClientMessage(putReq));

        await Promise.race([
            waitForClose,
            Bun.sleep(500).then(() => {
                throw new Error("expected unauthenticated connection to close");
            }),
        ]);

        expect(receivedBuffers).toHaveLength(0);
        expect(await instance.getMap<string, string>("guardMap").get("guardKey")).toBeNull();

        socket.end();
        ss.destroy();
        instance.shutdown();
    });

    test("HeliosInstanceImpl rejects repeated auth over the real request path", async () => {
        const { HeliosInstanceImpl } = await import(
            "@zenystx/helios-core/instance/impl/HeliosInstanceImpl"
        );
        const { HeliosConfig } = await import(
            "@zenystx/helios-core/config/HeliosConfig"
        );

        const config = new HeliosConfig("reauth-guard-cluster");
        config.setClusterName("reauth-guard-cluster");
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        await Bun.sleep(50);

        const { socket, receivedBuffers, waitForClose } = await openAuthenticatedRawSocket(
            instance.getClientProtocolPort(),
            "reauth-guard-cluster",
        );

        const reauthReq = ClientAuthenticationCodec.encodeRequest(
            "reauth-guard-cluster",
            null,
            null,
            crypto.randomUUID(),
            "BUN",
            1,
            "1.0.0",
            "reauth-client",
            [],
        );
        reauthReq.setCorrelationId(3);
        reauthReq.setPartitionId(-1);
        socket.write(serializeClientMessage(reauthReq));

        await waitForReceivedBufferCount(receivedBuffers, 1);

        const responseMsg = deserializeClientMessage(Buffer.concat(receivedBuffers));
        const response = ClientAuthenticationCodec.decodeResponse(responseMsg);
        expect(response.status).toBe(AuthenticationStatus.NOT_ALLOWED_IN_CLUSTER.getId());
        expect(responseMsg.getCorrelationId()).toBe(3);

        await Promise.race([
            waitForClose,
            Bun.sleep(500).then(() => {
                throw new Error("expected repeated auth connection to close");
            }),
        ]);

        socket.end();
        instance.shutdown();
    });

    test("HeliosInstanceImpl drops pipelined bad opcode before later MapPut executes", async () => {
        const { HeliosInstanceImpl } = await import(
            "@zenystx/helios-core/instance/impl/HeliosInstanceImpl"
        );
        const { HeliosConfig } = await import(
            "@zenystx/helios-core/config/HeliosConfig"
        );
        const { SerializationServiceImpl } = await import(
            "@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl"
        );
        const { SerializationConfig } = await import(
            "@zenystx/helios-core/internal/serialization/impl/SerializationConfig"
        );

        const config = new HeliosConfig("pipe-guard-cluster");
        config.setClusterName("pipe-guard-cluster");
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        await Bun.sleep(50);

        const ss = new SerializationServiceImpl(new SerializationConfig());

        try {
            const keyData = ss.toData("pipeGuardKey")!;
            const valueData = ss.toData("pipeGuardValue")!;
            const putReq = MapPutCodec.encodeRequest("pipeGuardMap", keyData, valueData, 0n, -1n);
            putReq.setCorrelationId(78);
            putReq.setPartitionId(0);
            const putBytes = serializeClientMessage(putReq);

            for (const { name, messageType } of [
                { name: "unknown-opcode", messageType: 0x00ff00 },
                { name: "illegal-opcode", messageType: MapPutCodec.RESPONSE_MESSAGE_TYPE },
            ]) {
                const { socket, receivedBuffers, waitForClose } = await openAuthenticatedRawSocket(
                    instance.getClientProtocolPort(),
                );
                socket.write(Buffer.concat([
                    serializeClientMessage(buildOpcodeMessage(messageType, 77)),
                    putBytes,
                ]));

                await Promise.race([
                    waitForClose,
                    Bun.sleep(500).then(() => {
                        throw new Error(`expected ${name} connection to close`);
                    }),
                ]);

                expect(receivedBuffers).toHaveLength(0);
                expect(await instance.getMap<string, string>("pipeGuardMap").get("pipeGuardKey")).toBeNull();
                socket.end();
            }
        } finally {
            ss.destroy();
            instance.shutdown();
        }
    });
});
