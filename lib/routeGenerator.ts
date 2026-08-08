import { RouteGraph } from './graph';
import { fetchOsmWays } from './overpass';
import { fetchElevations } from './elevation';
import { destinationPoint, boundingBox, type LatLon } from './geo';
import { computeRouteStats, type TrackPoint, type RouteStats } from './gpx';

export interface GenerateOptions {
  start: LatLon;
  targetDistanceKm: number;
  targetElevationGainM: number;
  /** Minimum distance to ride out from the start before the matched course begins (e.g. to clear a city). Default 0. */
  approachDistanceKm?: number;
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
  const { start, targetDistanceKm, targetElevationGainM } = options;
  const approachDistanceKm = options.approachDistanceKm ?? 0;
  const candidateCount = options.candidateCount ?? 3;
  const bearingSteps = options.bearingSteps ?? 8;

  const oneWayTargetKm = targetDistanceKm / 2;
  // Pad generously since real road paths wind more than the straight-line distance.
  const bboxRadiusKm = Math.max((approachDistanceKm + oneWayTargetKm) * 1.5, 1);

  const ways = await fetchOsmWays(boundingBox(start, bboxRadiusKm));
  if (ways.length === 0) {
    throw new Error('No road data found near the start location');
  }

  const graph = RouteGraph.fromWays(ways);
  const startNodeId = graph.findClosestNode(start);
  if (!startNodeId) {
    throw new Error('Could not find a road near the start location');
  }

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

    scored.push({
      points: trackPoints,
      stats,
      matchedStats,
      approachDistanceKm: candidate.approachDistanceKm,
      matchedRange: { start: matchedStartIdx, end: matchedStartIdx + candidate.matchedPointCount },
      bearingDeg: candidate.bearingDeg,
      score: distanceError + elevationError,
    });
  }

  scored.sort((a, b) => a.score - b.score);
  return dedupeSimilar(scored).slice(0, candidateCount);
}

function dedupeSimilar(candidates: RouteCandidate[]): RouteCandidate[] {
  const result: RouteCandidate[] = [];
  for (const candidate of candidates) {
    const isDuplicate = result.some(
      (existing) =>
        Math.abs(existing.matchedStats.distanceKm - candidate.matchedStats.distanceKm) < 0.05 &&
        Math.abs(existing.matchedStats.elevationGainM - candidate.matchedStats.elevationGainM) < 5
    );
    if (!isDuplicate) result.push(candidate);
  }
  return result;
}
