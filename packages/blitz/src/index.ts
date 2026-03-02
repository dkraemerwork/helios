/**
 * @helios/blitz — NATS-backed stream & batch processing engine.
 *
 * Entry point exports for the public API.
 * NOTE: NestJS integration is exported from '@helios/blitz/nestjs' (NOT from this barrel).
 */

export { BlitzService } from './BlitzService.ts';
export type { BlitzEventListener } from './BlitzService.ts';
export type { BlitzConfig, ResolvedBlitzConfig } from './BlitzConfig.ts';
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
