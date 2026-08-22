import { buildChartData, computeElevationDomainM } from './ElevationProfileChart';
import type { ProfilePoint } from '@/lib/gpx';

function makeProfile(distances: number[], elevationFn: (km: number) => number): ProfilePoint[] {
  return distances.map((km) => ({
    distanceKm: km,
    elevationM: elevationFn(km),
    lat: 47 + km * 0.01,
    lon: -117 + km * 0.01,
  }));
}

describe('buildChartData', () => {
  const identity = (km: number) => km;

  it('resamples the target profile to the same shape regardless of the candidate route length', () => {
    const targetProfile = makeProfile(
      Array.from({ length: 43 }, (_, i) => i),
      identity
    );

    const shortRoute = makeProfile(Array.from({ length: 43 }, (_, i) => i), identity);
    const longRoute = makeProfile(Array.from({ length: 51 }, (_, i) => i), identity);

    const shortData = buildChartData(shortRoute, targetProfile, identity, identity);
    const longData = buildChartData(longRoute, targetProfile, identity, identity);

    const shortTargetOverlap = shortData
      .filter((p) => p.distance <= 41)
      .map((p) => p.targetElevation);
    const longTargetOverlap = longData
      .filter((p) => p.distance <= 41)
      .map((p) => p.targetElevation);

    expect(longTargetOverlap).toEqual(shortTargetOverlap);
  });

  it('falls back to plain per-point data when no target profile is given', () => {
    const profile = makeProfile([0, 1, 2], identity);
    const data = buildChartData(profile, undefined, identity, identity);
    expect(data).toEqual([
      { distance: 0, elevation: 0, lat: 47, lon: -117 },
      { distance: 1, elevation: 1, lat: 47.01, lon: -116.99 },
      { distance: 2, elevation: 2, lat: 47.02, lon: -116.98 },
    ]);
  });
});

describe('computeElevationDomainM', () => {
  it('covers the min and max elevation across every given profile, with padding', () => {
    const profileA: ProfilePoint[] = [
      { distanceKm: 0, elevationM: 100, lat: 0, lon: 0 },
      { distanceKm: 1, elevationM: 300, lat: 0, lon: 0 },
    ];
    const profileB: ProfilePoint[] = [
      { distanceKm: 0, elevationM: 50, lat: 0, lon: 0 },
      { distanceKm: 1, elevationM: 900, lat: 0, lon: 0 },
    ];

    const [min, max] = computeElevationDomainM([profileA, profileB]);

    expect(min).toBeLessThan(50);
    expect(max).toBeGreaterThan(900);
  });

  it('stays the same across calls regardless of which profile is passed first', () => {
    const target: ProfilePoint[] = [{ distanceKm: 0, elevationM: 500, lat: 0, lon: 0 }];
    const routeA: ProfilePoint[] = [{ distanceKm: 0, elevationM: 200, lat: 0, lon: 0 }];
    const routeB: ProfilePoint[] = [{ distanceKm: 0, elevationM: 800, lat: 0, lon: 0 }];

    // Simulates switching the visible candidate route while the target stays fixed —
    // the union domain (and therefore the Y-axis) shouldn't depend on which one is active.
    const domainWithA = computeElevationDomainM([target, routeA]);
    const domainWithB = computeElevationDomainM([target, routeA, routeB]);

    expect(domainWithB[0]).toBeLessThanOrEqual(domainWithA[0]);
    expect(domainWithB[1]).toBeGreaterThanOrEqual(domainWithA[1]);
  });
});
