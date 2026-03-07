/**
 * @zenystx/helios-blitz — NATS-backed stream & batch processing engine.
 *
 * Entry point exports for the public API.
 * NOTE: NestJS integration is exported from '@zenystx/helios-blitz/nestjs' (NOT from this barrel).
 */

export { BlitzService } from './BlitzService.js';
export type { BlitzEventListener } from './BlitzService.js';
export type { BlitzConfig, ResolvedBlitzConfig, EmbeddedNatsConfig, NatsClusterConfig, ResolvedEmbeddedNatsConfig, ResolvedNatsClusterConfig } from './BlitzConfig.js';
export { resolveBlitzConfig } from './BlitzConfig.js';
export { BlitzEvent } from './BlitzEvent.js';
export { BlitzError } from './errors/BlitzError.js';
export { NakError } from './errors/NakError.js';
export { DeadLetterError } from './errors/DeadLetterError.js';
export { PipelineError } from './errors/PipelineError.js';
// Block 10.1
export { Pipeline, GeneralStage } from './Pipeline.js';
export { Vertex } from './Vertex.js';
export type { VertexType } from './Vertex.js';
export { Edge } from './Edge.js';
export { Stage } from './Stage.js';
export type { StageContext } from './StageContext.js';
export type { Source, SourceMessage } from './source/Source.js';
export type { Sink } from './sink/Sink.js';
// Block 10.2 — Codecs
export type { BlitzCodec } from './codec/BlitzCodec.js';
export { JsonCodec, StringCodec, BytesCodec } from './codec/BlitzCodec.js';
// Block 10.2 — Sources
export { NatsSource } from './source/NatsSource.js';
export { HeliosMapSource } from './source/HeliosMapSource.js';
export type { MapEntry } from './source/HeliosMapSource.js';
export { HeliosTopicSource } from './source/HeliosTopicSource.js';
export { FileSource } from './source/FileSource.js';
export { HttpWebhookSource } from './source/HttpWebhookSource.js';
// Block 10.2 — Sinks
export { NatsSink } from './sink/NatsSink.js';
export { HeliosMapSink } from './sink/HeliosMapSink.js';
export { HeliosTopicSink } from './sink/HeliosTopicSink.js';
export { FileSink } from './sink/FileSink.js';
export { LogSink } from './sink/LogSink.js';
// Block 10.3 — Stream operators
export { MapOperator } from './operator/MapOperator.js';
export { FilterOperator } from './operator/FilterOperator.js';
export { FlatMapOperator } from './operator/FlatMapOperator.js';
export { MergeOperator } from './operator/MergeOperator.js';
export { BranchOperator } from './operator/BranchOperator.js';
export { PeekOperator } from './operator/PeekOperator.js';
// Block 10.4 — Windowing engine
export type { WindowKey, WindowPolicy } from './window/WindowPolicy.js';
export { TumblingWindowPolicy } from './window/TumblingWindowPolicy.js';
export type { TumblingWindowOptions } from './window/TumblingWindowPolicy.js';
export { SlidingWindowPolicy } from './window/SlidingWindowPolicy.js';
export type { SlidingWindowOptions } from './window/SlidingWindowPolicy.js';
export { SessionWindowPolicy } from './window/SessionWindowPolicy.js';
export type { SessionWindowOptions } from './window/SessionWindowPolicy.js';
export type { WindowState } from './window/WindowState.js';
export { InMemoryWindowState, NatsKvWindowState } from './window/WindowState.js';
export { WindowOperator } from './window/WindowOperator.js';
export type { WindowOperatorOptions } from './window/WindowOperator.js';
// Block 10.5 — Stateful aggregations
export type { Aggregator, GroupedAggregator } from './aggregate/Aggregator.js';
export { CountAggregator } from './aggregate/CountAggregator.js';
export { SumAggregator } from './aggregate/SumAggregator.js';
export { MinAggregator } from './aggregate/MinAggregator.js';
export { MaxAggregator } from './aggregate/MaxAggregator.js';
export { AvgAggregator } from './aggregate/AvgAggregator.js';
export type { AvgAcc } from './aggregate/AvgAggregator.js';
export { DistinctAggregator } from './aggregate/DistinctAggregator.js';
export { AggregatingOperator, RunningAggregateOperator } from './aggregate/AggregatingOperator.js';
export { hashKey } from './aggregate/hashKey.js';
// Block 10.6 — Stream joins
export { HashJoinOperator } from './join/HashJoinOperator.js';
export { WindowedJoinOperator } from './join/WindowedJoinOperator.js';
export type { JoinEvent, LeftEvent, RightEvent, WindowedJoinOptions } from './join/WindowedJoinOperator.js';
// Block 10.7 — Fault tolerance
export { AckPolicy } from './fault/AckPolicy.js';
export { RetryPolicy } from './fault/RetryPolicy.js';
export type { BackoffStrategy, ExponentialOptions } from './fault/RetryPolicy.js';
export { DeadLetterSink } from './fault/DeadLetterSink.js';
export type { DLPublisher, DeadLetterMessage } from './fault/DeadLetterSink.js';
export { CheckpointManager } from './fault/CheckpointManager.js';
export type { CheckpointStore, CheckpointData, CheckpointManagerOptions } from './fault/CheckpointManager.js';
export { FaultHandler } from './fault/FaultHandler.js';
export type { FaultMessage, FaultHandlerOptions } from './fault/FaultHandler.js';
// Block 10.8 — Batch processing mode
export type { BatchResult } from './batch/BatchResult.js';
export { EndOfStreamDetector } from './batch/EndOfStreamDetector.js';
export type { EndOfStreamDetectorOptions } from './batch/EndOfStreamDetector.js';
export { BatchPipeline, BatchGeneralStage } from './batch/BatchPipeline.js';
// Block 18.1 — Cluster node primitive
export type { ClusterNodeNatsConfig, ResolvedClusterNodeNatsConfig } from './server/ClusterNodeConfig.js';
export { clusterNode, resolveClusterNodeConfig, normalizeRoutes, validateClusterNodeConfig, toNodeConfig, DEFAULT_REPLICAS } from './server/ClusterNodeConfig.js';
