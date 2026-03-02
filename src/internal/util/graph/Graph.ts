/**
 * A basic implementation for simple & undirected graphs.
 * Port of com.hazelcast.internal.util.graph.Graph.
 */
export class Graph<V> {
  private readonly adjacencyMap = new Map<V, Set<V>>();

  add(v: V): void {
    if (v == null) throw new Error('Vertex cannot be null');
    if (!this.adjacencyMap.has(v)) {
      this.adjacencyMap.set(v, new Set<V>());
    }
  }

  connect(v1: V, v2: V): void {
    if (v1 == null || v2 == null) throw new Error('Vertices cannot be null');
    if (v1 === v2) return;
    let n1 = this.adjacencyMap.get(v1);
    if (!n1) { n1 = new Set<V>(); this.adjacencyMap.set(v1, n1); }
    n1.add(v2);
    let n2 = this.adjacencyMap.get(v2);
    if (!n2) { n2 = new Set<V>(); this.adjacencyMap.set(v2, n2); }
    n2.add(v1);
  }

  disconnect(v1: V, v2: V): void {
    if (v1 == null || v2 == null) throw new Error('Vertices cannot be null');
    if (v1 === v2) return;
    const n1 = this.adjacencyMap.get(v1);
    if (n1?.delete(v2)) {
      this.adjacencyMap.get(v2)?.delete(v1);
    }
  }

  vertexSet(): ReadonlySet<V> {
    return this.adjacencyMap.keys() as unknown as ReadonlySet<V>;
  }

  vertexArray(): V[] {
    return [...this.adjacencyMap.keys()];
  }

  neighbours(v: V): Set<V> {
    return this.adjacencyMap.get(v) ?? new Set<V>();
  }

  containsEdge(v1: V, v2: V): boolean {
    if (v1 == null || v2 == null) throw new Error('Vertices cannot be null');
    return this.adjacencyMap.get(v1)?.has(v2) ?? false;
  }
}
