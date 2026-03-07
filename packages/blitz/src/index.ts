/**
 * @zenystx/helios-blitz — NATS-backed stream & batch processing engine.
 *
 * Entry point exports for the public API.
 * NOTE: NestJS integration is exported from '@zenystx/helios-blitz/nestjs' (NOT from this barrel).
 */

export { resolveBlitzConfig } from './BlitzConfig.js';
export type { BlitzConfig, EmbeddedNatsConfig, NatsClusterConfig, ResolvedBlitzConfig, ResolvedEmbeddedNatsConfig, ResolvedNatsClusterConfig } from './BlitzConfig.js';
export { BlitzEvent } from './BlitzEvent.js';
export { BlitzService } from './BlitzService.js';
export type { BlitzEventListener } from './BlitzService.js';
export { BlitzError } from './errors/BlitzError.js';
export { DeadLetterError } from './errors/DeadLetterError.js';
export { NakError } from './errors/NakError.js';
export { PipelineError } from './errors/PipelineError.js';
// Block 10.1
export { Edge } from './Edge.js';
export { GeneralStage, Pipeline } from './Pipeline.js';
export type { Sink } from './sink/Sink.js';
export type { Source, SourceMessage } from './source/Source.js';
export { Stage } from './Stage.js';
export type { StageContext } from './StageContext.js';
export { Vertex } from './Vertex.js';
export type { VertexType } from './Vertex.js';
// Block 10.2 — Codecs
export { BytesCodec, JsonCodec, StringCodec } from './codec/BlitzCodec.js';
export type { BlitzCodec } from './codec/BlitzCodec.js';
// Block 10.2 — Sources
export { FileSource } from './source/FileSource.js';
export { HeliosMapSource } from './source/HeliosMapSource.js';
export type { MapEntry } from './source/HeliosMapSource.js';
export { HeliosTopicSource } from './source/HeliosTopicSource.js';
export { HttpWebhookSource } from './source/HttpWebhookSource.js';
export { NatsSource } from './source/NatsSource.js';
// Block 10.2 — Sinks
export { FileSink } from './sink/FileSink.js';
export { HeliosMapSink } from './sink/HeliosMapSink.js';
export { HeliosTopicSink } from './sink/HeliosTopicSink.js';
export { LogSink } from './sink/LogSink.js';
export { NatsSink } from './sink/NatsSink.js';
// Block 10.3 — Stream operators
export { BranchOperator } from './operator/BranchOperator.js';
export { FilterOperator } from './operator/FilterOperator.js';
export { FlatMapOperator } from './operator/FlatMapOperator.js';
export { MapOperator } from './operator/MapOperator.js';
export { MergeOperator } from './operator/MergeOperator.js';
export { PeekOperator } from './operator/PeekOperator.js';
// Block 10.4 — Windowing engine
export { SessionWindowPolicy } from './window/SessionWindowPolicy.js';
export type { SessionWindowOptions } from './window/SessionWindowPolicy.js';
export { SlidingWindowPolicy } from './window/SlidingWindowPolicy.js';
export type { SlidingWindowOptions } from './window/SlidingWindowPolicy.js';
export { TumblingWindowPolicy } from './window/TumblingWindowPolicy.js';
export type { TumblingWindowOptions } from './window/TumblingWindowPolicy.js';
export { WindowOperator } from './window/WindowOperator.js';
export type { WindowOperatorOptions } from './window/WindowOperator.js';
export type { WindowKey, WindowPolicy } from './window/WindowPolicy.js';
export { InMemoryWindowState, NatsKvWindowState } from './window/WindowState.js';
export type { WindowState } from './window/WindowState.js';
// Block 10.5 — Stateful aggregations
export { AggregatingOperator, RunningAggregateOperator } from './aggregate/AggregatingOperator.js';
export type { Aggregator, GroupedAggregator } from './aggregate/Aggregator.js';
export { AvgAggregator } from './aggregate/AvgAggregator.js';
export type { AvgAcc } from './aggregate/AvgAggregator.js';
export { CountAggregator } from './aggregate/CountAggregator.js';
export { DistinctAggregator } from './aggregate/DistinctAggregator.js';
export { hashKey } from './aggregate/hashKey.js';
export { MaxAggregator } from './aggregate/MaxAggregator.js';
export { MinAggregator } from './aggregate/MinAggregator.js';
export { SumAggregator } from './aggregate/SumAggregator.js';
// Block 10.6 — Stream joins
export { HashJoinOperator } from './join/HashJoinOperator.js';
export { WindowedJoinOperator } from './join/WindowedJoinOperator.js';
export type { JoinEvent, LeftEvent, RightEvent, WindowedJoinOptions } from './join/WindowedJoinOperator.js';
// Block 10.7 — Fault tolerance
export { AckPolicy } from './fault/AckPolicy.js';
export { CheckpointManager } from './fault/CheckpointManager.js';
export type { CheckpointData, CheckpointManagerOptions, CheckpointStore } from './fault/CheckpointManager.js';
export { DeadLetterSink } from './fault/DeadLetterSink.js';
export type { DLPublisher, DeadLetterMessage } from './fault/DeadLetterSink.js';
export { FaultHandler } from './fault/FaultHandler.js';
export type { FaultHandlerOptions, FaultMessage } from './fault/FaultHandler.js';
export { RetryPolicy } from './fault/RetryPolicy.js';
export type { BackoffStrategy, ExponentialOptions } from './fault/RetryPolicy.js';
// Block 10.8 — Batch processing mode
export { BatchGeneralStage, BatchPipeline } from './batch/BatchPipeline.js';
export type { BatchResult } from './batch/BatchResult.js';
export { EndOfStreamDetector } from './batch/EndOfStreamDetector.js';
export type { EndOfStreamDetectorOptions } from './batch/EndOfStreamDetector.js';
// Block 18.1 — Cluster node primitive
export { DEFAULT_REPLICAS, clusterNode, normalizeRoutes, resolveClusterNodeConfig, toNodeConfig, validateClusterNodeConfig } from './server/ClusterNodeConfig.js';
export type { ClusterNodeNatsConfig, ResolvedClusterNodeNatsConfig } from './server/ClusterNodeConfig.js';
