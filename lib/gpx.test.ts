import {
  parseGpx,
  buildGpxCourse,
  computeRouteStats,
  resampleProfile,
  buildTargetGradeFn,
  profileShapeError,
  climbProfileError,
  type ProfilePoint,
  type TrackPoint,
} from './gpx';
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

describe('resampleProfile', () => {
  const profile: ProfilePoint[] = [
    { distanceKm: 0, elevationM: 100, lat: 40, lon: -105 },
    { distanceKm: 1, elevationM: 200, lat: 41, lon: -105 },
    { distanceKm: 2, elevationM: 100, lat: 42, lon: -105 },
  ];

  it('interpolates elevation and position at each bin distance', () => {
    const result = resampleProfile(profile, [0, 0.5, 1, 1.5, 2]);
    expect(result.map((p) => p?.elevationM)).toEqual([100, 150, 200, 150, 100]);
    expect(result.map((p) => p?.lat)).toEqual([40, 40.5, 41, 41.5, 42]);
  });

  it('returns null past the profile\'s own total distance', () => {
    expect(resampleProfile(profile, [2.5, 3])).toEqual([null, null]);
  });

  it('returns all nulls for an empty profile', () => {
    expect(resampleProfile([], [0, 1])).toEqual([null, null]);
  });
});

describe('buildTargetGradeFn', () => {
  it('reports the local grade at a given distance along the profile', () => {
    // Climbs 100m over the first km (10% grade), flat for the second km.
    const profile: ProfilePoint[] = [
      { distanceKm: 0, elevationM: 0, lat: 40, lon: -105 },
      { distanceKm: 1, elevationM: 100, lat: 41, lon: -105 },
      { distanceKm: 2, elevationM: 100, lat: 42, lon: -105 },
    ];
    const gradeAt = buildTargetGradeFn(profile, 0.1);

    expect(gradeAt(0)).toBeCloseTo(10, 5);
    expect(gradeAt(1.5)).toBeCloseTo(0, 5);
  });

  it('returns 0 for a profile with fewer than two points', () => {
    expect(buildTargetGradeFn([])(0)).toBe(0);
    expect(buildTargetGradeFn([{ distanceKm: 0, elevationM: 0, lat: 40, lon: -105 }])(0)).toBe(0);
  });
});

describe('profileShapeError', () => {
  it('is 0 for an identical profile', () => {
    const profile: ProfilePoint[] = [
      { distanceKm: 0, elevationM: 0, lat: 40, lon: -105 },
      { distanceKm: 1, elevationM: 100, lat: 41, lon: -105 },
      { distanceKm: 2, elevationM: 100, lat: 42, lon: -105 },
    ];
    expect(profileShapeError(profile, profile)).toBe(0);
  });

  it('is larger for a candidate whose climb lands in the wrong place', () => {
    // Target climbs 100m in the first km, flat for the second.
    const target: ProfilePoint[] = [
      { distanceKm: 0, elevationM: 0, lat: 40, lon: -105 },
      { distanceKm: 1, elevationM: 100, lat: 41, lon: -105 },
      { distanceKm: 2, elevationM: 100, lat: 42, lon: -105 },
    ];
    // Same total distance and gain, but the climb happens in the second km instead.
    const misplacedClimb: ProfilePoint[] = [
      { distanceKm: 0, elevationM: 0, lat: 40, lon: -105 },
      { distanceKm: 1, elevationM: 0, lat: 41, lon: -105 },
      { distanceKm: 2, elevationM: 100, lat: 42, lon: -105 },
    ];
    // Climbs the same 100m in the first km, just less steeply spread differently — still much closer to target.
    const closeMatch: ProfilePoint[] = [
      { distanceKm: 0, elevationM: 0, lat: 40, lon: -105 },
      { distanceKm: 1, elevationM: 90, lat: 41, lon: -105 },
      { distanceKm: 2, elevationM: 100, lat: 42, lon: -105 },
    ];

    const misplacedError = profileShapeError(misplacedClimb, target);
    const closeError = profileShapeError(closeMatch, target);

    expect(misplacedError).toBeGreaterThan(closeError);
    expect(closeError).toBeGreaterThan(0);
  });

  it('returns 0 when either profile has fewer than two points', () => {
    expect(profileShapeError([], [])).toBe(0);
  });
});

describe('climbProfileError', () => {
  // One sustained climb: 1km at ~5%.
  const target: ProfilePoint[] = [
    { distanceKm: 0, elevationM: 0, lat: 40, lon: -105 },
    { distanceKm: 1, elevationM: 50, lat: 40.01, lon: -105 },
    { distanceKm: 2, elevationM: 50, lat: 40.02, lon: -105 },
  ];

  it('is 0 for an identical set of climbs', () => {
    expect(climbProfileError(target, target)).toBe(0);
  });

  it('prefers a climb of similar length and grade over a shorter, steeper one', () => {
    // 1km at ~4.5% — close to target on both length and grade.
    const similar: ProfilePoint[] = [
      { distanceKm: 0, elevationM: 0, lat: 40, lon: -105 },
      { distanceKm: 1, elevationM: 45, lat: 40.01, lon: -105 },
      { distanceKm: 2, elevationM: 45, lat: 40.02, lon: -105 },
    ];
    // 0.2km at ~25% — same idea of "a climb", nothing like the target to ride.
    const shortSteep: ProfilePoint[] = [
      { distanceKm: 0, elevationM: 0, lat: 40, lon: -105 },
      { distanceKm: 0.2, elevationM: 50, lat: 40.002, lon: -105 },
      { distanceKm: 2, elevationM: 50, lat: 40.02, lon: -105 },
    ];

    expect(climbProfileError(similar, target)).toBeLessThan(climbProfileError(shortSteep, target));
  });

  it('penalizes a flat route that has no climbs at all', () => {
    const flat: ProfilePoint[] = [
      { distanceKm: 0, elevationM: 100, lat: 40, lon: -105 },
      { distanceKm: 2, elevationM: 100, lat: 40.02, lon: -105 },
    ];

    expect(climbProfileError(flat, target)).toBe(1);
  });

  it('returns 0 when the target itself has no climbs to match', () => {
    const flat: ProfilePoint[] = [
      { distanceKm: 0, elevationM: 100, lat: 40, lon: -105 },
      { distanceKm: 2, elevationM: 100, lat: 40.02, lon: -105 },
    ];

    expect(climbProfileError(target, flat)).toBe(0);
  });
});

describe('buildGpxCourse', () => {
  const points: TrackPoint[] = [
    { lat: 40.0, lon: -105.0, ele: 1500 },
    { lat: 40.001, lon: -105.001, ele: 1510 },
  ];

  it('round-trips through parseGpx to the same points', () => {
    const gpx = buildGpxCourse(points, 'Test Route');
    expect(parseGpx(gpx)).toEqual(points);
  });

  it('escapes special characters in the route name', () => {
    const gpx = buildGpxCourse(points, 'Ride & <Climb>');
    expect(gpx).toContain('Ride &amp; &lt;Climb&gt;');
    expect(gpx).not.toContain('<Climb>');
  });
});
