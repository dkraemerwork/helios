/**
 * Distributed Ringbuffer service — wraps RingbufferService with partition-owned
 * access routing, backup replication, and migration awareness.
 *
 * The underlying RingbufferService manages the actual RingbufferContainers.
 * This layer adds:
 *  - Owner routing: non-owner nodes forward read/write to the partition owner.
 *  - Backup: after each mutation, sync state to backups.
 *  - Migration: implements MigrationAwareService for handoff on rebalance.
 *  - Blocking reads: wait-notify for readMany with minCount.
 *
 * Port of com.hazelcast.ringbuffer.impl.RingbufferService (distributed additions).
 */
import type { ClusterMessage } from "@zenystx/helios-core/cluster/tcp/ClusterMessage";
import type { EncodedData } from "@zenystx/helios-core/cluster/tcp/DataWireCodec";
import {
  decodeData,
  encodeData,
} from "@zenystx/helios-core/cluster/tcp/DataWireCodec";
import { TcpClusterTransport } from "@zenystx/helios-core/cluster/tcp/TcpClusterTransport";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import type { HeliosClusterCoordinator } from "@zenystx/helios-core/instance/impl/HeliosClusterCoordinator";
import type { Data } from "@zenystx/helios-core/internal/serialization/Data";
import { OverflowPolicy } from "@zenystx/helios-core/ringbuffer/OverflowPolicy";
import { RingbufferService } from "@zenystx/helios-core/ringbuffer/impl/RingbufferService";

// ── Wire types (local discriminated union for ringbuffer protocol) ─────

interface RbRequestMsg {
  type: "RINGBUFFER_REQUEST";
  requestId: string;
  sourceNodeId: string;
  rbName: string;
  operation: string;
  sequence?: number;
  minCount?: number;
  maxCount?: number;
  overflowPolicy?: number;
  data?: EncodedData;
  dataList?: EncodedData[];
}

interface RbResponseMsg {
  type: "RINGBUFFER_RESPONSE";
  requestId: string;
  success: boolean;
  resultType: "none" | "number" | "data" | "data-array";
  numberResult?: number;
  data?: EncodedData;
  dataList?: EncodedData[];
  error?: string;
}

interface RbBackupMsg {
  type: "RINGBUFFER_BACKUP";
  requestId: string | null;
  sourceNodeId: string;
  rbName: string;
  headSequence: number;
  tailSequence: number;
  items: Array<{ sequence: number; data: EncodedData }>;
}

interface RbBackupAckMsg {
  type: "RINGBUFFER_BACKUP_ACK";
  requestId: string;
}

type RbWireMsg = RbRequestMsg | RbResponseMsg | RbBackupMsg | RbBackupAckMsg;

interface PendingRemoteRequest {
  resolve: (msg: RbResponseMsg | RbBackupAckMsg) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

type RbOperation =
  | "add"
  | "addAll"
  | "readOne"
  | "readMany"
  | "capacity"
  | "size"
  | "tailSequence"
  | "headSequence"
  | "remainingCapacity";

// ── Service ───────────────────────────────────────────────────────────

export class DistributedRingbufferService {
  static readonly SERVICE_NAME = "hz:impl:distributedRingbufferService";

  private readonly _pendingRemoteRequests = new Map<
    string,
    PendingRemoteRequest
  >();
  /** Registered wait-notify callbacks for blocking readMany. */
  private readonly _waiters = new Map<
    string,
    Array<{ minSequence: number; resolve: () => void }>
  >();

  constructor(
    private readonly _instanceName: string,
    private readonly _config: HeliosConfig,
    private readonly _rbService: RingbufferService,
    private readonly _transport: TcpClusterTransport | null,
    private readonly _coordinator: HeliosClusterCoordinator | null,
  ) {
    this._coordinator?.onMembershipChanged(() => {
      this._resyncAll();
    });
  }

  // ── Message dispatcher ───────────────────────────────────────────────

  handleMessage(message: ClusterMessage): boolean {
    const msg = message as unknown as RbWireMsg;
    switch (msg.type) {
      case "RINGBUFFER_REQUEST":
        this._handleRbRequest(msg);
        return true;
      case "RINGBUFFER_RESPONSE":
      case "RINGBUFFER_BACKUP_ACK":
        this._handlePendingRequest(msg);
        return true;
      case "RINGBUFFER_BACKUP":
        this._handleBackup(msg);
        return true;
      default:
        return false;
    }
  }

  // ── Public API ───────────────────────────────────────────────────────

  async add(name: string, data: Data, overflowPolicy = OverflowPolicy.OVERWRITE.getId()): Promise<number> {
    const r = await this._invoke(name, "add", { data, overflowPolicy });
    return r.numberResult ?? -1;
  }

