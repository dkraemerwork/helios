import { jetstream, jetstreamManager, type JetStreamClient, type JetStreamManager } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBlitzConfig, type BlitzConfig, type ResolvedBlitzConfig } from './BlitzConfig.js';
import { BlitzEvent } from './BlitzEvent.js';
import { Pipeline } from './Pipeline.js';
import { BatchPipeline } from './batch/BatchPipeline.js';
import { NatsServerBinaryResolver } from './server/NatsServerBinaryResolver.js';
import type { NatsServerNodeConfig } from './server/NatsServerConfig.js';
import { NatsServerManager } from './server/NatsServerManager.js';
import { BlitzJob, type JobCoordinator } from '@zenystx/helios-core/job/BlitzJob.js';
import { JobStatus, isTerminalStatus } from '@zenystx/helios-core/job/JobStatus.js';
import { resolveJobConfig, type JobConfig, type ResolvedJobConfig } from '@zenystx/helios-core/job/JobConfig.js';
import type { BlitzJobCoordinator } from '@zenystx/helios-core/job/BlitzJobCoordinator.js';
import type { Sink } from './sink/Sink.js';
import type { Source } from './source/Source.js';
import type { OperatorFnEntry } from '@zenystx/helios-core/job/engine/JobExecution.js';
import { JobExecution } from '@zenystx/helios-core/job/engine/JobExecution.js';
import { MetricsCollector } from '@zenystx/helios-core/job/metrics/MetricsCollector.js';
import type { BlitzJobMetrics, VertexMetrics } from '@zenystx/helios-core/job/metrics/BlitzJobMetrics.js';
import type { PipelineDescriptor } from '@zenystx/helios-core/job/PipelineDescriptor.js';

/** Listener for BlitzEvents emitted by BlitzService. */
export type BlitzEventListener = (event: BlitzEvent, detail?: unknown) => void;

export interface BlitzJobMetadata {
    lightJob: boolean;
    participatingMembers: string[];
    supportsCancel: boolean;
    supportsRestart: boolean;
    executionStartTime: number | null;
    executionCompletionTime: number | null;
}

/**
 * BlitzService — top-level entry point for the Helios Blitz stream processing engine.
 *
 * Owns the NATS connection lifecycle: connect, expose JetStream/KV handles, shutdown.
 * Subscribes to `nc.status()` and emits {@link BlitzEvent}s for reconnect and error conditions.
 *
 * JetStream manager (`jsm`) and KV manager (`kvm`) are lazy-initialized on first
 * access. This allows BlitzService to connect to a NATS cluster that hasn't yet
 * elected a Raft leader (e.g. during cluster formation) — core pub/sub works
 * immediately, and JetStream operations become available once the leader is elected.
 *
 * Usage:
 * ```typescript
 * const blitz = await BlitzService.connect({ servers: 'nats://localhost:4222' });
 * blitz.on((event) => console.log('BlitzEvent:', event));
 * // Core NATS pub/sub is available immediately via blitz.nc
 * // JetStream operations are available once the cluster has a leader:
 * const jsm = await blitz.getJsm();
 * await blitz.shutdown();
 * ```
 */
export class BlitzService {
    /** Resolved configuration (all defaults applied). */
    readonly config: ResolvedBlitzConfig;

    /** The underlying NATS connection. */
    readonly nc: NatsConnection;

    /** JetStream publish/subscribe client (available immediately — does not require leader). */
    readonly js: JetStreamClient;

    /**
     * JetStream management API (streams, consumers).
     * @deprecated Use `getJsm()` for safe lazy initialization. This field is
     *             initialized eagerly when possible but may be null during
     *             cluster formation. Kept for backward compatibility.
     */
    get jsm(): JetStreamManager {
        if (this._jsm === null) {
            throw new Error(
                'JetStream manager is not yet initialized. The NATS cluster may still be electing a leader. ' +
                'Use `await blitz.getJsm()` for retry-based initialization, or `blitz.waitForJetStream()` to block until ready.',
            );
        }
        return this._jsm;
    }

    /**
     * Key-Value store manager.
     * @deprecated Use `getKvm()` for safe lazy initialization.
     */
    get kvm(): Kvm {
        if (this._kvm === null) {
            throw new Error(
                'KV manager is not yet initialized. The NATS cluster may still be electing a leader. ' +
                'Use `await blitz.getKvm()` for retry-based initialization, or `blitz.waitForJetStream()` to block until ready.',
            );
        }
        return this._kvm;
    }

