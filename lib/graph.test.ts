import { RouteGraph } from './graph';
import { GRID_WAYS } from './testFixtures';
import type { OSMWay } from './overpass';

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

describe('findGradeMatchedPath', () => {
  // Two same-distance routes from A to C: one that front-loads its climb (via B2, closely
  // matching a target profile that wants a strong climb right away), and one that front-loads
  // a shallow climb instead (via B1, undershooting that same target).
  const A = { lat: 40, lon: -105 };
  const B1 = { lat: 40.0005, lon: -105 };
  const B2 = { lat: 40.0005, lon: -105.0000001 };
  const C = { lat: 40.001, lon: -105 };

  const ways: OSMWay[] = [
    { id: 1, nodes: [100, 101, 102], geometry: [A, B1, C] },
    { id: 2, nodes: [100, 103, 102], geometry: [A, B2, C] },
  ];

  const elevations = new Map<string, number>([
    [`${A.lat},${A.lon}`, 0],
    [`${B1.lat},${B1.lon}`, 2],
    [`${B2.lat},${B2.lon}`, 8],
    [`${C.lat},${C.lon}`, 10],
  ]);
  const elevationAt = (p: { lat: number; lon: number }) => elevations.get(`${p.lat},${p.lon}`) ?? 0;

  it('prefers the route matching the target climb over the merely-shorter one', () => {
    const graph = RouteGraph.fromWays(ways);
    // Wants a strong climb in the first ~60m, then no preference — matches B2 (grade ~14%)
    // far better than B1 (grade ~3.6%), even though both routes cover the same distance.
    const targetGradeAt = (cumKm: number) => (cumKm < 0.06 ? 12 : 0);

    const result = graph.findGradeMatchedPath('100', '102', { elevationAt, targetGradeAt })!;

    expect(result).not.toBeNull();
    expect(result.points[1]).toEqual(B2);
  });

  it('falls back to plain shortest-path behavior when the target wants no particular grade', () => {
    const graph = RouteGraph.fromWays(ways);
    const result = graph.findGradeMatchedPath('100', '102', {
      elevationAt,
      targetGradeAt: () => 0,
    })!;

    expect(result).not.toBeNull();
    expect(result.distanceKm).toBeGreaterThan(0);
  });

  it('returns null when either node does not exist', () => {
    const graph = RouteGraph.fromWays(ways);
    expect(
      graph.findGradeMatchedPath('100', 'nonexistent', { elevationAt, targetGradeAt: () => 0 })
    ).toBeNull();
  });

  describe('computeHilliness', () => {
    it('scores a node surrounded by steep edges higher than one surrounded by flat edges', () => {
      // D-E-F is flat throughout; D-G-F climbs steeply then descends, same distances as D-E-F.
      const D = { lat: 41, lon: -106 };
      const E = { lat: 41.0005, lon: -106 };
      const F = { lat: 41.001, lon: -106 };
      const G = { lat: 41.0005, lon: -106.0000001 };

      const hillWays: OSMWay[] = [
        { id: 1, nodes: [200, 201, 202], geometry: [D, E, F] },
        { id: 2, nodes: [200, 203, 202], geometry: [D, G, F] },
      ];
      const hillElevations = new Map<string, number>([
        [`${D.lat},${D.lon}`, 0],
        [`${E.lat},${E.lon}`, 0],
        [`${F.lat},${F.lon}`, 0],
        [`${G.lat},${G.lon}`, 50],
      ]);
      const hillElevationAt = (p: { lat: number; lon: number }) => hillElevations.get(`${p.lat},${p.lon}`) ?? 0;

      const graph = RouteGraph.fromWays(hillWays);
      const scores = graph.computeHilliness(hillElevationAt);

      expect(scores.get('203')).toBeGreaterThan(scores.get('201')!);
    });
  });
});
