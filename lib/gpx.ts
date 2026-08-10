export interface TrackPoint {
  lat: number;
  lon: number;
  ele: number;
}

export interface ProfilePoint {
  distanceKm: number;
  elevationM: number;
  lat: number;
  lon: number;
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

export function segmentClimbs(profile: ProfilePoint[]): ClimbSegment[] {
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

/**
 * Interpolates a profile (elevation + position) at each of `binDistancesKm`,
 * for plotting two profiles of different lengths against a shared distance
 * axis, or for finding the map position under a point on that shared axis.
 * Returns null for bins beyond the profile's own total distance, so its line
 * just stops there rather than extrapolating flat.
 */
export function resampleProfile(profile: ProfilePoint[], binDistancesKm: number[]): (ProfilePoint | null)[] {
  if (profile.length === 0) return binDistancesKm.map(() => null);

  const total = profile[profile.length - 1].distanceKm;
  let idx = 0;

  return binDistancesKm.map((distanceKm) => {
    if (distanceKm > total) return null;
    while (idx < profile.length - 2 && profile[idx + 1].distanceKm < distanceKm) idx++;

    const a = profile[idx];
    const b = profile[Math.min(idx + 1, profile.length - 1)];
    const span = b.distanceKm - a.distanceKm;
    const t = span > 0 ? (distanceKm - a.distanceKm) / span : 0;
    return {
      distanceKm,
      elevationM: a.elevationM + (b.elevationM - a.elevationM) * t,
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
    };
  });
}

/**
 * Builds a lookup from cumulative distance to a profile's local grade (%) at
 * that point, via a small forward window. Used both to bias route search
 * toward matching a target's climbs rather than just its distance/total gain,
 * and to score how well a finished candidate's climbs line up with it.
 */
export function buildTargetGradeFn(profile: ProfilePoint[], windowKm = 0.1): (distanceKm: number) => number {
  if (profile.length < 2) return () => 0;
  const total = profile[profile.length - 1].distanceKm;

  return (distanceKm: number) => {
    const d = Math.min(Math.max(distanceKm, 0), total);
    const [a] = resampleProfile(profile, [d]);
    const [b] = resampleProfile(profile, [Math.min(d + windowKm, total)]);
    if (!a || !b || b.distanceKm <= a.distanceKm) return 0;
    return ((b.elevationM - a.elevationM) / ((b.distanceKm - a.distanceKm) * 1000)) * 100;
  };
}

/**
 * Average absolute difference (percentage points) between two profiles' local
 * grades at matching cumulative distances, over the distance they both cover.
 * Two routes can have near-identical total distance and elevation gain while
 * climbing at completely different points — this catches that, for scoring
 * which candidate actually tracks the target's climbs rather than just its totals.
 */
export function profileShapeError(profile: ProfilePoint[], targetProfile: ProfilePoint[], binKm = 0.5): number {
  if (profile.length < 2 || targetProfile.length < 2) return 0;
  const total = Math.min(profile.at(-1)!.distanceKm, targetProfile.at(-1)!.distanceKm);
  if (total <= 0) return 0;

  const gradeAt = buildTargetGradeFn(profile, binKm);
  const targetGradeAt = buildTargetGradeFn(targetProfile, binKm);

  let sumAbsDiff = 0;
  let count = 0;
  for (let d = 0; d < total; d += binKm) {
    sumAbsDiff += Math.abs(gradeAt(d) - targetGradeAt(d));
    count++;
  }
  return count > 0 ? sumAbsDiff / count : 0;
}

/**
 * How well a candidate's individual climbs match the target's, by length and grade —
 * what actually makes a training route "feel like" the race. Each target climb is
 * greedily paired with its closest unused candidate climb; a target climb with no
 * counterpart costs a full miss. Returns roughly 0 (identical climbs) to ~1+ (nothing
 * matches), so it's directly comparable with the relative distance/elevation errors.
 *
 * Deliberately ignores where along the route each climb falls: riding the same climbs
 * in a different order is still good training, whereas having no comparable climb at
 * all is not.
 */
export function climbProfileError(profile: ProfilePoint[], targetProfile: ProfilePoint[]): number {
  const targetClimbs = segmentClimbs(targetProfile);
  if (targetClimbs.length === 0) return 0;

  const available = segmentClimbs(profile).slice();
  const FULL_MISS_COST = 1;
  let totalCost = 0;

  for (const target of targetClimbs) {
    let bestIdx = -1;
    let bestCost = FULL_MISS_COST;

    for (let i = 0; i < available.length; i++) {
      const lengthError = Math.abs(available[i].lengthKm - target.lengthKm) / target.lengthKm;
      const gradeError =
        target.gradePercent > 0
          ? Math.abs(available[i].gradePercent - target.gradePercent) / target.gradePercent
          : 0;
      const cost = Math.min((lengthError + gradeError) / 2, FULL_MISS_COST);
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = i;
      }
    }

    totalCost += bestCost;
    if (bestIdx >= 0) available.splice(bestIdx, 1);
  }

  return totalCost / targetClimbs.length;
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
    profile.push({ distanceKm, elevationM: smoothed[i], lat: points[i].lat, lon: points[i].lon });
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
