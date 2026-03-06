import { describe, it, expect } from 'bun:test';
import { Graph } from '@zenystx/core/internal/util/graph/Graph';
import { BronKerboschCliqueFinder } from '@zenystx/core/internal/util/graph/BronKerboschCliqueFinder';

function populateFullyConnectedGraph(vertices: string[]): Graph<string> {
  const g = new Graph<string>();
  for (const v of vertices) g.add(v);
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      g.connect(vertices[i], vertices[j]);
    }
  }
  return g;
}

describe('BronKerboschCliqueFinderTest', () => {
  it('test2DisconnectedVerticesIn4vertexGraph', () => {
    const vertices = ['n0', 'n1', 'n2', 'n3'];
    const g = populateFullyConnectedGraph(vertices);
    g.disconnect('n0', 'n1');
    const cliques = new BronKerboschCliqueFinder(g).computeMaxCliques();
    expect(cliques.length).toEqual(2);
    // Both cliques should be size 3
    for (const c of cliques) expect(c.size).toEqual(3);
  });

  it('testSplitInto4VertexLeftCliqueAnd4VertexRightClique', () => {
    const vertexCount = 8;
    const leftSize = 4;
    const vertices = Array.from({ length: vertexCount }, (_, i) => `n${i}`);
    const g = populateFullyConnectedGraph(vertices);
    const left = vertices.slice(0, leftSize);
    const right = vertices.slice(leftSize);
    for (const v1 of left) for (const v2 of right) g.disconnect(v1, v2);
    const cliques = new BronKerboschCliqueFinder(g).computeMaxCliques();
    expect(cliques.length).toEqual(2);
    // equal sized split → 2 max cliques of size leftSize
    for (const c of cliques) expect(c.size).toEqual(leftSize);
  });

  it('testSingleVertex', () => {
    const g = new Graph<string>();
    g.add('v0');
    const cliques = new BronKerboschCliqueFinder(g).computeMaxCliques();
    expect(cliques.length).toEqual(1);
    expect(cliques[0].has('v0')).toBe(true);
  });

  it('testEmptyGraph', () => {
    const g = new Graph<string>();
    const cliques = new BronKerboschCliqueFinder(g).computeMaxCliques();
    expect(cliques.length).toEqual(0);
  });

  it('testFullyConnectedGraph', () => {
    const vertices = ['a', 'b', 'c'];
    const g = populateFullyConnectedGraph(vertices);
    const cliques = new BronKerboschCliqueFinder(g).computeMaxCliques();
    expect(cliques.length).toEqual(1);
    expect(cliques[0].size).toEqual(3);
  });
});
