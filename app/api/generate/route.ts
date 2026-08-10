import { NextRequest, NextResponse } from 'next/server';
import { generateCandidateRoutes } from '@/lib/routeGenerator';
import type { ProfilePoint } from '@/lib/gpx';

interface GenerateRequestBody {
  startLat: number;
  startLon: number;
  targetDistanceKm: number;
  targetElevationGainM: number;
  approachDistanceKm?: number;
  targetProfile?: ProfilePoint[];
}

function isValidProfile(value: unknown): value is ProfilePoint[] {
  return (
    Array.isArray(value) &&
    value.every(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as ProfilePoint).distanceKm === 'number' &&
        typeof (p as ProfilePoint).elevationM === 'number' &&
        typeof (p as ProfilePoint).lat === 'number' &&
        typeof (p as ProfilePoint).lon === 'number'
    )
  );
}

function isValidBody(body: unknown): body is GenerateRequestBody {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.startLat === 'number' &&
    typeof b.startLon === 'number' &&
    typeof b.targetDistanceKm === 'number' &&
    b.targetDistanceKm > 0 &&
    typeof b.targetElevationGainM === 'number' &&
    b.targetElevationGainM >= 0 &&
    (b.approachDistanceKm === undefined ||
      (typeof b.approachDistanceKm === 'number' && b.approachDistanceKm >= 0)) &&
    (b.targetProfile === undefined || isValidProfile(b.targetProfile))
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!isValidBody(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const candidates = await generateCandidateRoutes({
      start: { lat: body.startLat, lon: body.startLon },
      targetDistanceKm: body.targetDistanceKm,
      targetElevationGainM: body.targetElevationGainM,
      approachDistanceKm: body.approachDistanceKm,
      targetProfile: body.targetProfile,
    });
    return NextResponse.json({ candidates });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Route generation failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
