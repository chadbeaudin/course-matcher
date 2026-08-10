import createGraph, { Graph, Link } from 'ngraph.graph';
import path from 'ngraph.path';
import { haversineKm, type LatLon } from './geo';
import type { OSMWay } from './overpass';

interface NodeData {
  lat: number;
  lon: number;
}

interface EdgeData {
  segId: string;
  distanceKm: number;
}

export interface PathResult {
  points: LatLon[];
  segIds: Set<string>;
  distanceKm: number;
}

export class RouteGraph {
  private graph: Graph<NodeData, EdgeData> = createGraph();

  static fromWays(ways: OSMWay[]): RouteGraph {
    const routeGraph = new RouteGraph();

    for (const way of ways) {
      for (let i = 0; i < way.geometry.length - 1; i++) {
        const a = way.geometry[i];
        const b = way.geometry[i + 1];
        const uId = nodeIdFor(way, i);
        const vId = nodeIdFor(way, i + 1);

        if (!routeGraph.graph.hasNode(uId)) routeGraph.graph.addNode(uId, { lat: a.lat, lon: a.lon });
        if (!routeGraph.graph.hasNode(vId)) routeGraph.graph.addNode(vId, { lat: b.lat, lon: b.lon });

        const distanceKm = haversineKm(a, b);
        if (distanceKm === 0) continue;

        const segId = uId < vId ? `${uId}--${vId}` : `${vId}--${uId}`;
        routeGraph.graph.addLink(uId, vId, { segId, distanceKm });
        routeGraph.graph.addLink(vId, uId, { segId, distanceKm });
      }
    }

    return routeGraph;
  }

  get nodeCount(): number {
    return this.graph.getNodesCount();
  }

  getNode(id: string): LatLon | null {
    const node = this.graph.getNode(id);
    return node ? { lat: node.data.lat, lon: node.data.lon } : null;
  }

  findClosestNode(point: LatLon): string | null {
    let closestId: string | null = null;
    let closestDistanceKm = Infinity;

    this.graph.forEachNode((node) => {
      const distanceKm = haversineKm(point, node.data);
      if (distanceKm < closestDistanceKm) {
        closestDistanceKm = distanceKm;
        closestId = String(node.id);
      }
    });

    return closestId;
  }

  /**
   * For every node, the average absolute grade (%) across its immediate road
   * edges — a cheap proxy for how hilly the area right around it is, using
   * only real road connectivity (no separate spatial search needed). Used to
   * pick waypoints that actually sit on climbs, rather than a blind bearing.
   */
  computeHilliness(elevationAt: (point: LatLon) => number): Map<string, number> {
    const scores = new Map<string, number>();
    const elevCache = new Map<string, number>();
    const elevationOf = (id: string, data: NodeData): number => {
      let e = elevCache.get(id);
      if (e === undefined) {
        e = elevationAt({ lat: data.lat, lon: data.lon });
        elevCache.set(id, e);
      }
      return e;
    };

    this.graph.forEachNode((node) => {
      const nodeId = String(node.id);
      const nodeElevation = elevationOf(nodeId, node.data);
      let sumAbsGrade = 0;
      let count = 0;

      this.graph.forEachLinkedNode(
        nodeId,
        (linkedNode, link: Link<EdgeData>) => {
          const distanceKm = link.data.distanceKm;
          if (distanceKm === 0) return;
          const grade =
            ((elevationOf(String(linkedNode.id), linkedNode.data) - nodeElevation) / (distanceKm * 1000)) * 100;
          sumAbsGrade += Math.abs(grade);
          count++;
        },
        true
      );

      if (count > 0) scores.set(nodeId, sumAbsGrade / count);
    });

    return scores;
  }

