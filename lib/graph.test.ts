import { RouteGraph } from './graph';
import { GRID_WAYS } from './testFixtures';

describe('RouteGraph.fromWays', () => {
  it('builds one node per grid intersection', () => {
    const graph = RouteGraph.fromWays(GRID_WAYS);
    expect(graph.nodeCount).toBe(9);
  });
});

describe('findClosestNode', () => {
  it('snaps a nearby point to the correct node', () => {
    const graph = RouteGraph.fromWays(GRID_WAYS);
    expect(graph.findClosestNode({ lat: 40.0001, lon: -105.0001 })).toBe('1');
    expect(graph.findClosestNode({ lat: 40.0021, lon: -104.9981 })).toBe('9');
  });
});

describe('findPath', () => {
  it('finds a path between opposite corners', () => {
    const graph = RouteGraph.fromWays(GRID_WAYS);
    const result = graph.findPath('1', '9');

    expect(result).not.toBeNull();
    expect(result!.points[0]).toEqual({ lat: 40.0, lon: -105.0 });
    expect(result!.points.at(-1)).toEqual({ lat: 40.002, lon: -104.998 });
    expect(result!.distanceKm).toBeGreaterThan(0);
  });

  it('returns null when either node does not exist', () => {
    const graph = RouteGraph.fromWays(GRID_WAYS);
    expect(graph.findPath('1', 'nonexistent')).toBeNull();
  });

  it('routes the return leg away from penalized segments when an equal-cost alternate exists', () => {
    const graph = RouteGraph.fromWays(GRID_WAYS);
    // Center node 5 is reachable from node 1 via two equally short routes (through 2, or through 4).
    const outbound = graph.findPath('1', '5')!;
    const inbound = graph.findPath('5', '1', outbound.segIds)!;

    const overlap = [...inbound.segIds].filter((id) => outbound.segIds.has(id));
    expect(overlap.length).toBeLessThan(outbound.segIds.size);
  });
});
