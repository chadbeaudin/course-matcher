jest.mock('./overpass');
jest.mock('./elevation');

import { generateCandidateRoutes } from './routeGenerator';
import { fetchOsmWays } from './overpass';
import { fetchElevations } from './elevation';
import { GRID_WAYS } from './testFixtures';

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
