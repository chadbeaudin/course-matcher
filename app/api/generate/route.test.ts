/** @jest-environment node */
jest.mock('@/lib/routeGenerator');

import type { NextRequest } from 'next/server';
import { POST } from './route';
import { generateCandidateRoutes, type RouteCandidate } from '@/lib/routeGenerator';

const mockGenerate = generateCandidateRoutes as jest.MockedFunction<typeof generateCandidateRoutes>;

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe('POST /api/generate', () => {
  it('rejects a request missing required fields', async () => {
    const res = await POST(makeRequest({ startLat: 40 }));
    expect(res.status).toBe(400);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('rejects a non-positive target distance', async () => {
    const res = await POST(
      makeRequest({ startLat: 40, startLon: -105, targetDistanceKm: 0, targetElevationGainM: 0 })
    );
    expect(res.status).toBe(400);
  });

  it('calls the generator with the parsed start point and targets, returning its candidates', async () => {
    const candidates = [{ points: [], stats: {}, bearingDeg: 0, score: 0 }] as unknown as RouteCandidate[];
    mockGenerate.mockResolvedValue(candidates);

    const res = await POST(
      makeRequest({ startLat: 40.1, startLon: -105.2, targetDistanceKm: 5, targetElevationGainM: 100 })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.candidates).toEqual(candidates);
    expect(mockGenerate).toHaveBeenCalledWith({
      start: { lat: 40.1, lon: -105.2 },
      targetDistanceKm: 5,
      targetElevationGainM: 100,
    });
  });

  it('forwards approachDistanceKm to the generator when provided', async () => {
    mockGenerate.mockResolvedValue([]);

    await POST(
      makeRequest({
        startLat: 40.1,
        startLon: -105.2,
        targetDistanceKm: 5,
        targetElevationGainM: 100,
        approachDistanceKm: 3,
      })
    );

    expect(mockGenerate).toHaveBeenCalledWith({
      start: { lat: 40.1, lon: -105.2 },
      targetDistanceKm: 5,
      targetElevationGainM: 100,
      approachDistanceKm: 3,
    });
  });

  it('rejects a negative approachDistanceKm', async () => {
    const res = await POST(
      makeRequest({
        startLat: 40,
        startLon: -105,
        targetDistanceKm: 5,
        targetElevationGainM: 100,
        approachDistanceKm: -1,
      })
    );
    expect(res.status).toBe(400);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('returns a 502 with the error message when generation fails', async () => {
    mockGenerate.mockRejectedValue(new Error('No road data found near the start location'));

    const res = await POST(
      makeRequest({ startLat: 40, startLon: -105, targetDistanceKm: 5, targetElevationGainM: 100 })
    );
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe('No road data found near the start location');
  });
});
