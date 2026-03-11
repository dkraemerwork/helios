/**
 * Serializes and deserializes job DAG topology for persistence and API responses.
 *
 * Provides JSON serialization of vertex/edge data and computes a layered DAG
 * layout using topological ordering. Nodes are positioned in horizontal layers
 * based on their longest-path depth from sources, with vertical spacing within
 * each layer.
 */

import { Injectable } from '@nestjs/common';

export interface DagNode {
  id: string;
  name: string;
  status: string;
  x: number;
  y: number;
  parallelism: number;
  processedItems: number;
  emittedItems: number;
}

export interface DagEdge {
  source: string;
  target: string;
}

const LAYER_HORIZONTAL_SPACING = 220;
const NODE_VERTICAL_SPACING = 100;
const LAYOUT_PADDING_X = 40;
const LAYOUT_PADDING_Y = 40;

@Injectable()
export class TopologySerializer {
  /** JSON-serializes vertex data for persistence. */
  serializeVertices(vertices: unknown): string {
    return JSON.stringify(vertices ?? []);
  }

  /** JSON-serializes edge data for persistence. */
  serializeEdges(edges: unknown): string {
    return JSON.stringify(edges ?? []);
  }

  /** Deserializes vertex JSON back into an array. */
  deserializeVertices(json: string): unknown[] {
    if (!json || json === '[]') return [];
    try {
      const parsed: unknown = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Deserializes edge JSON back into an array. */
  deserializeEdges(json: string): unknown[] {
    if (!json || json === '[]') return [];
    try {
      const parsed: unknown = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Computes a layered DAG layout from vertex and edge arrays.
   *
   * Uses the longest-path algorithm to assign each vertex to a layer, then
   * spaces nodes vertically within each layer and horizontally across layers.
   * This produces a clean left-to-right DAG visualization layout.
   */
  buildDagLayout(vertices: unknown[], edges: unknown[]): { nodes: DagNode[]; edges: DagEdge[] } {
    if (vertices.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Extract vertex info with safe property access
    const vertexMap = new Map<string, { name: string; status: string; parallelism: number; processedItems: number; emittedItems: number }>();
    for (const v of vertices) {
      const vertex = v as Record<string, unknown>;
      const id = String(vertex['id'] ?? vertex['name'] ?? '');
      if (!id) continue;

      vertexMap.set(id, {
        name: String(vertex['name'] ?? id),
        status: String(vertex['status'] ?? 'UNKNOWN'),
        parallelism: toSafeNumber(vertex['parallelism'], 1),
        processedItems: toSafeNumber(vertex['processedItems'] ?? vertex['receivedCount'], 0),
        emittedItems: toSafeNumber(vertex['emittedItems'] ?? vertex['emittedCount'], 0),
      });
    }

    // Extract edges with safe property access
    const dagEdges: DagEdge[] = [];
    const adjacency = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const id of vertexMap.keys()) {
      adjacency.set(id, []);
      inDegree.set(id, 0);
    }

    for (const e of edges) {
      const edge = e as Record<string, unknown>;
      const source = String(edge['source'] ?? edge['from'] ?? '');
      const target = String(edge['target'] ?? edge['to'] ?? edge['destName'] ?? '');

      if (!source || !target) continue;
      if (!vertexMap.has(source) || !vertexMap.has(target)) continue;

      dagEdges.push({ source, target });
      adjacency.get(source)!.push(target);
      inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
    }

    // Longest-path layering via topological sort (Kahn's algorithm with depth tracking)
    const layerAssignment = new Map<string, number>();
    const queue: string[] = [];

    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
        layerAssignment.set(id, 0);
      }
    }

    // Process nodes in topological order, assigning each to the layer
    // one past the maximum layer of its predecessors (longest-path depth).
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++]!;
      const currentLayer = layerAssignment.get(current) ?? 0;

      for (const neighbor of adjacency.get(current) ?? []) {
        const existingLayer = layerAssignment.get(neighbor) ?? 0;
        const candidateLayer = currentLayer + 1;

        if (candidateLayer > existingLayer) {
          layerAssignment.set(neighbor, candidateLayer);
        }

        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);

        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    // Handle any disconnected nodes (cycles or isolated) — assign to layer 0
    for (const id of vertexMap.keys()) {
      if (!layerAssignment.has(id)) {
        layerAssignment.set(id, 0);
      }
    }

    // Group nodes by layer
    const layers = new Map<number, string[]>();
    for (const [id, layer] of layerAssignment) {
      if (!layers.has(layer)) {
        layers.set(layer, []);
      }
      layers.get(layer)!.push(id);
    }

    // Compute positions: layers spread horizontally, nodes within each layer vertically centered
    const nodes: DagNode[] = [];

    for (const [layer, ids] of layers) {
      const x = LAYOUT_PADDING_X + layer * LAYER_HORIZONTAL_SPACING;
      const totalHeight = (ids.length - 1) * NODE_VERTICAL_SPACING;
      const startY = LAYOUT_PADDING_Y + (totalHeight > 0 ? 0 : 0);

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        const info = vertexMap.get(id)!;
        const y = startY + i * NODE_VERTICAL_SPACING - totalHeight / 2 + LAYOUT_PADDING_Y;

        nodes.push({
          id,
          name: info.name,
          status: info.status,
          x,
          y,
          parallelism: info.parallelism,
          processedItems: info.processedItems,
          emittedItems: info.emittedItems,
        });
      }
    }

    return { nodes, edges: dagEdges };
  }
}

export interface JobTopologyVertex {
  id: string;
  name: string;
  type: string;
  status?: string;
  parallelism: number | null;
  processedItems: number | null;
  emittedItems: number | null;
}

function toSafeNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isNaN(n) ? fallback : n;
}

export function normalizePersistedVertices(
  vertices: unknown,
  metrics: Record<string, unknown>,
): JobTopologyVertex[] {
  const topology = Array.isArray(vertices) ? vertices : [];
  const metricVertices = asRecord(metrics['vertices']);

  return topology.map((entry, index) => {
    const vertex = asRecord(entry);
    const id = asString(vertex['id']) || asString(vertex['name']) || `vertex-${index}`;
    const metricVertex = asRecord(metricVertices[id] ?? metricVertices[asString(vertex['name'])]);
    const status = asString(metricVertex['status']) || asString(vertex['status']);

    return {
      id,
      name: asString(vertex['name']) || id,
      type: asString(vertex['type']) || 'operator',
      ...(status ? { status } : {}),
      parallelism: toNullableNumber(metricVertex['parallelism'] ?? vertex['parallelism']),
      processedItems: toNullableNumber(metricVertex['itemsIn'] ?? metricVertex['processedItems'] ?? metricVertex['receivedCount'] ?? vertex['processedItems']),
      emittedItems: toNullableNumber(metricVertex['itemsOut'] ?? metricVertex['emittedItems'] ?? metricVertex['emittedCount'] ?? vertex['emittedItems']),
    };
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
