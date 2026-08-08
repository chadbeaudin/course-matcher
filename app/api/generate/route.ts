import { NextRequest, NextResponse } from 'next/server';
import { generateCandidateRoutes } from '@/lib/routeGenerator';

interface GenerateRequestBody {
  startLat: number;
  startLon: number;
  targetDistanceKm: number;
  targetElevationGainM: number;
  approachDistanceKm?: number;
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
      (typeof b.approachDistanceKm === 'number' && b.approachDistanceKm >= 0))
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
    });
    return NextResponse.json({ candidates });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Route generation failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