    private _jsm: JetStreamManager | null;
    private _kvm: Kvm | null;
    private _closed = false;
    private _manager: NatsServerManager | null = null;
    private readonly _listeners: BlitzEventListener[] = [];
    private readonly _runningPipelines = new Map<string, Pipeline>();
    private _jsmInitPromise: Promise<JetStreamManager> | null = null;
    private _coordinator: BlitzJobCoordinator | null = null;
    private readonly _jobs = new Map<string, BlitzJob>();
    private readonly _standaloneExecutions = new Map<string, JobExecution>();
    private readonly _standaloneExecutionTimestamps = new Map<string, { startTime: number; completionTime: number | null }>();
    private readonly _jobDescriptors = new Map<string, PipelineDescriptor>();

    private constructor(
        config: ResolvedBlitzConfig,
        nc: NatsConnection,
        js: JetStreamClient,
        jsm: JetStreamManager | null,
        kvm: Kvm | null,
    ) {
        this.config = config;
        this.nc = nc;
        this.js = js;
        this._jsm = jsm;
        this._kvm = kvm;

        // Subscribe to NATS status events and forward as BlitzEvents.
        this._subscribeToStatus();
    }

    /**
     * Start an embedded NATS JetStream server and connect BlitzService to it.
     *
     * @throws NatsServerNotFoundError if the nats-server binary cannot be resolved.
     * @throws Error if the server(s) do not become reachable within startTimeoutMs.
     */
    static async start(config: Omit<BlitzConfig, 'servers'> = {}): Promise<BlitzService> {
        const resolved = resolveBlitzConfig(config);
        const nodeConfigs = buildNodeConfigs(resolved);
        const manager = await NatsServerManager.spawn(nodeConfigs);
        const servers = manager.clientUrls;
        // Strip embedded/cluster before calling connect — connect only needs servers
        const { embedded: _e, cluster: _c, ...rest } = config;
        const service = await BlitzService.connect({ ...rest, servers });
        service._manager = manager;
        return service;
    }

    /**
     * Establish a NATS connection and initialize JetStream/KV handles.
     *
     * Core NATS connection is established eagerly. JetStream manager and KV
     * manager initialization is attempted but will not block or fail if the
     * cluster hasn't elected a Raft leader yet — they become available lazily
     * via `getJsm()` / `getKvm()` / `waitForJetStream()`.
     *
     * @throws if the NATS TCP connection cannot be established within `config.connectTimeoutMs`.
     */
    static async connect(config: BlitzConfig): Promise<BlitzService> {
        const resolved = resolveBlitzConfig(config);
        if (!resolved.servers) {
            throw new Error('BlitzService.connect() requires `servers` in config. Use BlitzService.start() for embedded mode.');
        }

        const nc = await connect({
            servers: resolved.servers,
            timeout: resolved.connectTimeoutMs,
            reconnect: resolved.maxReconnectAttempts !== 0,
            maxReconnectAttempts: resolved.maxReconnectAttempts === -1
                ? undefined
                : resolved.maxReconnectAttempts,
            reconnectTimeWait: resolved.reconnectWaitMs,
        });

        const js = jetstream(nc);

        // Attempt eager JetStream manager init (non-blocking best-effort).
        // If the cluster hasn't elected a leader yet, jsm/kvm stay null
        // and are initialized lazily on first access via getJsm()/getKvm().
        let jsm: JetStreamManager | null = null;
        let kvm: Kvm | null = null;
        try {
            jsm = await jetstreamManager(nc, { timeout: 2000 });
            kvm = new Kvm(nc);
        } catch {
            // JetStream not ready yet (cluster forming, no Raft leader).
            // This is expected during multi-node cluster startup.
            // jsm/kvm will be lazy-initialized on first access.
        }

        return new BlitzService(resolved, nc, js, jsm, kvm);
    }

    /**
     * Returns true if this service has been shut down.
     */
    get isClosed(): boolean {
        return this._closed;
    }

    /**
     * Returns the number of nodes in the connected NATS cluster.
     *
     * Reads from `nc.info.connect_urls`, which the NATS server populates with
     * the URLs of all *other* known cluster members. Adding 1 for the currently
     * connected server gives the total cluster size.
     *
     * Returns 1 when connected to a standalone (single-node) NATS server, as
     * `connect_urls` is absent or empty in that case.
     */
    getClusterSize(): number {
        const urls = this.nc.info?.connect_urls;
        return (urls?.length ?? 0) + 1;
    }

