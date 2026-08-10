import { RouteGraph, type PathResult } from './graph';
import { fetchOsmWays } from './overpass';
import { fetchElevations } from './elevation';
import { buildElevationGrid, type ElevationGrid } from './elevationGrid';
import { destinationPoint, boundingBox, haversineKm, type LatLon } from './geo';
import {
  computeRouteStats,
  buildTargetGradeFn,
  profileShapeError,
  segmentClimbs,
  type TrackPoint,
  type RouteStats,
  type ProfilePoint,
} from './gpx';

// Scales profileShapeError (average absolute grade-percentage-point mismatch, typically
// a few percent) down to be comparable with distanceError/elevationError (unitless
// relative errors, typically 0-0.35), so shape mismatch meaningfully affects ranking
// without swamping the existing distance/elevation-total signal.
const SHAPE_ERROR_WEIGHT = 0.05;

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
  const withinTolerance = rawCandidates.filter(
    (c) => Math.abs(c.matchedDistanceKm - targetDistanceKm) / targetDistanceKm <= 0.35
  );
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

    const distanceError = Math.abs(matchedStats.distanceKm - targetDistanceKm) / targetDistanceKm;
    const elevationError =
      targetElevationGainM > 0
        ? Math.abs(matchedStats.elevationGainM - targetElevationGainM) / targetElevationGainM
        : 0;
    // Two routes can match total distance/elevation gain closely while climbing at
    // completely different points along the way — penalize that mismatch too, so
    // the recommended candidate is the one that actually tracks the target's climbs.
    const shapeError = targetProfile ? profileShapeError(matchedStats.profile, targetProfile) * SHAPE_ERROR_WEIGHT : 0;

    scored.push({
      points: trackPoints,
      stats,
      matchedStats,
      approachDistanceKm: candidate.approachDistanceKm,
      matchedRange: { start: matchedStartIdx, end: matchedStartIdx + candidate.matchedPointCount },
      bearingDeg: candidate.bearingDeg,
      score: distanceError + elevationError + shapeError,
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
  const { graph, startNodeId, start, approachDistanceKm, oneWayTargetKm, elevationGrid, targetGradeAt, targetProfile, attempts } =
    params;
  const elevationAt = (p: LatLon) => elevationGrid.elevationAt(p);
  const fallback = () =>
    generateBearingCandidates({ graph, startNodeId, start, approachDistanceKm, oneWayTargetKm, bearingSteps: attempts });

  const hilliness = graph.computeHilliness(elevationAt);

  // How many separate climbs to try to string together, based on how many the target itself has.
  const numWaypoints = Math.min(Math.max(segmentClimbs(targetProfile).length, 2), 5);

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

    const tourWaypoints = buildHillTour(pool, seed, oneWayTargetKm, numWaypoints);
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

    const legStops = [ringNodeId, ...tourWaypoints.map((w) => w.id), ringNodeId];
    const legPointSets: LatLon[][] = [];
    let cumulativeKm = 0;
    let usedSegIds = new Set<string>();
    let tourFailed = false;

    for (let i = 0; i < legStops.length - 1; i++) {
      const fromId = legStops[i];
      const toId = legStops[i + 1];
      if (fromId === toId) continue;

      const leg: PathResult | null =
        graph.findGradeMatchedPath(fromId, toId, {
          elevationAt,
          targetGradeAt,
          startCumulativeKm: cumulativeKm,
          penalizeSegIds: usedSegIds,
        }) ?? graph.findPath(fromId, toId, usedSegIds);

      if (!leg) {
        tourFailed = true;
        break;
      }

      legPointSets.push(leg.points);
      cumulativeKm += leg.distanceKm;
      usedSegIds = new Set([...usedSegIds, ...leg.segIds]);
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

/** Greedy nearest-neighbor tour through hilly waypoints, starting from `seed`, bounded to roughly a one-way trip's worth of distance. */
function buildHillTour(pool: HillWaypoint[], seed: HillWaypoint, oneWayTargetKm: number, numWaypoints: number): HillWaypoint[] {
  const chosen: HillWaypoint[] = [seed];
  let current = seed.point;
  let cumulativeKm = 0;
  const remaining = pool.filter((c) => c.id !== seed.id);
  const maxTourKm = oneWayTargetKm * 1.4;

  while (chosen.length < numWaypoints && remaining.length > 0) {
    let bestIdx = -1;
    let bestDistKm = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(current, remaining[i].point);
      if (d < bestDistKm) {
        bestDistKm = d;
        bestIdx = i;
      }
    }
    if (bestIdx === -1 || cumulativeKm + bestDistKm > maxTourKm) break;

    const next = remaining[bestIdx];
    chosen.push(next);
    cumulativeKm += bestDistKm;
    current = next.point;
    remaining.splice(bestIdx, 1);
  }

  return chosen;
}

function initialBearingDeg(from: LatLon, to: LatLon): number {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δλ = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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