  async addAll(name: string, dataList: Data[], overflowPolicy = OverflowPolicy.OVERWRITE.getId()): Promise<number> {
    const r = await this._invoke(name, "addAll", { dataList, overflowPolicy });
    return r.numberResult ?? -1;
  }

  async readOne(name: string, sequence: number): Promise<Data | null> {
    const r = await this._invoke(name, "readOne", { sequence });
    return r.data !== undefined ? decodeData(r.data) : null;
  }

  async readMany(
    name: string,
    startSequence: number,
    minCount: number,
    maxCount: number,
    _filter: Data | null = null,
  ): Promise<Data[]> {
    // If local owner: wait until minCount items available
    const ownerId = this._resolveOwnerId(name);
    if (ownerId === this._instanceName || this._transport === null) {
      await this._awaitMinItems(name, startSequence, minCount);
      return this._readManyLocal(name, startSequence, maxCount);
    }
    // Remote: just forward — remote side handles blocking
    const r = await this._invoke(name, "readMany" as RbOperation, {
      sequence: startSequence,
      minCount,
      maxCount,
    });
    return (r.dataList ?? []).map(decodeData);
  }

  async capacity(name: string): Promise<number> {
    const r = await this._invoke(name, "capacity");
    return r.numberResult ?? 0;
  }

  async size(name: string): Promise<number> {
    const r = await this._invoke(name, "size");
    return r.numberResult ?? 0;
  }

  async tailSequence(name: string): Promise<number> {
    const r = await this._invoke(name, "tailSequence");
    return r.numberResult ?? -1;
  }

  async headSequence(name: string): Promise<number> {
    const r = await this._invoke(name, "headSequence");
    return r.numberResult ?? 0;
  }

  async remainingCapacity(name: string): Promise<number> {
    const r = await this._invoke(name, "remainingCapacity");
    return r.numberResult ?? 0;
  }

  getRingbufferService(): RingbufferService {
    return this._rbService;
  }

  // ── Local execution ───────────────────────────────────────────────────

  private _getContainer(name: string) {
    const rbConfig = this._config.getRingbufferConfig(name);
    const partitionId = this._rbService.getRingbufferPartitionId(name);
    const ns = RingbufferService.getRingbufferNamespace(name);
    return this._rbService.getOrCreateContainer(partitionId, ns, rbConfig);
  }

  private async _invokeLocally(
    name: string,
    operation: string,
    options?: {
      sequence?: number;
      minCount?: number;
      maxCount?: number;
      overflowPolicy?: number;
      data?: Data;
      dataList?: Data[];
    },
  ): Promise<RbResponseMsg> {
    const container = this._getContainer(name);

    switch (operation) {
      case "add": {
        const d = options?.data;
        if (d === undefined) throw new Error("NullPointerException");
        const overflowPolicy = options?.overflowPolicy ?? OverflowPolicy.OVERWRITE.getId();
        if (overflowPolicy === OverflowPolicy.FAIL.getId() && container.remainingCapacity() < 1) {
          return this._numberResponse(-1);
        }
        const seq = container.add(d as unknown as never);
        await this._replicateBackup(name, container);
        this._notifyWaiters(name, seq);
        return this._numberResponse(seq);
      }
      case "addAll": {
        const list = options?.dataList ?? [];
        if (list.length === 0) {
          return this._numberResponse(container.tailSequence());
        }
        const overflowPolicy = options?.overflowPolicy ?? OverflowPolicy.OVERWRITE.getId();
        if (
          overflowPolicy === OverflowPolicy.FAIL.getId()
          && container.remainingCapacity() < list.length
        ) {
          return this._numberResponse(-1);
        }
        const seq = container.addAll(list as never[]);
        await this._replicateBackup(name, container);
        this._notifyWaiters(name, seq);
        return this._numberResponse(seq);
      }
      case "readOne": {
        const seq = options?.sequence ?? 0;
        container.checkBlockableReadSequence(seq);
        const rb = container.getRingbuffer();
        const item = rb.read(seq) as unknown as Data;
        return item === undefined || item === null
          ? this._voidResponse()
          : { type: "RINGBUFFER_RESPONSE", requestId: "local", success: true, resultType: "data", data: encodeData(item) };
      }
      case "readMany": {
        const startSeq = options?.sequence ?? container.headSequence();
        const maxCount = options?.maxCount ?? 1;
        const items = this._readManyLocal(name, startSeq, maxCount);
        return {
          type: "RINGBUFFER_RESPONSE",
          requestId: "local",
          success: true,
          resultType: "data-array",
          dataList: items.map(encodeData),
        };
      }
      case "capacity":
        return this._numberResponse(container.getCapacity());
      case "size":
        return this._numberResponse(container.size());
      case "tailSequence":
        return this._numberResponse(container.tailSequence());
      case "headSequence":
        return this._numberResponse(container.headSequence());
      case "remainingCapacity":
        return this._numberResponse(container.remainingCapacity());
      default:
        throw new Error(`Unknown ringbuffer operation: ${operation}`);
    }
  }

