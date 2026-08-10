import { RouteGraph, type PathResult } from './graph';
import { fetchOsmWays } from './overpass';
import { fetchElevations } from './elevation';
import { buildElevationGrid, type ElevationGrid } from './elevationGrid';
import { destinationPoint, boundingBox, haversineKm, type LatLon } from './geo';
import {
  computeRouteStats,
  buildTargetGradeFn,
  profileShapeError,
  climbProfileError,
  type TrackPoint,
  type RouteStats,
  type ProfilePoint,
} from './gpx';

// Scales profileShapeError (average absolute grade-percentage-point mismatch, typically
// a few percent) down to be comparable with distanceError/elevationError (unitless
// relative errors, typically 0-0.35), so shape mismatch meaningfully affects ranking
// without swamping the existing distance/elevation-total signal.
const SHAPE_ERROR_WEIGHT = 0.05;
// Matching the race's actual climbs (lengths and grades) is the point of the app, so
// climb mismatch outweighs the raw distance/elevation totals in ranking.
const CLIMB_ERROR_WEIGHT = 2;
// Coming up short means the ride doesn't deliver the target workout; running long is
// easy to live with (or trim), so undershoot costs several times what overshoot does.
const DISTANCE_UNDERSHOOT_PENALTY = 4;
// A route this much shorter than the target isn't a usable substitute at all.
const MAX_ACCEPTABLE_UNDERSHOOT = 0.12;
// ...but never discard every option; if nothing clears the bar, still show the best few.
const OVERSHOOT_TOLERANCE = 0.5;
// Upper bound on hills strung into one tour, so a pathological pool can't spin forever.
const MAX_TOUR_LEGS = 12;
// Roads wind, so the ride home is longer than the straight line back; used to decide
// when the tour has enough distance banked to start heading for the finish.
const ROAD_WINDING_FACTOR = 1.35;

export interface GenerateOptions {
  start: LatLon;
  targetDistanceKm: number;
  targetElevationGainM: number;
  /** Minimum distance to ride out from the start before the matched course begins (e.g. to clear a city). Default 0. */
  approachDistanceKm?: number;
  /** The race's full elevation profile. When provided, the matched-course legs are routed to follow its climbs/descents, not just its total distance and gain. */
  targetProfile?: ProfilePoint[];
  candidateCount?: number;
  bearingSteps?: number;
}

export interface RouteCandidate {
  /** Full ride: approach out + matched course + approach back. */
  points: TrackPoint[];
  stats: RouteStats;
  /** Stats of just the matched-course portion (excludes the approach legs) — what's scored against the race. */
  matchedStats: RouteStats;
  /** Actual road distance ridden to reach where the matched course starts. */
  approachDistanceKm: number;
  /** Index range within `points` covering just the matched course (for map styling). */
  matchedRange: { start: number; end: number };
  bearingDeg: number;
  /** Lower is better: relative distance error + relative elevation-gain error, based on matchedStats. */
  score: number;
}

interface RawCandidate {
  fullPoints: LatLon[];
  approachPointCount: number;
  matchedPointCount: number;
  approachDistanceKm: number;
  matchedDistanceKm: number;
  bearingDeg: number;
}

