/**
 * MetricTags — tag name constants for metric descriptors.
 *
 * Metric descriptors are formed from a comma-separated list of
 * `tag_name=tag_value` pairs. These constants are the possible tag names
 * used in Helios, mirroring the Hazelcast Jet MetricTags class.
 *
 * @see https://docs.hazelcast.com/hazelcast/latest/jet/metrics
 */
export const MetricTags = {
  /**
   * Source system or module. Value is always `"helios"`.
   */
  MODULE: 'module',

  /**
   * Unique ID of the cluster member sourcing the metric.
   */
  MEMBER: 'member',

  /**
   * Network address of the cluster member sourcing the metric.
   */
  ADDRESS: 'address',

  /**
   * Unique ID of the job sourcing the metric.
   */
  JOB: 'job',

  /**
   * Job name, or job ID when no name is specified.
   */
  JOB_NAME: 'jobName',

  /**
   * Unique ID of a particular execution of a job.
   */
  EXECUTION: 'exec',

  /**
   * DAG vertex name of the metric source.
   */
  VERTEX: 'vertex',

  /**
   * Global index of the processor sourcing the metric.
   */
  PROCESSOR: 'proc',

  /**
   * Class/type name of the processor sourcing the metric.
   */
  PROC_TYPE: 'procType',

  /**
   * Boolean flag: `"true"` if the processor is a DAG source vertex.
   */
  SOURCE: 'source',

  /**
   * Boolean flag: `"true"` if the processor is a DAG sink vertex.
   */
  SINK: 'sink',

  /**
   * Index of the vertex input or output edge sourcing the metric.
   */
  ORDINAL: 'ordinal',

  /**
   * Boolean flag: `"true"` if the metric is user-defined.
   */
  USER: 'user',

  /**
   * Unit of metric value (e.g. `"count"`, `"bytes"`, `"ms"`).
   */
  UNIT: 'unit',
} as const;

export type MetricTagName = typeof MetricTags[keyof typeof MetricTags];

/** Context used to build a tag map for a specific vertex. */
export interface VertexTagContext {
  readonly jobId: string;
  readonly jobName: string;
  readonly executionId: string;
  readonly vertexName: string;
  readonly procType: string;
  readonly isSource: boolean;
  readonly isSink: boolean;
  readonly processorIndex?: number;
}

/**
 * Build a tag map from a vertex execution context.
 *
 * @param ctx Vertex identity context
 * @returns A ReadonlyMap<string, string> of tag name → tag value
 */
export function tagsForVertex(ctx: VertexTagContext): ReadonlyMap<string, string> {
  const tags = new Map<string, string>([
    [MetricTags.MODULE, 'helios'],
    [MetricTags.JOB, ctx.jobId],
    [MetricTags.JOB_NAME, ctx.jobName],
    [MetricTags.EXECUTION, ctx.executionId],
    [MetricTags.VERTEX, ctx.vertexName],
    [MetricTags.PROC_TYPE, ctx.procType],
    [MetricTags.SOURCE, String(ctx.isSource)],
    [MetricTags.SINK, String(ctx.isSink)],
  ]);

  if (ctx.processorIndex !== undefined) {
    tags.set(MetricTags.PROCESSOR, String(ctx.processorIndex));
  }

  return tags;
}