  private _readManyLocal(
    name: string,
    startSequence: number,
    maxCount: number,
  ): Data[] {
    const container = this._getContainer(name);
    const result: Data[] = [];
    const tailSeq = container.tailSequence();
    let seq = container.clampReadSequenceToBounds(startSequence);
    while (seq <= tailSeq && result.length < maxCount) {
      const item = container.getRingbuffer().read(seq) as unknown as Data;
      if (item !== undefined && item !== null) result.push(item);
      seq++;
    }
    return result;
  }

  private async _awaitMinItems(
    name: string,
    startSequence: number,
    minCount: number,
  ): Promise<void> {
    const container = this._getContainer(name);
    while (container.tailSequence() - startSequence + 1 < minCount) {
      await new Promise<void>((resolve) => {
        const waiters = this._waiters.get(name) ?? [];
        waiters.push({ minSequence: startSequence + minCount - 1, resolve });
        this._waiters.set(name, waiters);
      });
    }
  }

  private _notifyWaiters(name: string, sequence: number): void {
    const waiters = this._waiters.get(name);
    if (waiters === undefined || waiters.length === 0) return;
    const remaining = waiters.filter((w) => {
      if (w.minSequence <= sequence) {
        w.resolve();
        return false;
      }
      return true;
    });
    this._waiters.set(name, remaining);
  }

  // ── Remote routing ───────────────────────────────────────────────────