export async function generateCandidateRoutes(options: GenerateOptions): Promise<RouteCandidate[]> {
  const { start, targetDistanceKm, targetElevationGainM, targetProfile } = options;
  const approachDistanceKm = options.approachDistanceKm ?? 0;
  const candidateCount = options.candidateCount ?? 3;
  const bearingSteps = options.bearingSteps ?? 8;

  const oneWayTargetKm = targetDistanceKm / 2;
  // Pad generously since real road paths wind more than the straight-line distance,
  // but cap it so the search area (and graph size) stays bounded for long target distances.
  const MAX_BBOX_RADIUS_KM = 24.14; // 15 miles
  const bboxRadiusKm = Math.min(Math.max((approachDistanceKm + oneWayTargetKm) * 1.5, 1), MAX_BBOX_RADIUS_KM);
  const bbox = boundingBox(start, bboxRadiusKm);

  const ways = await fetchOsmWays(bbox);
  if (ways.length === 0) {
    throw new Error('No road data found near the start location');
  }

  const graph = RouteGraph.fromWays(ways);
  const startNodeId = graph.findClosestNode(start);
  if (!startNodeId) {
    throw new Error('Could not find a road near the start location');
  }

  const targetGradeAt = targetProfile && targetProfile.length > 1 ? buildTargetGradeFn(targetProfile) : null;
  const elevationGrid: ElevationGrid | null = targetGradeAt ? await buildElevationGrid(bbox) : null;

  const rawCandidates: RawCandidate[] =
    elevationGrid && targetGradeAt && targetProfile
      ? generateHillTourCandidates({
          graph,
          startNodeId,
          start,
          approachDistanceKm,
          oneWayTargetKm,
          elevationGrid,
          targetGradeAt,
          targetProfile,
          targetDistanceKm,
          attempts: bearingSteps,
        })
      : generateBearingCandidates({
          graph,
          startNodeId,
          start,
          approachDistanceKm,
          oneWayTargetKm,
          bearingSteps,
        });

  if (rawCandidates.length === 0) {
    throw new Error('Could not generate any candidate routes near the start location');
  }

  // Only spend elevation API calls on candidates that are plausibly close to the target.
  // Asymmetric on purpose: a route that runs long can still be ridden (or trimmed),
  // but one that falls well short can't deliver the target workout at all.
  const withinTolerance = rawCandidates.filter((c) => {
    const ratio = (c.matchedDistanceKm - targetDistanceKm) / targetDistanceKm;
    return ratio >= -MAX_ACCEPTABLE_UNDERSHOOT && ratio <= OVERSHOOT_TOLERANCE;
  });
  const toScore = withinTolerance.length > 0 ? withinTolerance : rawCandidates;

  const scored: RouteCandidate[] = [];
  for (const candidate of toScore) {
    const elevations = await fetchElevations(candidate.fullPoints);
    const trackPoints: TrackPoint[] = candidate.fullPoints.map((p, i) => ({
      lat: p.lat,
      lon: p.lon,
      ele: elevations[i] ?? 0,
    }));
    const stats = computeRouteStats(trackPoints);

    const matchedStartIdx = candidate.approachPointCount > 0 ? candidate.approachPointCount - 1 : 0;
    const matchedTrackPoints = trackPoints.slice(matchedStartIdx, matchedStartIdx + candidate.matchedPointCount);
    const matchedStats = computeRouteStats(matchedTrackPoints);

    const distanceError = relativeDistanceError(matchedStats.distanceKm, targetDistanceKm);
    const elevationError =
      targetElevationGainM > 0
        ? Math.abs(matchedStats.elevationGainM - targetElevationGainM) / targetElevationGainM
        : 0;
    // Two routes can match total distance/elevation gain closely while climbing at
    // completely different points along the way — penalize that mismatch too, so
    // the recommended candidate is the one that actually tracks the target's climbs.
    const shapeError = targetProfile ? profileShapeError(matchedStats.profile, targetProfile) * SHAPE_ERROR_WEIGHT : 0;
    // Totals alone can't tell a few long steady climbs from many short steep ones —
    // compare the climbs themselves, which is what makes the ride train like the race.
    const climbError = targetProfile
      ? climbProfileError(matchedStats.profile, targetProfile) * CLIMB_ERROR_WEIGHT
      : 0;

    scored.push({
      points: trackPoints,
      stats,
      matchedStats,
      approachDistanceKm: candidate.approachDistanceKm,
      matchedRange: { start: matchedStartIdx, end: matchedStartIdx + candidate.matchedPointCount },
      bearingDeg: candidate.bearingDeg,
      score: distanceError + elevationError + shapeError + climbError,
    });
  }

  scored.sort((a, b) => a.score - b.score);
  return dedupeSimilar(scored).slice(0, candidateCount);
}

interface BearingCandidateParams {
  graph: RouteGraph;
  startNodeId: string;
  start: LatLon;
  approachDistanceKm: number;
  oneWayTargetKm: number;
  bearingSteps: number;
}