    /**
     * Returns true if the JetStream manager has been initialized.
     * When false, JetStream operations are not yet available (cluster may still
     * be electing a Raft leader). Use `waitForJetStream()` to block until ready.
     */
    get isJetStreamReady(): boolean {
        return this._jsm !== null;
    }

    /**
     * Get the JetStream manager, initializing it lazily if needed.
     * Retries with backoff until JetStream is available.
     *
     * @param timeoutMs Maximum time to wait for JetStream readiness. @default 15000
     * @throws Error if JetStream does not become available within timeoutMs.
     */
    async getJsm(timeoutMs = 15_000): Promise<JetStreamManager> {
        if (this._jsm !== null) return this._jsm;
        await this.waitForJetStream(timeoutMs);
        return this._jsm!;
    }

    /**
     * Get the KV manager, initializing it lazily if needed.
     *
     * @param timeoutMs Maximum time to wait for JetStream readiness. @default 15000
     */
    async getKvm(timeoutMs = 15_000): Promise<Kvm> {
        if (this._kvm !== null) return this._kvm;
        await this.waitForJetStream(timeoutMs);
        return this._kvm!;
    }

    /**
     * Wait until JetStream is operational (Raft leader elected).
     * Polls with 200ms intervals, matching Hazelcast's "fast scan" pattern.
     *
     * @param timeoutMs Maximum time to wait. @default 15000
     * @throws Error if JetStream does not become available within timeoutMs.
     */
    async waitForJetStream(timeoutMs = 15_000): Promise<void> {
        if (this._jsm !== null) return;

        // Deduplicate concurrent calls
        if (this._jsmInitPromise !== null) {
            await this._jsmInitPromise;
            return;
        }

        this._jsmInitPromise = this._initJetStream(timeoutMs);
        try {
            await this._jsmInitPromise;
        } finally {
            this._jsmInitPromise = null;
        }
    }

    /**
     * Register a listener for BlitzEvents.
     * The listener receives the event type and an optional detail payload.
     */
    on(listener: BlitzEventListener): this {
        this._listeners.push(listener);
        return this;
    }

    /**
     * Remove a previously registered BlitzEvent listener.
     */
    off(listener: BlitzEventListener): this {
        const idx = this._listeners.indexOf(listener);
        if (idx !== -1) {
            this._listeners.splice(idx, 1);
        }
        return this;
    }

    /**
     * Create a new pipeline builder with the given name.
     * The pipeline is NOT submitted until `blitz.submit(p)` is called.
     */
    pipeline(name: string): Pipeline {
        return new Pipeline(name);
    }

    /**
     * Create a new bounded batch pipeline with the given name.
     *
     * A batch pipeline reads from a finite source (e.g. `FileSource.lines()`,
     * `HeliosMapSource.snapshot()`), processes records through operators, and
     * returns a `Promise<BatchResult>` when the source is exhausted.
     *
     * ```typescript
     * const result = await blitz.batch('etl-job')
     *   .readFrom(FileSource.lines('/data/input.ndjson'))
     *   .map(line => JSON.parse(line))
     *   .writeTo(HeliosMapSink.put(activeUsersMap));
     * ```
     */
    batch(name: string): BatchPipeline {
        return new BatchPipeline(name);
    }

    /**
     * Validate and submit a pipeline for execution.
     *
     * Validates the DAG structure (throws {@link PipelineError} on invalid DAG),
     * registers the pipeline as running, and starts consumer loops for each vertex.
     *
     * @throws PipelineError if the DAG is invalid
     */
    async submit(p: Pipeline): Promise<void> {
        // Validate throws PipelineError if the DAG is malformed
        p.validate();
        this._runningPipelines.set(p.name, p);
        // Consumer loop startup will be wired in Block 10.2+ when real sources/sinks are added.
    }

    /**
     * Cancel a running pipeline by name.
     *
     * Gracefully stops all consumer loops and removes the pipeline from the running set.
     * Emits {@link BlitzEvent.PIPELINE_CANCELLED}.
     * If no pipeline with the given name is running, this is a no-op.
     */
    async cancel(name: string): Promise<void> {
        if (!this._runningPipelines.has(name)) {
            return;
        }
        this._runningPipelines.delete(name);
        this._emit(BlitzEvent.PIPELINE_CANCELLED, { name });
    }

