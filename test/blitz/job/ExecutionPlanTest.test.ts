import { describe, expect, it } from 'bun:test';
import { computeExecutionPlan } from '@zenystx/helios-core/job/ExecutionPlan';
import { EdgeType } from '@zenystx/helios-core/job/PipelineDescriptor';
import type { PipelineDescriptor, VertexDescriptor, EdgeDescriptor } from '@zenystx/helios-core/job/PipelineDescriptor';

// ─── Helpers ────────────────────────────────────────────────────────────────

function vertex(name: string, type: VertexDescriptor['type']): VertexDescriptor {
  return { name, type, fnSource: null, sourceConfig: null, sinkConfig: null };
}

function edge(from: string, to: string, edgeType: EdgeType = EdgeType.LOCAL): EdgeDescriptor {
  return { from, to, edgeType, subject: '', keyFnSource: null };
}

function pipeline(
  vertices: VertexDescriptor[],
  edges: EdgeDescriptor[],
  name = 'test-pipeline',
): PipelineDescriptor {
  return { name, vertices, edges, parallelism: 1 };
}

const authority = {
  fenceToken: 'fence-1',
  masterMemberId: 'master-1',
  memberListVersion: 1,
};

describe('ExecutionPlan — computeExecutionPlan', () => {
  it('computes plan for a linear local-only DAG', () => {
    const p = pipeline(
      [vertex('source', 'source'), vertex('map', 'operator'), vertex('sink', 'sink')],
      [edge('source', 'map', EdgeType.LOCAL), edge('map', 'sink', EdgeType.LOCAL)],
    );
    const plan = computeExecutionPlan('job-1', p, ['member-a'], authority);

    expect(plan.jobId).toBe('job-1');
    expect(plan.pipeline).toBe(p);
    expect(plan.memberIds).toEqual(['member-a']);
    expect(plan.fenceToken).toBe('fence-1');
    expect(plan.masterMemberId).toBe('master-1');
    expect(plan.memberListVersion).toBe(1);
    // Local edges produce no routing entries
    expect(plan.edgeRouting.size).toBe(0);
  });

  it('computes unicast routing for distributed edges', () => {
    const p = pipeline(
      [vertex('source', 'source'), vertex('sink', 'sink')],
      [edge('source', 'sink', EdgeType.DISTRIBUTED_UNICAST)],
    );
    const members = ['member-a', 'member-b'];
    const plan = computeExecutionPlan('job-2', p, members, authority);

    expect(plan.edgeRouting.size).toBe(1);
    const entry = plan.edgeRouting.get('source→sink')!;
    expect(entry).toBeDefined();
    expect(entry.edgeType).toBe(EdgeType.DISTRIBUTED_UNICAST);
    expect(Object.keys(entry.memberSubjects).length).toBe(members.length);
    expect(entry.broadcastSubject).toBeNull();
  });

  it('computes partitioned routing with partition count', () => {
    const p = pipeline(
      [vertex('source', 'source'), vertex('agg', 'operator')],
      [edge('source', 'agg', EdgeType.DISTRIBUTED_PARTITIONED)],
    );
    const members = ['m1', 'm2', 'm3'];
    const plan = computeExecutionPlan('job-3', p, members, authority);

    const entry = plan.edgeRouting.get('source→agg')!;
    expect(entry).toBeDefined();
    expect(entry.edgeType).toBe(EdgeType.DISTRIBUTED_PARTITIONED);
    expect(entry.partitionCount).toBeGreaterThan(0);
    expect(entry.subjectPattern).toContain('job-3');
  });

  it('computes broadcast routing with broadcast subject', () => {
    const p = pipeline(
      [vertex('source', 'source'), vertex('sink', 'sink')],
      [edge('source', 'sink', EdgeType.DISTRIBUTED_BROADCAST)],
    );
    const plan = computeExecutionPlan('job-4', p, ['m1', 'm2'], authority);

    const entry = plan.edgeRouting.get('source→sink')!;
    expect(entry).toBeDefined();
    expect(entry.edgeType).toBe(EdgeType.DISTRIBUTED_BROADCAST);
    expect(entry.broadcastSubject).toBeTruthy();
  });

  it('computes ALL_TO_ONE routing targeting first member', () => {
    const p = pipeline(
      [vertex('source', 'source'), vertex('sink', 'sink')],
      [edge('source', 'sink', EdgeType.ALL_TO_ONE)],
    );
    const plan = computeExecutionPlan('job-5', p, ['m1', 'm2', 'm3'], authority);

    const entry = plan.edgeRouting.get('source→sink')!;
    expect(entry).toBeDefined();
    expect(entry.edgeType).toBe(EdgeType.ALL_TO_ONE);
    expect(Object.keys(entry.memberSubjects).length).toBe(1);
  });

  it('handles mixed local and distributed edges', () => {
    const p = pipeline(
      [
        vertex('source', 'source'),
        vertex('map', 'operator'),
        vertex('shuffle', 'operator'),
        vertex('sink', 'sink'),
      ],
      [
        edge('source', 'map', EdgeType.LOCAL),
        edge('map', 'shuffle', EdgeType.DISTRIBUTED_PARTITIONED),
        edge('shuffle', 'sink', EdgeType.LOCAL),
      ],
    );
    const plan = computeExecutionPlan('job-6', p, ['m1', 'm2'], authority);

    // Only the distributed edge should appear in routing
    expect(plan.edgeRouting.size).toBe(1);
    expect(plan.edgeRouting.has('map→shuffle')).toBe(true);
  });
});