/** Simple out-and-back candidates along evenly-spaced compass bearings, ignorant of terrain. Used when there's no target profile to steer by, or as a fallback if no hilly terrain is found nearby. */
function generateBearingCandidates(params: BearingCandidateParams): RawCandidate[] {
  const { graph, startNodeId, start, approachDistanceKm, oneWayTargetKm, bearingSteps } = params;
  const rawCandidates: RawCandidate[] = [];

  for (let i = 0; i < bearingSteps; i++) {
    const bearingDeg = (360 / bearingSteps) * i;
    const ringAnchor = approachDistanceKm > 0 ? destinationPoint(start, approachDistanceKm, bearingDeg) : start;

    let ringNodeId = startNodeId;
    let approachPoints: LatLon[] = [];
    let approachActualKm = 0;

    if (approachDistanceKm > 0) {
      const candidateRingNodeId = graph.findClosestNode(ringAnchor);
      if (!candidateRingNodeId || candidateRingNodeId === startNodeId) continue;

      const approachPath = graph.findPath(startNodeId, candidateRingNodeId);
      if (!approachPath) continue;

      ringNodeId = candidateRingNodeId;
      approachPoints = approachPath.points;
      approachActualKm = approachPath.distanceKm;
    }

    const loopWaypoint = destinationPoint(ringAnchor, oneWayTargetKm, bearingDeg);
    const loopWaypointNodeId = graph.findClosestNode(loopWaypoint);
    if (!loopWaypointNodeId || loopWaypointNodeId === ringNodeId) continue;

    const loopOut = graph.findPath(ringNodeId, loopWaypointNodeId);
    if (!loopOut) continue;

    // Penalize the outbound segments on the return leg so the loop mostly avoids backtracking.
    const loopBack = graph.findPath(loopWaypointNodeId, ringNodeId, loopOut.segIds);
    if (!loopBack) continue;

    const matchedPoints = loopOut.points.concat(loopBack.points.slice(1));
    const matchedDistanceKm = loopOut.distanceKm + loopBack.distanceKm;

    const returnPoints = approachPoints.length > 0 ? approachPoints.slice().reverse().slice(1) : [];
    const fullPoints =
      approachPoints.length > 0
        ? approachPoints.concat(matchedPoints.slice(1), returnPoints)
        : matchedPoints;

    rawCandidates.push({
      fullPoints,
      approachPointCount: approachPoints.length,
      matchedPointCount: matchedPoints.length,
      approachDistanceKm: approachActualKm,
      matchedDistanceKm,
      bearingDeg,
    });
  }

  return rawCandidates;
}

interface HillTourParams {
  graph: RouteGraph;
  startNodeId: string;
  start: LatLon;
  approachDistanceKm: number;
  oneWayTargetKm: number;
  elevationGrid: ElevationGrid;
  targetGradeAt: (cumulativeKm: number) => number;
  targetProfile: ProfilePoint[];
  /** Road distance the matched course should cover — the tour grows until it can finish near this. */
  targetDistanceKm: number;
  /** How many different tours to attempt (mirrors bearingSteps for the fallback path). */
  attempts: number;
}

interface HillWaypoint {
  id: string;
  point: LatLon;
  hilliness: number;
}

/**
 * Candidates that chain together several of the hilliest reachable points into a loop,
 * rather than a single out-and-back along a blind compass bearing — so real climbs
 * scattered around the start (in any direction, at any distance within reach) can
 * actually be strung together into a route, instead of only being reachable if they
 * happen to sit on one of a handful of straight lines out from the start.
 */