    /**
     * Returns true if a pipeline with the given name is currently running.
     */
    isRunning(name: string): boolean {
        return this._runningPipelines.has(name);
    }

    /**
     * Returns the number of jobs currently in RUNNING status.
     *
     * In cluster mode, delegates to the coordinator which tracks both regular
     * and light job statuses. In standalone mode, counts jobs in the local
     * jobs map that have RUNNING status.
     */
    getRunningJobCount(): number {
        if (this._coordinator !== null) {
            return this._coordinator.getRunningJobCount();
        }
        let count = 0;
        for (const job of this._jobs.values()) {
            if (job.getStatus() === JobStatus.RUNNING) count++;
        }
        return count;
    }

    getJobCounters(): { submitted: number; completedSuccessfully: number; completedWithFailure: number; executionStarted: number } {
        if (this._coordinator !== null) {
            return this._coordinator.getJobCounters();
        }

        let submitted = 0;
        let completedSuccessfully = 0;
        let completedWithFailure = 0;
        let executionStarted = 0;

        for (const job of this._jobs.values()) {
            submitted++;
            executionStarted++;
            const status = job.getStatus();
            if (status === JobStatus.COMPLETED) completedSuccessfully++;
            if (status === JobStatus.FAILED) completedWithFailure++;
        }

        return { submitted, completedSuccessfully, completedWithFailure, executionStarted };
    }

    // ── Job API ──────────────────────────────────────────────

    /**
     * Set the coordinator for cluster-mode job management.
     * When set, newJob() delegates to the coordinator for distributed execution.
     * When null (standalone), newJob() creates local light jobs.
     */
    setCoordinator(coordinator: BlitzJobCoordinator | null): void {
        this._coordinator = coordinator;
    }

    /**
     * Create and start a new job from a pipeline.
     *
     * - Standalone mode (no coordinator): runs as a local light job.
     * - Cluster mode (with coordinator): delegates to BlitzJobCoordinator for distributed execution.
     *
     * @returns A BlitzJob handle for lifecycle management.
     */
    async newJob(pipeline: Pipeline, config?: JobConfig): Promise<BlitzJob> {
        const resolved = resolveJobConfig(config, pipeline.name);

        if (this._coordinator) {
            const descriptor = pipeline.toDescriptor();
            const job = await this._coordinator.submitJob(descriptor, resolved);
            this._jobs.set(job.id, job);
            this._jobDescriptors.set(job.id, descriptor);
            this._emit(BlitzEvent.JOB_STARTED, { jobId: job.id, name: job.name });
            return job;
        }

        // Standalone mode — create a local light job
        return this._createStandaloneJob(pipeline, resolved);
    }

    /**
     * Create and start a lightweight local-only job (no coordinator required).
     * Light jobs run on this member only and do not support suspend/resume/restart.
     */
    async newLightJob(pipeline: Pipeline, config?: JobConfig): Promise<BlitzJob> {
        const resolved = resolveJobConfig(config, pipeline.name);
        return this._createStandaloneJob(pipeline, resolved);
    }

    /**
     * Look up a job by its ID.
     * Returns null if no job with the given ID exists.
     */
    getJob(id: string): BlitzJob | null {
        return this._jobs.get(id) ?? null;
    }

    /**
     * Get all jobs, optionally filtered by name.
     */
    getJobs(name?: string): BlitzJob[] {
        const all = [...this._jobs.values()];
        if (name === undefined) return all;
        return all.filter(j => j.name === name);
    }

    getJobDescriptor(id: string): PipelineDescriptor | null {
        return this._jobDescriptors.get(id) ?? null;
    }

    async getJobMetadata(id: string): Promise<BlitzJobMetadata | null> {
        const job = this._jobs.get(id);
        if (!job) {
            return null;
        }

        if (this._coordinator !== null) {
            const metadata = await this._coordinator.getJobMetadata(id);
            if (metadata !== null) {
                return metadata;
            }
        }

        return {
            lightJob: true,
            participatingMembers: ['local'],
            supportsCancel: !isTerminalStatus(job.getStatus()),
            supportsRestart: false,
            executionStartTime: this._standaloneExecutions.get(id)?.startTime ?? this._standaloneExecutionTimestamps.get(id)?.startTime ?? null,
            executionCompletionTime: normalizeCompletionTime(
                this._standaloneExecutions.get(id)?.completionTime
                ?? this._standaloneExecutionTimestamps.get(id)?.completionTime
                ?? null,
            ),
        };
    }

