/**
 * @zenystx/blitz — NATS-backed stream & batch processing engine.
 *
 * Entry point exports for the public API.
 * NOTE: NestJS integration is exported from '@zenystx/blitz/nestjs' (NOT from this barrel).
 */

export { BlitzService } from './BlitzService.ts';
export type { BlitzEventListener } from './BlitzService.ts';
export type { BlitzConfig, ResolvedBlitzConfig, EmbeddedNatsConfig, NatsClusterConfig, ResolvedEmbeddedNatsConfig, ResolvedNatsClusterConfig } from './BlitzConfig.ts';
export { resolveBlitzConfig } from './BlitzConfig.ts';
export { BlitzEvent } from './BlitzEvent.ts';
export { BlitzError } from './errors/BlitzError.ts';
export { NakError } from './errors/NakError.ts';
export { DeadLetterError } from './errors/DeadLetterError.ts';
export { PipelineError } from './errors/PipelineError.ts';
// Block 10.1
export { Pipeline, GeneralStage } from './Pipeline.ts';
export { Vertex } from './Vertex.ts';
export type { VertexType } from './Vertex.ts';
export { Edge } from './Edge.ts';
export { Stage } from './Stage.ts';
export type { StageContext } from './StageContext.ts';
export type { Source, SourceMessage } from './source/Source.ts';
export type { Sink } from './sink/Sink.ts';
// Block 10.2 — Codecs
export type { BlitzCodec } from './codec/BlitzCodec.ts';
export { JsonCodec, StringCodec, BytesCodec } from './codec/BlitzCodec.ts';
// Block 10.2 — Sources
export { NatsSource } from './source/NatsSource.ts';
export { HeliosMapSource } from './source/HeliosMapSource.ts';
export type { MapEntry } from './source/HeliosMapSource.ts';
export { HeliosTopicSource } from './source/HeliosTopicSource.ts';
export { FileSource } from './source/FileSource.ts';
export { HttpWebhookSource } from './source/HttpWebhookSource.ts';
// Block 10.2 — Sinks
export { NatsSink } from './sink/NatsSink.ts';
export { HeliosMapSink } from './sink/HeliosMapSink.ts';
export { HeliosTopicSink } from './sink/HeliosTopicSink.ts';
export { FileSink } from './sink/FileSink.ts';
export { LogSink } from './sink/LogSink.ts';
// Block 10.3 — Stream operators
export { MapOperator } from './operator/MapOperator.ts';
export { FilterOperator } from './operator/FilterOperator.ts';
export { FlatMapOperator } from './operator/FlatMapOperator.ts';
export { MergeOperator } from './operator/MergeOperator.ts';
export { BranchOperator } from './operator/BranchOperator.ts';
export { PeekOperator } from './operator/PeekOperator.ts';
// Block 10.4 — Windowing engine
export type { WindowKey, WindowPolicy } from './window/WindowPolicy.ts';
export { TumblingWindowPolicy } from './window/TumblingWindowPolicy.ts';
export type { TumblingWindowOptions } from './window/TumblingWindowPolicy.ts';
export { SlidingWindowPolicy } from './window/SlidingWindowPolicy.ts';
export type { SlidingWindowOptions } from './window/SlidingWindowPolicy.ts';
export { SessionWindowPolicy } from './window/SessionWindowPolicy.ts';
export type { SessionWindowOptions } from './window/SessionWindowPolicy.ts';
export type { WindowState } from './window/WindowState.ts';
export { InMemoryWindowState, NatsKvWindowState } from './window/WindowState.ts';
export { WindowOperator } from './window/WindowOperator.ts';
export type { WindowOperatorOptions } from './window/WindowOperator.ts';
// Block 10.5 — Stateful aggregations
export type { Aggregator, GroupedAggregator } from './aggregate/Aggregator.ts';
export { CountAggregator } from './aggregate/CountAggregator.ts';
export { SumAggregator } from './aggregate/SumAggregator.ts';
export { MinAggregator } from './aggregate/MinAggregator.ts';
export { MaxAggregator } from './aggregate/MaxAggregator.ts';
export { AvgAggregator } from './aggregate/AvgAggregator.ts';
export type { AvgAcc } from './aggregate/AvgAggregator.ts';
export { DistinctAggregator } from './aggregate/DistinctAggregator.ts';
export { AggregatingOperator, RunningAggregateOperator } from './aggregate/AggregatingOperator.ts';
export { hashKey } from './aggregate/hashKey.ts';
// Block 10.6 — Stream joins
export { HashJoinOperator } from './join/HashJoinOperator.ts';
export { WindowedJoinOperator } from './join/WindowedJoinOperator.ts';
export type { JoinEvent, LeftEvent, RightEvent, WindowedJoinOptions } from './join/WindowedJoinOperator.ts';
// Block 10.7 — Fault tolerance
export { AckPolicy } from './fault/AckPolicy.ts';
export { RetryPolicy } from './fault/RetryPolicy.ts';
export type { BackoffStrategy, ExponentialOptions } from './fault/RetryPolicy.ts';
export { DeadLetterSink } from './fault/DeadLetterSink.ts';
export type { DLPublisher, DeadLetterMessage } from './fault/DeadLetterSink.ts';
export { CheckpointManager } from './fault/CheckpointManager.ts';
export type { CheckpointStore, CheckpointData, CheckpointManagerOptions } from './fault/CheckpointManager.ts';
export { FaultHandler } from './fault/FaultHandler.ts';
export type { FaultMessage, FaultHandlerOptions } from './fault/FaultHandler.ts';
// Block 10.8 — Batch processing mode
export type { BatchResult } from './batch/BatchResult.ts';
export { EndOfStreamDetector } from './batch/EndOfStreamDetector.ts';
export type { EndOfStreamDetectorOptions } from './batch/EndOfStreamDetector.ts';
export { BatchPipeline, BatchGeneralStage } from './batch/BatchPipeline.ts';