function generateHillTourCandidates(params: HillTourParams): RawCandidate[] {
  const {
    graph,
    startNodeId,
    start,
    approachDistanceKm,
    oneWayTargetKm,
    elevationGrid,
    targetGradeAt,
    targetDistanceKm,
    attempts,
  } = params;
  const elevationAt = (p: LatLon) => elevationGrid.elevationAt(p);
  const fallback = () =>
    generateBearingCandidates({ graph, startNodeId, start, approachDistanceKm, oneWayTargetKm, bearingSteps: attempts });

  const hilliness = graph.computeHilliness(elevationAt);

  // Only consider genuinely hilly, reachable nodes as tour candidates — keeps the pool small and relevant.
  const HILLY_GRADE_THRESHOLD_PERCENT = 2;
  const MAX_REACH_KM = oneWayTargetKm * 1.4;
  const pool: HillWaypoint[] = [];
  for (const [id, score] of hilliness) {
    if (score < HILLY_GRADE_THRESHOLD_PERCENT) continue;
    const point = graph.getNode(id);
    if (!point) continue;
    const distFromStart = haversineKm(start, point);
    if (distFromStart < 0.5 || distFromStart > MAX_REACH_KM) continue;
    pool.push({ id, point, hilliness: score });
  }
  pool.sort((a, b) => b.hilliness - a.hilliness);

  if (pool.length === 0) return fallback();

  const rawCandidates: RawCandidate[] = [];
  const usedSeeds: HillWaypoint[] = [];

  for (let attempt = 0; attempt < attempts; attempt++) {
    // Spread attempts across different starting hills, skipping ones too close to an already-used seed.
    const seed = pool.find(
      (candidate) =>
        !usedSeeds.includes(candidate) &&
        usedSeeds.every((used) => haversineKm(candidate.point, used.point) >= oneWayTargetKm * 0.2)
    );
    if (!seed) break;
    usedSeeds.push(seed);

    const bearingDeg = initialBearingDeg(start, seed.point);

    const ringAnchor = approachDistanceKm > 0 ? destinationPoint(start, approachDistanceKm, bearingDeg) : start;
    let ringNodeId = startNodeId;
    let approachPoints: LatLon[] = [];
    let approachActualKm = 0;

    if (approachDistanceKm > 0) {
      const candidateRingNodeId = graph.findClosestNode(ringAnchor);
      if (!candidateRingNodeId || candidateRingNodeId === startNodeId) continue;
      const approachPath = graph.findPath(startNodeId, candidateRingNodeId);
      if (!approachPath) continue;
      ringNodeId = candidateRingNodeId;
      approachPoints = approachPath.points;
      approachActualKm = approachPath.distanceKm;
    }

    const ringPoint = graph.getNode(ringNodeId);
    if (!ringPoint) continue;

    // Build the tour leg by leg against *actual road distance*, adding hills until the
    // ride is long enough that heading home lands near the target. Selecting waypoints
    // up front on straight-line distance (as a fixed-size set) systematically produced
    // routes well short of target, since road distance and cluster spread don't match.
    const legPointSets: LatLon[][] = [];
    let cumulativeKm = 0;
    let usedSegIds = new Set<string>();
    let currentNodeId = ringNodeId;
    let currentPoint: LatLon = ringPoint;
    const visited = new Set<string>();
    let tourFailed = false;

    const routeLeg = (fromId: string, toId: string): PathResult | null =>
      graph.findGradeMatchedPath(fromId, toId, {
        elevationAt,
        targetGradeAt,
        startCumulativeKm: cumulativeKm,
        penalizeSegIds: usedSegIds,
      }) ?? graph.findPath(fromId, toId, usedSegIds);

    for (let leg = 0; leg < MAX_TOUR_LEGS; leg++) {
      const remainingKm = targetDistanceKm - cumulativeKm;
      // Road distance home is at least the straight line; pad so we don't overshoot badly.
      if (remainingKm <= haversineKm(currentPoint, ringPoint) * ROAD_WINDING_FACTOR) break;

      const next = pickNextHill({
        pool,
        from: currentPoint,
        ringPoint,
        visited,
        remainingKm,
        preferred: leg === 0 ? seed : undefined,
      });
      if (!next) break;

      const legPath = routeLeg(currentNodeId, next.id);
      if (!legPath) {
        visited.add(next.id);
        continue;
      }

      legPointSets.push(legPath.points);
      cumulativeKm += legPath.distanceKm;
      usedSegIds = new Set([...usedSegIds, ...legPath.segIds]);
      currentNodeId = next.id;
      currentPoint = next.point;
      visited.add(next.id);
    }

    if (currentNodeId !== ringNodeId) {
      const homeLeg = routeLeg(currentNodeId, ringNodeId);
      if (!homeLeg) {
        tourFailed = true;
      } else {
        legPointSets.push(homeLeg.points);
        cumulativeKm += homeLeg.distanceKm;
      }
    }

    if (tourFailed || legPointSets.length === 0) continue;

    const matchedPoints = legPointSets.reduce(
      (acc, points) => (acc.length === 0 ? points : acc.concat(points.slice(1))),
      [] as LatLon[]
    );

    const returnPoints = approachPoints.length > 0 ? approachPoints.slice().reverse().slice(1) : [];
    const fullPoints =
      approachPoints.length > 0
        ? approachPoints.concat(matchedPoints.slice(1), returnPoints)
        : matchedPoints;

    rawCandidates.push({
      fullPoints,
      approachPointCount: approachPoints.length,
      matchedPointCount: matchedPoints.length,
      approachDistanceKm: approachActualKm,
      matchedDistanceKm: cumulativeKm,
      bearingDeg,
    });
  }

  return rawCandidates.length > 0 ? rawCandidates : fallback();
}