    async cancelJob(id: string): Promise<void> {
        const job = this._jobs.get(id);
        if (!job) {
            throw new Error(`Job '${id}' not found`);
        }
        if (isTerminalStatus(job.getStatus())) {
            throw new Error(`Job '${id}' is already in terminal state '${job.getStatus()}'`);
        }
        await job.cancel();
    }

    async restartJob(id: string): Promise<void> {
        const job = this._jobs.get(id);
        if (!job) {
            throw new Error(`Job '${id}' not found`);
        }
        const metadata = await this.getJobMetadata(id);
        if (metadata === null) {
            throw new Error(`Job '${id}' not found`);
        }
        if (!metadata.supportsRestart) {
            throw new Error('Job restart is not supported for standalone/light jobs.');
        }
        await job.restart();
    }

    /**
     * Gracefully drain and close the NATS connection.
     *
     * Drain ensures in-flight messages are delivered before the connection closes.
     * After shutdown, no further NATS operations should be performed.
     */
    async shutdown(): Promise<void> {
        if (this._closed) {
            return;
        }
        this._closed = true;
        await this.nc.drain();
        // N15 FIX: must await — kills embedded processes and waits for port release
        await this._manager?.shutdown();
    }

    /**
     * Poll `jetstreamManager()` with 200ms intervals until it succeeds or timeout.
     * Mirrors Hazelcast's pattern: fast polling (100-200ms) during cluster formation.
     */
    private async _initJetStream(timeoutMs: number): Promise<JetStreamManager> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try {
                const jsm = await jetstreamManager(this.nc, { timeout: 2000 });
                this._jsm = jsm;
                this._kvm = new Kvm(this.nc);
                this._emit(BlitzEvent.NATS_RECONNECTED, { reason: 'jetstream-ready' });
                return jsm;
            } catch {
                // JetStream not ready yet — Raft leader election in progress
                await new Promise<void>((r) => setTimeout(r, 200));
            }
        }
        throw new Error(
            `JetStream did not become operational within ${timeoutMs}ms. ` +
            'The NATS cluster may not have enough nodes for Raft quorum.',
        );
    }

    private _createStandaloneJob(_pipeline: Pipeline, config: ResolvedJobConfig): Promise<BlitzJob> {
        const jobId = crypto.randomUUID();
        const pipeline = _pipeline;

        let status = JobStatus.RUNNING;

        const sourceMetrics = new Map<string, number>();
        const operatorMetrics = new Map<string, { itemsIn: number; itemsOut: number }>();
        const sinkMetrics = new Map<string, number>();
        let stopRequested = false;
        let terminalized = false;

        const transitionTo = (nextStatus: JobStatus): void => {
            if (status === nextStatus) return;
            const previousStatus = status;
            status = nextStatus;
            if (nextStatus === JobStatus.COMPLETED || nextStatus === JobStatus.CANCELLED || nextStatus === JobStatus.FAILED) {
                terminalized = true;
            }
            job.notifyStatusChange(previousStatus, nextStatus);
        };

        const completeIfNeeded = (): boolean => {
            if (!terminalized && !stopRequested) {
                transitionTo(JobStatus.COMPLETED);
                return true;
            }
            return false;
        };

        const resources = this._buildStandaloneResources(pipeline, sourceMetrics, operatorMetrics, sinkMetrics);

        let execution: JobExecution | null = null;

        const coordinator: JobCoordinator = {
            getStatus: () => status,
            cancel: async () => {
                stopRequested = true;
                if (execution) {
                    await execution.stop();
                    this._standaloneExecutionTimestamps.set(jobId, {
                        startTime: execution.startTime,
                        completionTime: execution.completionTime >= 0 ? execution.completionTime : Date.now(),
                    });
                    this._standaloneExecutions.delete(jobId);
                }
                transitionTo(JobStatus.CANCELLED);
                this._emit(BlitzEvent.JOB_CANCELLED, { jobId, name: config.name });
            },
            suspend: async () => { throw new Error('Standalone jobs cannot be suspended'); },
            resume: async () => { throw new Error('Standalone jobs cannot be resumed'); },
            restart: async () => { throw new Error('Standalone jobs cannot be restarted'); },
            exportSnapshot: async () => { throw new Error('Standalone jobs do not support snapshots'); },
            getMetrics: async () => {
                if (execution) {
                    return this._collectStandaloneMetrics(jobId, execution);
                }
                return this._collectStandaloneMetricsFromSnapshots(
                    jobId,
                    this._buildStandaloneMetrics(pipeline, sourceMetrics, operatorMetrics, sinkMetrics, status),
                );
            },
        };

        const job = new BlitzJob(jobId, config.name, coordinator, Date.now());
        this._jobs.set(jobId, job);
        this._jobDescriptors.set(jobId, pipeline.toDescriptor());
        this._emit(BlitzEvent.JOB_STARTED, { jobId, name: config.name });

        execution = this._createStandaloneExecution(jobId, pipeline, config, resources);
        this._standaloneExecutions.set(jobId, execution);
        this._standaloneExecutionTimestamps.set(jobId, {
            startTime: execution.startTime,
            completionTime: null,
        });

        this._runStandalonePipeline(jobId, execution, completeIfNeeded, (err) => {
            if (!terminalized) {
                transitionTo(JobStatus.FAILED);
            }
            this._standaloneExecutionTimestamps.set(jobId, {
                startTime: execution.startTime,
                completionTime: execution.completionTime >= 0 ? execution.completionTime : Date.now(),
            });
            this._standaloneExecutions.delete(jobId);
            this._emit(BlitzEvent.JOB_FAILED, { jobId, name: config.name, error: err instanceof Error ? err.message : String(err) });
        });

        return Promise.resolve(job);
    }

    private _buildStandaloneResources(
        pipeline: Pipeline,
        sourceMetrics: Map<string, number>,
        operatorMetrics: Map<string, { itemsIn: number; itemsOut: number }>,
        sinkMetrics: Map<string, number>,
    ): {
        sources: Map<string, Source<unknown>>;
        sinks: Map<string, Sink<unknown>>;
        operatorFns: Map<string, OperatorFnEntry>;
    } {
        const sources = new Map<string, Source<unknown>>();
        const sinks = new Map<string, Sink<unknown>>();
        const operatorFns = new Map<string, OperatorFnEntry>();

        for (const vertex of pipeline.vertices) {
            if (vertex.type === 'source' && vertex.sourceRef) {
                const baseSource = vertex.sourceRef;
                sourceMetrics.set(vertex.name, 0);
                sources.set(vertex.name, {
                    name: baseSource.name,
                    codec: baseSource.codec,
                    messages: async function* () {
                        for await (const message of baseSource.messages()) {
                            sourceMetrics.set(vertex.name, (sourceMetrics.get(vertex.name) ?? 0) + 1);
                            yield message;
                        }
                    },
                });
            }

            if (vertex.type === 'sink' && vertex.sinkRef) {
                const baseSink = vertex.sinkRef;
                sinkMetrics.set(vertex.name, 0);
                sinks.set(vertex.name, {
                    name: baseSink.name,
                    write: async (value: unknown): Promise<void> => {
                        sinkMetrics.set(vertex.name, (sinkMetrics.get(vertex.name) ?? 0) + 1);
                        await baseSink.write(value as never);
                    },
                });
            }

            if (vertex.type === 'operator' && vertex.fn) {
                operatorMetrics.set(vertex.name, { itemsIn: 0, itemsOut: 0 });
                const mode = vertex.operatorMode ?? (vertex.name.startsWith('filter-') ? 'filter' : 'map');
                operatorFns.set(vertex.name, {
                    mode,
                    fn: async (value: unknown): Promise<unknown> => {
                        const current = operatorMetrics.get(vertex.name)!;
                        current.itemsIn++;
                        const result = await vertex.fn!(value);
                        if (mode === 'filter') {
                            if (result) {
                                current.itemsOut++;
                            }
                            return result;
                        }
                        current.itemsOut++;
                        return result;
                    },
                });
            }
        }

        return { sources, sinks, operatorFns };
    }

    private _createStandaloneExecution(
        jobId: string,
        pipeline: Pipeline,
        config: ResolvedJobConfig,
        resources: { sources: Map<string, Source<unknown>>; sinks: Map<string, Sink<unknown>>; operatorFns: Map<string, OperatorFnEntry> },
    ): JobExecution {
        return new JobExecution({
            jobId,
            jobName: config.name,
            executionId: jobId,
            plan: {
                jobId,
                pipeline: pipeline.toDescriptor(),
                memberIds: ['local'],
                edgeRouting: new Map(),
                fenceToken: 'standalone',
                masterMemberId: 'local',
                memberListVersion: 0,
            },
            memberId: 'local',
            sources: resources.sources,
            sinks: resources.sinks,
            operatorFns: resources.operatorFns,
            guarantee: config.processingGuarantee,
            maxProcessorAccumulatedRecords: config.maxProcessorAccumulatedRecords,
        });
    }

    private _runStandalonePipeline(
        jobId: string,
        execution: JobExecution,
        onComplete: () => boolean,
        onError: (error: unknown) => void,
    ): void {
        void (async () => {
            try {
                await execution.start();
                const results = await execution.whenComplete();
                const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
                this._standaloneExecutionTimestamps.set(jobId, {
                    startTime: execution.startTime,
                    completionTime: execution.completionTime >= 0 ? execution.completionTime : Date.now(),
                });
                this._standaloneExecutions.delete(jobId);
                if (failure) {
                    onError(failure.reason);
                    return;
                }
                 if (onComplete()) {
                     this._emit(BlitzEvent.JOB_COMPLETED, { jobId });
                 }
             } catch (error) {
                 this._standaloneExecutions.delete(jobId);
                 onError(error);
            }
        })();
    }

    private _collectStandaloneMetrics(jobId: string, execution: JobExecution): BlitzJobMetrics {
        return this._collectStandaloneMetricsFromSnapshots(
            jobId,
            execution.getMetrics(),
            execution.startTime,
            execution.completionTime,
        );
    }

    private _collectStandaloneMetricsFromSnapshots(
        jobId: string,
        localMetrics: VertexMetrics[],
        startTime = Date.now(),
        completionTime = -1,
    ): BlitzJobMetrics {
        return MetricsCollector.aggregate(
            new Map([[jobId, localMetrics]]),
            {
                snapshotCount: 0,
                lastSnapshotDurationMs: 0,
                lastSnapshotBytes: 0,
                lastSnapshotTimestamp: 0,
            },
            [{ startTime, completionTime }],
        );
    }

    private _buildStandaloneMetrics(
        pipeline: Pipeline,
        sourceMetrics: Map<string, number>,
        operatorMetrics: Map<string, { itemsIn: number; itemsOut: number }>,
        sinkMetrics: Map<string, number>,
        status: JobStatus,
    ): import('@zenystx/helios-core/job/metrics/BlitzJobMetrics').VertexMetrics[] {
        const descriptor = pipeline.toDescriptor();
        const vertexStatus = this._toVertexStatus(status);
        return pipeline.vertices.map((vertex) => {
            if (vertex.type === 'source') {
                return {
                    name: vertex.name,
                    type: 'source',
                    status: vertexStatus,
                    parallelism: descriptor.parallelism,
                    itemsIn: 0,
                    itemsOut: sourceMetrics.get(vertex.name) ?? 0,
                    queueSize: 0,
                    queueCapacity: 0,
                    latencyP50Ms: 0,
                    latencyP99Ms: 0,
                    latencyMaxMs: 0,
                    distributedItemsIn: 0,
                    distributedItemsOut: 0,
                    distributedBytesIn: 0,
                    distributedBytesOut: 0,
                    topObservedWm: -1,
                    coalescedWm: -1,
                    lastForwardedWm: -1,
                    lastForwardedWmLatency: -1,
                  };
            }

            if (vertex.type === 'sink') {
                return {
                    name: vertex.name,
                    type: 'sink',
                    status: vertexStatus,
                    parallelism: descriptor.parallelism,
                    itemsIn: sinkMetrics.get(vertex.name) ?? 0,
                    itemsOut: 0,
                    queueSize: 0,
                    queueCapacity: 0,
                    latencyP50Ms: 0,
                    latencyP99Ms: 0,
                    latencyMaxMs: 0,
                    distributedItemsIn: 0,
                    distributedItemsOut: 0,
                    distributedBytesIn: 0,
                    distributedBytesOut: 0,
                    topObservedWm: -1,
                    coalescedWm: -1,
                    lastForwardedWm: -1,
                    lastForwardedWmLatency: -1,
                };
            }

            const operator = operatorMetrics.get(vertex.name) ?? { itemsIn: 0, itemsOut: 0 };
            return {
                name: vertex.name,
                type: 'operator',
                status: vertexStatus,
                parallelism: descriptor.parallelism,
                itemsIn: operator.itemsIn,
                itemsOut: operator.itemsOut,
                queueSize: 0,
                queueCapacity: 0,
                latencyP50Ms: 0,
                latencyP99Ms: 0,
                latencyMaxMs: 0,
                distributedItemsIn: 0,
                distributedItemsOut: 0,
                distributedBytesIn: 0,
                distributedBytesOut: 0,
                topObservedWm: -1,
                coalescedWm: -1,
                lastForwardedWm: -1,
                lastForwardedWmLatency: -1,
            };
        });
    }

    private _emit(event: BlitzEvent, detail?: unknown): void {
        for (const listener of this._listeners) {
            try {
                listener(event, detail);
            } catch {
                // swallow listener errors — do not let them crash the service
            }
        }
    }

    private _subscribeToStatus(): void {
        // nc.status() returns an async iterable of StatusEvent objects.
        // We consume it in a detached async task so it doesn't block connect().
        (async () => {
            for await (const s of this.nc.status()) {
                if (s.type === 'reconnecting') {
                    this._emit(BlitzEvent.NATS_RECONNECTING, s);
                } else if (s.type === 'reconnect') {
                    this._emit(BlitzEvent.NATS_RECONNECTED, s);
                }
                // Other status types (disconnect, error, etc.) are not mapped
                // to BlitzEvents at Block 10.0 — pipeline-level events are
                // emitted by Pipeline.cancel() and individual stage operators.
            }
        })().catch(() => {
            // Status iterator closes when the connection closes — swallow.
        });
    }

    private _toVertexStatus(status: JobStatus): 'STARTING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' {
        switch (status) {
            case JobStatus.COMPLETED:
                return 'COMPLETED';
            case JobStatus.FAILED:
                return 'FAILED';
            case JobStatus.CANCELLED:
                return 'CANCELLED';
            case JobStatus.STARTING:
            case JobStatus.NOT_RUNNING:
            case JobStatus.RESTARTING:
                return 'STARTING';
            default:
                return 'RUNNING';
        }
    }
}

