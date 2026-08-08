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
}

function nodeIdFor(way: OSMWay, index: number): string {
  const osmNodeId = way.nodes[index];
  return osmNodeId !== undefined ? String(osmNodeId) : `${way.id}:${index}`;
}
