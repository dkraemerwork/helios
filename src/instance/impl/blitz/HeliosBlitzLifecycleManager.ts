/**
 * Manages the Blitz lifecycle within a Helios instance.
 *
 * Owns readiness gates, bootstrap-local → clustered cutover,
 * registration/remove message generation, rejoin state reset,
 * and deterministic shutdown cleanup.
 *
 * This class does NOT spawn NATS processes itself — it tracks
 * lifecycle state and generates protocol messages. The actual
 * process management is done by the clusterNode primitive via
 * NatsServerManager, orchestrated by HeliosInstanceImpl.
 */
import type { HeliosBlitzRuntimeConfig } from "@zenystx/helios-core/config/BlitzRuntimeConfig";
import type {
  BlitzNodeRegisterMsg,
  BlitzNodeRemoveMsg,
} from "@zenystx/helios-core/cluster/tcp/ClusterMessage";

/**
 * Readiness states for the Blitz lifecycle within Helios.
 * Follows Hazelcast's pattern: operations blocked until joined.
 */
export enum BlitzReadinessState {
  /** Initial state — no local NATS node started yet. */
  NOT_READY = "NOT_READY",
  /** Local embedded NATS node started, awaiting Helios join/master info. */
  LOCAL_STARTED = "LOCAL_STARTED",
  /** Helios join complete, ready for topology registration. */
  JOIN_READY = "JOIN_READY",
  /** Registered with master, awaiting or completed clustered cutover. */
  REGISTERED = "REGISTERED",
  /** Fully operational — clustered or standalone. */
  READY = "READY",
  /** Shut down. */
  SHUT_DOWN = "SHUT_DOWN",
}

export class HeliosBlitzLifecycleManager {
  private readonly _config: HeliosBlitzRuntimeConfig;
  private readonly _memberId: string;
  private _readinessState: BlitzReadinessState;
  private _bootstrapPhase: "local" | "clustered" | "local-only";
  private _cutoverDone = false;
  private _masterMemberId: string | null = null;
  private _memberListVersion = 0;
  private _shutDown = false;

  constructor(config: HeliosBlitzRuntimeConfig, memberId: string) {
    this._config = config;
    this._memberId = memberId;

    if (config.mode === "embedded-local") {
      this._readinessState = BlitzReadinessState.NOT_READY;
      this._bootstrapPhase = "local-only";
    } else {
      this._readinessState = BlitzReadinessState.NOT_READY;
      this._bootstrapPhase = "local";
    }
  }

  getReadinessState(): BlitzReadinessState {
    return this._readinessState;
  }

  getBootstrapPhase(): "local" | "clustered" | "local-only" {
    return this._bootstrapPhase;
  }

  getMemberId(): string {
    return this._memberId;
  }

  getConfig(): HeliosBlitzRuntimeConfig {
    return this._config;
  }

  isShutDown(): boolean {
    return this._shutDown;
  }

  /**
   * Called after the local embedded NATS node is started.
   * Transitions from NOT_READY → LOCAL_STARTED.
   */
  onLocalNodeStarted(): void {
    if (this._shutDown) return;
    if (this._bootstrapPhase === "local-only") {
      this._readinessState = BlitzReadinessState.READY;
      return;
    }
    this._readinessState = BlitzReadinessState.LOCAL_STARTED;
  }

  /**
   * Called when Helios cluster join is complete or this node becomes master.
   * This is the readiness gate — topology registration is only allowed after this.
   */
  onJoinComplete(masterMemberId: string, memberListVersion: number): void {
    if (this._shutDown) return;
    this._masterMemberId = masterMemberId;
    this._memberListVersion = memberListVersion;
    if (this._readinessState === BlitzReadinessState.LOCAL_STARTED ||
        this._readinessState === BlitzReadinessState.NOT_READY) {
      this._readinessState = BlitzReadinessState.JOIN_READY;
    }
  }

