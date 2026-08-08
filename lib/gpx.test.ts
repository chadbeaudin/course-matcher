import { parseGpx, computeRouteStats } from './gpx';
import { SAMPLE_GPX } from './testFixtures';

describe('parseGpx', () => {
  it('parses track points with lat/lon/elevation', () => {
    const points = parseGpx(SAMPLE_GPX);
    expect(points).toHaveLength(19);
    expect(points[0]).toEqual({ lat: 40.0, lon: -105.0, ele: 1500 });
  });

  it('throws on malformed GPX', () => {
    expect(() => parseGpx('<not-gpx>')).toThrow();
  });

  it('throws when there are no track points', () => {
    expect(() => parseGpx('<gpx></gpx>')).toThrow('No track points found in GPX file');
  });
});

describe('computeRouteStats', () => {
  it('computes distance, elevation gain/loss, and climb segments', () => {
    const stats = computeRouteStats(parseGpx(SAMPLE_GPX));

    expect(stats.distanceKm).toBeCloseTo(3.59, 1);
    expect(stats.elevationGainM).toBeGreaterThan(140);
    expect(stats.elevationGainM).toBeLessThan(180);
    expect(stats.elevationLossM).toBeGreaterThan(0);
    expect(stats.climbSegments.length).toBeGreaterThanOrEqual(2);
    expect(stats.profile).toHaveLength(19);
    expect(stats.profile[0].distanceKm).toBe(0);
  });

  it('returns zero distance and gain for a single point', () => {
    const stats = computeRouteStats([{ lat: 40, lon: -105, ele: 1500 }]);
    expect(stats.distanceKm).toBe(0);
    expect(stats.elevationGainM).toBe(0);
    expect(stats.climbSegments).toHaveLength(0);
  });
});
