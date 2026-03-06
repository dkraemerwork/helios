import { Graph } from '@zenystx/core/internal/util/graph/Graph';

/**
 * Bron-Kerbosch maximum clique finder algorithm.
 * Port of com.hazelcast.internal.util.graph.BronKerboschCliqueFinder.
 */
export class BronKerboschCliqueFinder<V> {
  private readonly graph: Graph<V>;
  private readonly timeoutMs: number;
  private _timeLimitReached = false;
  private _maximumCliques: Set<V>[] | null = null;

  constructor(graph: Graph<V>, timeoutMs = Number.MAX_SAFE_INTEGER) {
    if (graph == null) throw new Error('Graph cannot be null');
    if (timeoutMs < 1) throw new Error('Invalid timeout, must be positive!');
    this.graph = graph;
    this.timeoutMs = timeoutMs;
  }

  computeMaxCliques(): Set<V>[] {
    this._lazyRun();
    return this._maximumCliques!;
  }

  isTimeLimitReached(): boolean {
    return this._timeLimitReached;
  }

  private _lazyRun(): void {
    if (this._maximumCliques !== null) return;
    this._maximumCliques = [];
    const timeLimit = Date.now() + this.timeoutMs;
    const vertices = this.graph.vertexArray();
    this._findCliques(
      new Set<V>(),
      new Set<V>(vertices),
      new Set<V>(),
      timeLimit
    );
  }

  private _findCliques(
    potentialClique: Set<V>,
    candidates: Set<V>,
    alreadyFound: Set<V>,
    timeLimit: number
  ): void {
    // Termination: if any alreadyFound node is connected to all candidates, prune
    for (const v of alreadyFound) {
      let connectedToAll = true;
      for (const c of candidates) {
        if (!this.graph.containsEdge(v, c)) { connectedToAll = false; break; }
      }
      if (connectedToAll) return;
    }

    const candidateArray = [...candidates];
    for (let i = 0; i < candidateArray.length; i++) {
      if (Date.now() > timeLimit) {
        this._timeLimitReached = true;
        return;
      }
      const candidate = candidateArray[i];
      candidates.delete(candidate);
      potentialClique.add(candidate);

      const newCandidates = this._populate(candidates, candidate);
      const newAlreadyFound = this._populate(alreadyFound, candidate);

      if (newCandidates.size === 0 && newAlreadyFound.size === 0) {
        this._addMaxClique(potentialClique);
      } else {
        this._findCliques(potentialClique, newCandidates, newAlreadyFound, timeLimit);
      }

      alreadyFound.add(candidate);
      potentialClique.delete(candidate);
    }
  }

  private _populate(source: Set<V>, candidate: V): Set<V> {
    const result = new Set<V>();
    for (const v of source) {
      if (this.graph.containsEdge(candidate, v)) result.add(v);
    }
    return result;
  }

  private _addMaxClique(clique: Set<V>): void {
    const maxCliques = this._maximumCliques!;
    if (maxCliques.length === 0 || clique.size === maxCliques[0].size) {
      maxCliques.push(new Set(clique));
    } else if (clique.size > maxCliques[0].size) {
      maxCliques.length = 0;
      maxCliques.push(new Set(clique));
    }
  }
}
