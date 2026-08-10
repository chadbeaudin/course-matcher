import { NextRequest, NextResponse } from 'next/server';
import { buildGpxCourse, type TrackPoint } from '@/lib/gpx';
import { uploadRouteToRwgps } from '@/lib/rwgps';

interface ExportRequestBody {
  points: TrackPoint[];
  name: string;
  accessToken: string;
}

function isValidBody(body: unknown): body is ExportRequestBody {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    Array.isArray(b.points) &&
    b.points.length > 0 &&
    b.points.every(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as TrackPoint).lat === 'number' &&
        typeof (p as TrackPoint).lon === 'number' &&
        typeof (p as TrackPoint).ele === 'number'
    ) &&
    typeof b.name === 'string' &&
    b.name.trim().length > 0 &&
    typeof b.accessToken === 'string' &&
    b.accessToken.length > 0
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!isValidBody(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const gpx = buildGpxCourse(body.points, body.name);
    const result = await uploadRouteToRwgps(body.accessToken, gpx, body.name);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'RideWithGPS upload failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