  /**
   * Whether this node can register its Blitz metadata with the master.
   * Blocked until join/master readiness gate has passed.
   */
  canRegisterWithMaster(): boolean {
    return (
      !this._shutDown &&
      this._readinessState !== BlitzReadinessState.NOT_READY &&
      this._readinessState !== BlitzReadinessState.LOCAL_STARTED &&
      this._readinessState !== BlitzReadinessState.SHUT_DOWN
    );
  }

  /**
   * Check if the one-time bootstrap-local → clustered cutover is needed.
   *
   * Cutover is needed when:
   * - Node is not standalone master with no peers (routes non-empty)
   * - Cutover has not already been performed
   * - Bootstrap phase is still "local"
   */
  needsClusteredCutover(authoritativeRoutes: string[]): boolean {
    if (this._cutoverDone) return false;
    if (this._bootstrapPhase !== "local") return false;
    if (authoritativeRoutes.length === 0) return false;
    return true;
  }

  /**
   * Called when this node has successfully registered with the current master.
   * Transitions from JOIN_READY → REGISTERED.
   */
  onRegisteredWithMaster(): void {
    if (this._shutDown) return;
    if (this._readinessState === BlitzReadinessState.JOIN_READY) {
      this._readinessState = BlitzReadinessState.REGISTERED;
    }
  }

  /**
   * Mark the one-time cutover as complete.
   * After this, the node is in "clustered" phase and no further cutover is allowed.
   */
  onClusteredCutoverComplete(): void {
    this._cutoverDone = true;
    this._bootstrapPhase = "clustered";
    this._readinessState = BlitzReadinessState.READY;
  }

  /**
   * Mark standalone master as ready when no cutover is needed (no peers).
   * Only valid when bootstrap phase is "local" and no routes exist.
   */
  onStandaloneReady(): void {
    if (this._shutDown) return;
    if (this._bootstrapPhase === "local") {
      this._readinessState = BlitzReadinessState.READY;
    }
  }

  /**
   * Strict pre-cutover readiness fence.
   *
   * Returns true ONLY when the Blitz runtime is fully available for:
   * - Blitz-owned resource creation
   * - User-facing operations
   * - NestJS bridge exposure
   * - Readiness success reporting
   *
   * Fail-closed: retryable, stale, or pre-cutover local-only states return false.
   * Only authoritative topology application + post-cutover JetStream readiness
   * (represented by READY state) clears this fence.
   */
  isBlitzAvailable(): boolean {
    return this._readinessState === BlitzReadinessState.READY;
  }

  /**
   * Mark this manager as shut down. Resets readiness state.
   */
  markShutdown(): void {
    this._shutDown = true;
    this._readinessState = BlitzReadinessState.SHUT_DOWN;
  }

  /**
   * Handle rejoin after restart or temporary loss.
   * Resets bootstrap phase to allow a new cutover with updated routes.
   */
  onRejoin(newMemberListVersion: number): void {
    if (this._shutDown) return;
    this._memberListVersion = newMemberListVersion;
    this._cutoverDone = false;
    this._bootstrapPhase = "local";
    this._readinessState = BlitzReadinessState.LOCAL_STARTED;
  }

  /**
   * Generate the BLITZ_NODE_REGISTER message for this node.
   */
  generateRegisterMessage(): BlitzNodeRegisterMsg {
    const config = this._config;
    return {
      type: "BLITZ_NODE_REGISTER",
      registration: {
        memberId: this._memberId,
        memberListVersion: this._memberListVersion,
        serverName: `blitz-${this._memberId}`,
        clientPort: config.localPort ?? 4222,
        clusterPort: config.localClusterPort ?? 6222,
        advertiseHost: config.advertiseHost ?? "127.0.0.1",
        clusterName: config.clusterName ?? "helios-blitz-cluster",
        ready: this._readinessState === BlitzReadinessState.READY,
        startedAt: Date.now(),
      },
    };
  }

  /**
   * Generate the BLITZ_NODE_REMOVE message for this node.
   */
  generateRemoveMessage(): BlitzNodeRemoveMsg {
    return {
      type: "BLITZ_NODE_REMOVE",
      memberId: this._memberId,
    };
  }
}
