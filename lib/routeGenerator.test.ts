jest.mock('./overpass');
jest.mock('./elevation');

import { generateCandidateRoutes } from './routeGenerator';
import { fetchOsmWays } from './overpass';
import { fetchElevations } from './elevation';
import { GRID_WAYS, makeGridWays } from './testFixtures';

const mockFetchOsmWays = fetchOsmWays as jest.MockedFunction<typeof fetchOsmWays>;
const mockFetchElevations = fetchElevations as jest.MockedFunction<typeof fetchElevations>;

describe('generateCandidateRoutes', () => {
  beforeEach(() => {
    mockFetchOsmWays.mockResolvedValue(GRID_WAYS);
    mockFetchElevations.mockImplementation(async (points) => points.map(() => 1500));
  });

  it('generates candidates scored and sorted by fit to the target, using real graph/geo/stats logic', async () => {
    const candidates = await generateCandidateRoutes({
      start: { lat: 40.0, lon: -105.0 },
      targetDistanceKm: 0.4,
      targetElevationGainM: 0,
      bearingSteps: 8,
      candidateCount: 3,
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(3);

    for (const candidate of candidates) {
      expect(candidate.points.length).toBeGreaterThan(1);
      expect(candidate.stats.distanceKm).toBeGreaterThan(0);
      // flat elevation fixture -> no gain
      expect(candidate.stats.elevationGainM).toBe(0);
      // no approach requested -> the whole route is the matched course
      expect(candidate.approachDistanceKm).toBe(0);
      expect(candidate.matchedStats.distanceKm).toBeCloseTo(candidate.stats.distanceKm, 6);
      expect(candidate.matchedRange).toEqual({ start: 0, end: candidate.points.length });
    }

    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i].score).toBeGreaterThanOrEqual(candidates[i - 1].score);
    }
  });

  it('throws when no road data is found near the start', async () => {
    mockFetchOsmWays.mockResolvedValue([]);

    await expect(
      generateCandidateRoutes({ start: { lat: 0, lon: 0 }, targetDistanceKm: 1, targetElevationGainM: 0 })
    ).rejects.toThrow('No road data found');
  });

  it('propagates elevation lookup failures', async () => {
    mockFetchElevations.mockRejectedValue(new Error('elevation providers down'));

    await expect(
      generateCandidateRoutes({
        start: { lat: 40.0, lon: -105.0 },
        targetDistanceKm: 0.4,
        targetElevationGainM: 0,
      })
    ).rejects.toThrow('elevation providers down');
  });
});

describe('generateCandidateRoutes with an approach distance', () => {
  // Bigger grid so a ride-out ring plus the matched loop both fit inside it.
  const LARGE_GRID = makeGridWays(11, 0.001);

  beforeEach(() => {
    mockFetchOsmWays.mockResolvedValue(LARGE_GRID);
    mockFetchElevations.mockImplementation(async (points) => points.map(() => 1500));
  });

  it('rides out to an approach ring before the matched course, and back, on top of it', async () => {
    const candidates = await generateCandidateRoutes({
      start: { lat: 40.0, lon: -105.0 },
      targetDistanceKm: 0.3,
      targetElevationGainM: 0,
      approachDistanceKm: 0.25,
      bearingSteps: 8,
      candidateCount: 3,
    });

    expect(candidates.length).toBeGreaterThan(0);

    for (const candidate of candidates) {
      expect(candidate.approachDistanceKm).toBeGreaterThan(0);
      // the matched course is scored/reported separately from the full ride
      expect(candidate.matchedRange.start).toBeGreaterThan(0);
      expect(candidate.matchedRange.end).toBeLessThanOrEqual(candidate.points.length);
      // full ride = approach out + matched course + approach back
      expect(candidate.stats.distanceKm).toBeCloseTo(
        candidate.matchedStats.distanceKm + candidate.approachDistanceKm * 2,
        3
      );
    }
  });

  it('defaults to no approach when omitted, matching the base flow', async () => {
    const [candidate] = await generateCandidateRoutes({
      start: { lat: 40.0, lon: -105.0 },
      targetDistanceKm: 0.3,
      targetElevationGainM: 0,
      bearingSteps: 4,
      candidateCount: 1,
    });

    expect(candidate.approachDistanceKm).toBe(0);
    expect(candidate.matchedRange.start).toBe(0);
  });
});
