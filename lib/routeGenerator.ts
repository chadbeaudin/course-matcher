import { RouteGraph } from './graph';
import { fetchOsmWays } from './overpass';
import { fetchElevations } from './elevation';
import { destinationPoint, boundingBox, type LatLon } from './geo';
import { computeRouteStats, type TrackPoint, type RouteStats } from './gpx';

export interface GenerateOptions {
  start: LatLon;
  targetDistanceKm: number;
  targetElevationGainM: number;
  candidateCount?: number;
  bearingSteps?: number;
}

export interface RouteCandidate {
  points: TrackPoint[];
  stats: RouteStats;
  bearingDeg: number;
  /** Lower is better: relative distance error + relative elevation-gain error. */
  score: number;
}

export async function generateCandidateRoutes(options: GenerateOptions): Promise<RouteCandidate[]> {
  const { start, targetDistanceKm, targetElevationGainM } = options;
  const candidateCount = options.candidateCount ?? 3;
  const bearingSteps = options.bearingSteps ?? 8;

  const oneWayTargetKm = targetDistanceKm / 2;
  // Pad generously since real road paths wind more than the straight-line distance.
  const bboxRadiusKm = Math.max(oneWayTargetKm * 1.6, 1);

  const ways = await fetchOsmWays(boundingBox(start, bboxRadiusKm));
  if (ways.length === 0) {
    throw new Error('No road data found near the start location');
  }

  const graph = RouteGraph.fromWays(ways);
  const startNodeId = graph.findClosestNode(start);
  if (!startNodeId) {
    throw new Error('Could not find a road near the start location');
  }

  const rawCandidates: { points: LatLon[]; distanceKm: number; bearingDeg: number }[] = [];

  for (let i = 0; i < bearingSteps; i++) {
    const bearingDeg = (360 / bearingSteps) * i;
    const waypoint = destinationPoint(start, oneWayTargetKm, bearingDeg);
    const waypointNodeId = graph.findClosestNode(waypoint);
    if (!waypointNodeId || waypointNodeId === startNodeId) continue;

    const outbound = graph.findPath(startNodeId, waypointNodeId);
    if (!outbound) continue;

    // Penalize the outbound segments on the return leg so the loop mostly avoids backtracking.
    const inbound = graph.findPath(waypointNodeId, startNodeId, outbound.segIds);
    if (!inbound) continue;

    rawCandidates.push({
      points: outbound.points.concat(inbound.points.slice(1)),
      distanceKm: outbound.distanceKm + inbound.distanceKm,
      bearingDeg,
    });
  }

  if (rawCandidates.length === 0) {
    throw new Error('Could not generate any candidate routes near the start location');
  }

  // Only spend elevation API calls on candidates that are plausibly close to the target.
  const withinTolerance = rawCandidates.filter(
    (c) => Math.abs(c.distanceKm - targetDistanceKm) / targetDistanceKm <= 0.35
  );
  const toScore = withinTolerance.length > 0 ? withinTolerance : rawCandidates;

  const scored: RouteCandidate[] = [];
  for (const candidate of toScore) {
    const elevations = await fetchElevations(candidate.points);
    const trackPoints: TrackPoint[] = candidate.points.map((p, i) => ({
      lat: p.lat,
      lon: p.lon,
      ele: elevations[i] ?? 0,
    }));
    const stats = computeRouteStats(trackPoints);

    const distanceError = Math.abs(stats.distanceKm - targetDistanceKm) / targetDistanceKm;
    const elevationError =
      targetElevationGainM > 0
        ? Math.abs(stats.elevationGainM - targetElevationGainM) / targetElevationGainM
        : 0;

    scored.push({
      points: trackPoints,
      stats,
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
        Math.abs(existing.stats.distanceKm - candidate.stats.distanceKm) < 0.05 &&
        Math.abs(existing.stats.elevationGainM - candidate.stats.elevationGainM) < 5
    );
    if (!isDuplicate) result.push(candidate);
  }
  return result;
}
