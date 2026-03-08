export enum EdgeType {
  LOCAL = 'LOCAL',
  LOCAL_PARTITIONED = 'LOCAL_PARTITIONED',
  DISTRIBUTED_UNICAST = 'DISTRIBUTED_UNICAST',
  DISTRIBUTED_PARTITIONED = 'DISTRIBUTED_PARTITIONED',
  DISTRIBUTED_BROADCAST = 'DISTRIBUTED_BROADCAST',
  ALL_TO_ONE = 'ALL_TO_ONE',
}

export interface SourceDescriptor {
  readonly type: 'nats-subject' | 'nats-stream' | 'helios-map' | 'helios-topic' | 'file' | 'http-webhook';
  readonly config: Record<string, unknown>;
}

export interface SinkDescriptor {
  readonly type: 'nats-subject' | 'nats-stream' | 'helios-map' | 'helios-topic' | 'file' | 'log';
  readonly config: Record<string, unknown>;
}

export interface VertexDescriptor {
  readonly name: string;
  readonly type: 'source' | 'operator' | 'sink';
  readonly fnSource: string | null;
  readonly sourceConfig: SourceDescriptor | null;
  readonly sinkConfig: SinkDescriptor | null;
}

export interface EdgeDescriptor {
  readonly from: string;
  readonly to: string;
  readonly edgeType: EdgeType;
  readonly subject: string;
  readonly keyFnSource: string | null;
}

export interface PipelineDescriptor {
  readonly name: string;
  readonly vertices: VertexDescriptor[];
  readonly edges: EdgeDescriptor[];
  readonly parallelism: number;
}
