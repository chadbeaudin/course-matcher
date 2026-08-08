export interface TrackPoint {
  lat: number;
  lon: number;
  ele: number;
}

export interface ProfilePoint {
  distanceKm: number;
  elevationM: number;
}

export interface ClimbSegment {
  startDistanceKm: number;
  lengthKm: number;
  elevationGainM: number;
  gradePercent: number;
}

export interface RouteStats {
  points: TrackPoint[];
  profile: ProfilePoint[];
  distanceKm: number;
  elevationGainM: number;
  elevationLossM: number;
  climbSegments: ClimbSegment[];
}

export function parseGpx(xml: string): TrackPoint[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const errorNode = doc.querySelector('parsererror');
  if (errorNode) {
    throw new Error('Invalid GPX file');
  }

  const trkpts = Array.from(doc.querySelectorAll('trkpt, rtept'));
  if (trkpts.length === 0) {
    throw new Error('No track points found in GPX file');
  }

  return trkpts.map((node) => {
    const lat = parseFloat(node.getAttribute('lat') ?? '');
    const lon = parseFloat(node.getAttribute('lon') ?? '');
    const eleNode = node.querySelector('ele');
    const ele = eleNode ? parseFloat(eleNode.textContent ?? '0') : 0;
    return { lat, lon, ele };
  });
}

function haversineKm(a: TrackPoint, b: TrackPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Moving-average smoothing to reduce GPS/barometric elevation noise. */
function smoothElevations(points: TrackPoint[], windowSize = 5): number[] {
  const half = Math.floor(windowSize / 2);
  return points.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(points.length, i + half + 1);
    const window = points.slice(start, end);
    return window.reduce((sum, p) => sum + p.ele, 0) / window.length;
  });
}

const MIN_CLIMB_GRADE_PERCENT = 2;
const MIN_CLIMB_LENGTH_KM = 0.1;

function segmentClimbs(profile: ProfilePoint[]): ClimbSegment[] {
  const segments: ClimbSegment[] = [];
  let segmentStartIdx: number | null = null;

  for (let i = 1; i < profile.length; i++) {
    const prev = profile[i - 1];
    const curr = profile[i];
    const runKm = curr.distanceKm - prev.distanceKm;
    const grade = runKm > 0 ? ((curr.elevationM - prev.elevationM) / (runKm * 1000)) * 100 : 0;
    const isClimbing = grade >= MIN_CLIMB_GRADE_PERCENT;

    if (isClimbing && segmentStartIdx === null) {
      segmentStartIdx = i - 1;
    } else if (!isClimbing && segmentStartIdx !== null) {
      pushSegmentIfSignificant(segments, profile, segmentStartIdx, i - 1);
      segmentStartIdx = null;
    }
  }

  if (segmentStartIdx !== null) {
    pushSegmentIfSignificant(segments, profile, segmentStartIdx, profile.length - 1);
  }

  return segments;
}

function pushSegmentIfSignificant(
  segments: ClimbSegment[],
  profile: ProfilePoint[],
  startIdx: number,
  endIdx: number
) {
  const start = profile[startIdx];
  const end = profile[endIdx];
  const lengthKm = end.distanceKm - start.distanceKm;
  if (lengthKm < MIN_CLIMB_LENGTH_KM) return;

  const elevationGainM = end.elevationM - start.elevationM;
  segments.push({
    startDistanceKm: start.distanceKm,
    lengthKm,
    elevationGainM,
    gradePercent: (elevationGainM / (lengthKm * 1000)) * 100,
  });
}

export function computeRouteStats(points: TrackPoint[]): RouteStats {
  const smoothed = smoothElevations(points);
  const profile: ProfilePoint[] = [];
  let distanceKm = 0;
  let elevationGainM = 0;
  let elevationLossM = 0;

  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      distanceKm += haversineKm(points[i - 1], points[i]);
      const delta = smoothed[i] - smoothed[i - 1];
      if (delta > 0) elevationGainM += delta;
      else elevationLossM += Math.abs(delta);
    }
    profile.push({ distanceKm, elevationM: smoothed[i] });
  }

  return {
    points,
    profile,
    distanceKm,
    elevationGainM,
    elevationLossM,
    climbSegments: segmentClimbs(profile),
  };
}