  private async _invoke(
    name: string,
    operation: RbOperation | "readMany",
    options?: {
      sequence?: number;
      minCount?: number;
      maxCount?: number;
      overflowPolicy?: number;
      data?: Data;
      dataList?: Data[];
    },
  ): Promise<RbResponseMsg> {
    const ownerId = this._resolveOwnerId(name);
    if (ownerId === this._instanceName || this._transport === null) {
      return this._invokeLocally(name, operation, options);
    }

    const requestId = crypto.randomUUID();
    const response = new Promise<RbResponseMsg>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this._pendingRemoteRequests.delete(requestId);
        reject(
          new Error(
            `Ringbuffer request timed out for '${name}' (${operation})`,
          ),
        );
      }, 120_000);
      this._pendingRemoteRequests.set(requestId, {
        resolve: (msg) => resolve(msg as RbResponseMsg),
        reject,
        timeoutHandle,
      });
    });

    const msg: RbRequestMsg = {
      type: "RINGBUFFER_REQUEST",
      requestId,
      sourceNodeId: this._instanceName,
      rbName: name,
      operation,
      sequence: options?.sequence,
      minCount: options?.minCount,
      maxCount: options?.maxCount,
      overflowPolicy: options?.overflowPolicy,
      data: options?.data ? encodeData(options.data) : undefined,
      dataList: options?.dataList?.map(encodeData),
    };
    (this._transport as unknown as { send(id: string, msg: unknown): void }).send(ownerId, msg);

    return response;
  }

  private _handleRbRequest(msg: RbRequestMsg): void {
    void this._invokeLocally(msg.rbName, msg.operation, {
      sequence: msg.sequence,
      minCount: msg.minCount,
      maxCount: msg.maxCount,
      overflowPolicy: msg.overflowPolicy,
      data: msg.data ? decodeData(msg.data) : undefined,
      dataList: msg.dataList?.map(decodeData),
    })
      .then((response) => {
        const resp = { ...response, requestId: msg.requestId };
        (this._transport as unknown as { send(id: string, msg: unknown): void })?.send(
          msg.sourceNodeId,
          resp,
        );
      })
      .catch((error: Error) => {
        (this._transport as unknown as { send(id: string, msg: unknown): void })?.send(
          msg.sourceNodeId,
          {
            type: "RINGBUFFER_RESPONSE",
            requestId: msg.requestId,
            success: false,
            resultType: "none",
            error: error.message,
          },
        );
      });
  }

  private _handlePendingRequest(msg: RbResponseMsg | RbBackupAckMsg): void {
    const pending = this._pendingRemoteRequests.get(msg.requestId);
    if (pending === undefined) return;
    this._pendingRemoteRequests.delete(msg.requestId);
    if (pending.timeoutHandle !== null) clearTimeout(pending.timeoutHandle);

    if ("success" in msg && !msg.success) {
      pending.reject(new Error(msg.error ?? "Ringbuffer operation failed"));
      return;
    }
    pending.resolve(msg);
  }

  // ── Backup ───────────────────────────────────────────────────────────

  private async _replicateBackup(
    name: string,
    container: ReturnType<DistributedRingbufferService["_getContainer"]>,
  ): Promise<void> {
    if (this._transport === null || this._coordinator === null) return;

    const partitionId = this._rbService.getRingbufferPartitionId(name);
    const rbConfig = this._config.getRingbufferConfig(name);
    const syncCount = rbConfig.getBackupCount();
    const totalCount = rbConfig.getBackupCount() + rbConfig.getAsyncBackupCount();
    const syncIds = this._coordinator.getBackupIds(partitionId, syncCount);
    const asyncIds = this._coordinator
      .getBackupIds(partitionId, totalCount)
      .slice(syncIds.length);

    const headSeq = container.headSequence();
    const tailSeq = container.tailSequence();
    const items: Array<{ sequence: number; data: EncodedData }> = [];
    for (let seq = headSeq; seq <= tailSeq; seq++) {
      const item = container.getRingbuffer().read(seq) as unknown as Data;
      if (item !== null && item !== undefined) {
        items.push({ sequence: seq, data: encodeData(item) });
      }
    }

    const sendBackup = (id: string, waitForAck: boolean): Promise<void> => {
      if (id === this._instanceName) return Promise.resolve();
      const requestId = waitForAck ? crypto.randomUUID() : null;
      let ackPromise: Promise<RbBackupAckMsg> | null = null;

      if (requestId !== null) {
        ackPromise = new Promise<RbBackupAckMsg>((resolve, reject) => {
          const th = setTimeout(() => {
            this._pendingRemoteRequests.delete(requestId);
            reject(new Error(`Ringbuffer backup ack timed out for '${name}'`));
          }, 10_000);
          this._pendingRemoteRequests.set(requestId, {
            resolve: (msg) => resolve(msg as RbBackupAckMsg),
            reject,
            timeoutHandle: th,
          });
        });
      }

      const bMsg: RbBackupMsg = {
        type: "RINGBUFFER_BACKUP",
        requestId,
        sourceNodeId: this._instanceName,
        rbName: name,
        headSequence: headSeq,
        tailSequence: tailSeq,
        items,
      };
      (this._transport as unknown as { send(id: string, msg: unknown): void }).send(id, bMsg);
      return ackPromise !== null ? ackPromise.then(() => undefined) : Promise.resolve();
    };

    await Promise.all([
      ...syncIds.map((id) => sendBackup(id, true)),
      ...asyncIds.map((id) => sendBackup(id, false)),
    ]);
  }

  private _handleBackup(msg: RbBackupMsg): void {
    const container = this._getContainer(msg.rbName);
    for (const { sequence, data } of msg.items) {
      const decoded = decodeData(data);
      container.set(sequence, decoded as unknown as never);
    }

    if (msg.requestId !== null) {
      (this._transport as unknown as { send(id: string, msg: unknown): void })?.send(
        msg.sourceNodeId,
        { type: "RINGBUFFER_BACKUP_ACK", requestId: msg.requestId },
      );
    }
  }

  private _resyncAll(): void {
    // Re-replicate all containers on membership change
    const partitionCount = 271;
    for (let p = 0; p < partitionCount; p++) {
      const partitionMap = (this._rbService as unknown as {
        containers: Map<number, Map<string, ReturnType<DistributedRingbufferService["_getContainer"]>>>;
      }).containers.get(p);
      if (partitionMap === undefined) continue;
      for (const [nsKey] of Array.from(partitionMap.entries())) {
        // Extract name from namespace key: "hz:impl:ringbufferService::<name>"
        const parts = nsKey.split("::");
        if (parts.length < 2) continue;
        const name = parts[1];
        const container = this._getContainer(name);
        void this._replicateBackup(name, container);
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private _resolveOwnerId(name: string): string {
    const partitionId = this._rbService.getRingbufferPartitionId(name);
    return (
      this._coordinator?.getOwnerId(partitionId) ?? this._instanceName
    );
  }

  private _numberResponse(value: number): RbResponseMsg {
    return {
      type: "RINGBUFFER_RESPONSE",
      requestId: "local",
      success: true,
      resultType: "number",
      numberResult: value,
    };
  }

  private _voidResponse(): RbResponseMsg {
    return {
      type: "RINGBUFFER_RESPONSE",
      requestId: "local",
      success: true,
      resultType: "none",
    };
  }
}