  /**
   * Shortest path between two nodes. `penalizeSegIds` discourages (but doesn't
   * forbid) reusing those segments — used to route a loop's return leg away
   * from its outbound leg without needing full no-repeat-edge routing.
   */
  findPath(fromId: string, toId: string, penalizeSegIds?: Set<string>): PathResult | null {
    const fromNode = this.graph.getNode(fromId);
    if (!fromNode || !this.graph.getNode(toId)) return null;

    if (fromId === toId) {
      return { points: [{ lat: fromNode.data.lat, lon: fromNode.data.lon }], segIds: new Set(), distanceKm: 0 };
    }

    const finder = path.aStar(this.graph, {
      oriented: true,
      distance: (_from, _to, link: Link<EdgeData>) => {
        const base = link.data.distanceKm;
        return penalizeSegIds?.has(link.data.segId) ? base * 8 : base;
      },
      heuristic: (from, to) => haversineKm(from.data, to.data),
    });

    const foundNodes = finder.find(fromId, toId);
    if (foundNodes.length === 0) return null;

    // ngraph.path returns nodes ordered from `toId` back to `fromId`.
    const orderedNodes = foundNodes.slice().reverse();
    const points = orderedNodes.map((node) => ({ lat: node.data.lat, lon: node.data.lon }));

    const segIds = new Set<string>();
    let distanceKm = 0;
    for (let i = 0; i < orderedNodes.length - 1; i++) {
      const link = this.graph.getLink(orderedNodes[i].id, orderedNodes[i + 1].id);
      if (link) {
        segIds.add(link.data.segId);
        distanceKm += link.data.distanceKm;
      }
    }

    return { points, segIds, distanceKm };
  }