/**
 * Next hill to ride to: the hilliest one that's a sensible step away and still leaves
 * enough remaining budget to get back to the finish. Weighs hilliness against the
 * detour it costs, so the tour keeps collecting real climbs instead of either wandering
 * off beyond return range or hugging whatever hill happens to be nearest.
 */
function pickNextHill(params: {
  pool: HillWaypoint[];
  from: LatLon;
  ringPoint: LatLon;
  visited: Set<string>;
  remainingKm: number;
  preferred?: HillWaypoint;
}): HillWaypoint | null {
  const { pool, from, ringPoint, visited, remainingKm, preferred } = params;

  if (preferred && !visited.has(preferred.id)) return preferred;

  let best: HillWaypoint | null = null;
  let bestValue = -Infinity;

  for (const candidate of pool) {
    if (visited.has(candidate.id)) continue;

    const stepKm = haversineKm(from, candidate.point);
    if (stepKm < 0.3) continue;

    // Must still be able to get home afterwards within what's left of the target.
    const homeKm = haversineKm(candidate.point, ringPoint);
    if ((stepKm + homeKm) * ROAD_WINDING_FACTOR > remainingKm) continue;

    const value = candidate.hilliness / (1 + stepKm);
    if (value > bestValue) {
      bestValue = value;
      best = candidate;
    }
  }

  return best;
}

function initialBearingDeg(from: LatLon, to: LatLon): number {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δλ = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Relative distance miss, weighted so falling short of the target hurts far more than running long. */
export function relativeDistanceError(actualKm: number, targetKm: number): number {
  if (targetKm <= 0) return 0;
  const ratio = (actualKm - targetKm) / targetKm;
  return ratio < 0 ? -ratio * DISTANCE_UNDERSHOOT_PENALTY : ratio;
}

function bearingDiffDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// Candidates heading in very different directions are meaningfully different
// routes even when their stats happen to land close together, since scoring
// biases every candidate toward the same target distance/elevation. Only
// collapse candidates that are both stat-similar AND geometrically similar
// (near the same bearing), so the UI isn't left with a single route option.
function dedupeSimilar(candidates: RouteCandidate[]): RouteCandidate[] {
  const result: RouteCandidate[] = [];
  for (const candidate of candidates) {
    const isDuplicate = result.some(
      (existing) =>
        Math.abs(existing.matchedStats.distanceKm - candidate.matchedStats.distanceKm) < 0.05 &&
        Math.abs(existing.matchedStats.elevationGainM - candidate.matchedStats.elevationGainM) < 5 &&
        bearingDiffDeg(existing.bearingDeg, candidate.bearingDeg) < 20
    );
    if (!isDuplicate) result.push(candidate);
  }
  return result;
}