function normalizeCompletionTime(value: number | null): number | null {
    return value === null || value < 0 ? null : value;
}

/**
 * Translate ResolvedBlitzConfig → NatsServerNodeConfig[].
 * Internal helper for BlitzService.start().
 */
function buildNodeConfigs(config: ResolvedBlitzConfig): NatsServerNodeConfig[] {
    if (config.embedded) {
        const e = config.embedded;
        const binaryPath = NatsServerBinaryResolver.resolve(e.binaryPath);
        return [{
            binaryPath,
            port: e.port,
            clusterPort: 0,
            dataDir: e.dataDir,
            serverName: 'helios-blitz-embedded',
            clusterName: undefined,
            routes: [],
            extraArgs: e.extraArgs,
            startTimeoutMs: e.startTimeoutMs,
        }];
    }

    if (config.cluster) {
        const c = config.cluster;
        const binaryPath = NatsServerBinaryResolver.resolve(c.binaryPath);
        const nodes: NatsServerNodeConfig[] = [];

        // For cluster mode without explicit dataDir, use unique temp dirs per node
        // to avoid JetStream storage conflicts between nodes sharing the OS default.
        const baseTmpDir = c.dataDir ?? join(tmpdir(), `blitz-cluster-${Date.now()}`);

        for (let i = 0; i < c.nodes; i++) {
            const port = c.basePort + i;
            const clusterPort = c.baseClusterPort + i;
            const routes = Array.from({ length: c.nodes }, (_, j) => j)
                .filter(j => j !== i)
                .map(j => `nats://127.0.0.1:${c.baseClusterPort + j}`);

            nodes.push({
                binaryPath,
                port,
                clusterPort,
                dataDir: `${baseTmpDir}/node-${i}`,
                serverName: `${c.name}-node-${i}`,
                clusterName: c.name,
                routes,
                extraArgs: [],
                startTimeoutMs: c.startTimeoutMs,
            });
        }

        return nodes;
    }

    throw new Error('buildNodeConfigs: config must have embedded or cluster set');
}