  /**
   * Like `findPath`, but biases the search toward matching `targetGradeAt` — the
   * target elevation profile's local grade (%) at a given cumulative distance
   * (km) into this leg — rather than pure shortest distance. Undershooting a
   * climb the target calls for is penalized; overshooting it is free, so the
   * search prefers a bigger climb over a smaller one when it can't match exactly.
   */
  findGradeMatchedPath(
    fromId: string,
    toId: string,
    options: {
      elevationAt: (point: LatLon) => number;
      targetGradeAt: (cumulativeKm: number) => number;
      startCumulativeKm?: number;
      penalizeSegIds?: Set<string>;
    }
  ): PathResult | null {
    const fromNode = this.graph.getNode(fromId);
    const toNode = this.graph.getNode(toId);
    if (!fromNode || !toNode) return null;

    if (fromId === toId) {
      return { points: [{ lat: fromNode.data.lat, lon: fromNode.data.lon }], segIds: new Set(), distanceKm: 0 };
    }

    const { elevationAt, targetGradeAt, penalizeSegIds, startCumulativeKm = 0 } = options;
    // Coarse enough to keep the (node × distance-bucket) state space tractable
    // on a large road graph, fine enough to still distinguish separate climbs.
    // Scaled to the leg's own length so long legs don't multiply the bucket
    // count (and therefore search time) linearly with distance.
    const legDistanceKm = haversineKm(fromNode.data, toNode.data);
    const BUCKET_KM = Math.max(1, legDistanceKm / 12);
    // Every real km of undershoot on a wanted climb costs as much as this many extra km of detour.
    const UNDERSHOOT_PENALTY_PER_PERCENT = 0.15;
    // Caps how expensive a single undershooting edge can look, so one steep
    // mismatch can't blow up the cost surface and defeat the A* heuristic.
    const MAX_PENALTY_FACTOR = 3;
    const CLIMB_GRADE_THRESHOLD_PERCENT = 1.5;
    // Safety valve: abandon the search (candidate bearing is skipped) rather
    // than let a pathological graph stall route generation.
    const MAX_SETTLED_STATES = 12000;

    const elevCache = new Map<string, number>();
    const elevationOf = (id: string, data: NodeData): number => {
      let e = elevCache.get(id);
      if (e === undefined) {
        e = elevationAt({ lat: data.lat, lon: data.lon });
        elevCache.set(id, e);
      }
      return e;
    };

    const heap = new MinHeap<{ nodeId: string; cumKm: number }>();
    const bestCost = new Map<string, number>();
    const cameFrom = new Map<string, { nodeId: string; cumKm: number }>();
    // The heap's priority is f = g + heuristic (for ordering only); the true
    // running cost g for each state lives in `bestCost`, looked up after pop.
    const settled = new Set<string>();

    const startKey = `${fromId}|${bucketOf(startCumulativeKm, BUCKET_KM)}`;
    bestCost.set(startKey, 0);
    heap.push(0, { nodeId: fromId, cumKm: startCumulativeKm });

    let goalState: { nodeId: string; cumKm: number } | null = null;

    while (heap.size > 0) {
      if (settled.size >= MAX_SETTLED_STATES) break;

      const { value: current } = heap.pop()!;
      const currentKey = `${current.nodeId}|${bucketOf(current.cumKm, BUCKET_KM)}`;
      if (settled.has(currentKey)) continue;
      settled.add(currentKey);
      const costSoFar = bestCost.get(currentKey)!;

      if (current.nodeId === toId) {
        goalState = current;
        break;
      }

      const currentNode = this.graph.getNode(current.nodeId);
      if (!currentNode) continue;
      const currentElevation = elevationOf(current.nodeId, currentNode.data);

      this.graph.forEachLinkedNode(
        current.nodeId,
        (linkedNode, link: Link<EdgeData>) => {
          const edgeDistanceKm = link.data.distanceKm;
          if (edgeDistanceKm === 0) return;

          const midCumKm = current.cumKm + edgeDistanceKm / 2;
          const targetGrade = targetGradeAt(midCumKm);
          const actualGrade =
            ((elevationOf(String(linkedNode.id), linkedNode.data) - currentElevation) / (edgeDistanceKm * 1000)) *
            100;

          let penaltyFactor = 0;
          if (targetGrade >= CLIMB_GRADE_THRESHOLD_PERCENT && actualGrade < targetGrade) {
            penaltyFactor = Math.min(
              (targetGrade - actualGrade) * UNDERSHOOT_PENALTY_PER_PERCENT,
              MAX_PENALTY_FACTOR
            );
          }

          let edgeCost = edgeDistanceKm * (1 + penaltyFactor);
          if (penalizeSegIds?.has(link.data.segId)) edgeCost *= 8;

          const nextCumKm = current.cumKm + edgeDistanceKm;
          const nextKey = `${linkedNode.id}|${bucketOf(nextCumKm, BUCKET_KM)}`;
          const nextCost = costSoFar + edgeCost;

          if (nextCost < (bestCost.get(nextKey) ?? Infinity)) {
            bestCost.set(nextKey, nextCost);
            cameFrom.set(nextKey, current);
            const heuristic = haversineKm(linkedNode.data, toNode.data);
            heap.push(nextCost + heuristic, { nodeId: String(linkedNode.id), cumKm: nextCumKm });
          }
        },
        true
      );
    }

    if (!goalState) return null;

    // Reconstruct the path of (nodeId, cumKm) states back to the start.
    const chain: { nodeId: string; cumKm: number }[] = [goalState];
    let key = `${goalState.nodeId}|${bucketOf(goalState.cumKm, BUCKET_KM)}`;
    let prev = cameFrom.get(key);
    while (prev) {
      chain.push(prev);
      key = `${prev.nodeId}|${bucketOf(prev.cumKm, BUCKET_KM)}`;
      prev = cameFrom.get(key);
    }
    chain.reverse();

    const points: LatLon[] = [];
    const segIds = new Set<string>();
    let distanceKm = 0;
    for (let i = 0; i < chain.length; i++) {
      const node = this.graph.getNode(chain[i].nodeId);
      if (node) points.push({ lat: node.data.lat, lon: node.data.lon });
      if (i > 0) {
        const link = this.graph.getLink(chain[i - 1].nodeId, chain[i].nodeId);
        if (link) {
          segIds.add(link.data.segId);
          distanceKm += link.data.distanceKm;
        }
      }
    }

    return { points, segIds, distanceKm };
  }
}

function bucketOf(cumKm: number, bucketKm: number): number {
  return Math.floor(cumKm / bucketKm);
}

/** Minimal binary min-heap keyed by a numeric priority. */
class MinHeap<T> {
  private items: { priority: number; value: T }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(priority: number, value: T): void {
    this.items.push({ priority, value });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop(): { priority: number; value: T } | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = i * 2 + 2;
        let smallest = i;
        if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) smallest = left;
        if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) smallest = right;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

function nodeIdFor(way: OSMWay, index: number): string {
  const osmNodeId = way.nodes[index];
  return osmNodeId !== undefined ? String(osmNodeId) : `${way.id}:${index}`;
}
