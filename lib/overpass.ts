export interface OSMWay {
  id: number;
  nodes: number[];
  geometry: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

interface OverpassElement {
  type: 'node' | 'way';
  id: number;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

const OVERPASS_URL = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';

// Roads/trails suitable for cycling or running training routes.
const HIGHWAY_FILTER =
  'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|' +
  'motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|track|cycleway|path|footway';

const TILE_DEG = 0.01;

function snapToTileGrid(bbox: BoundingBox): BoundingBox {
  return {
    south: Math.floor(bbox.south / TILE_DEG) * TILE_DEG,
    west: Math.floor(bbox.west / TILE_DEG) * TILE_DEG,
    north: Math.ceil(bbox.north / TILE_DEG) * TILE_DEG,
    east: Math.ceil(bbox.east / TILE_DEG) * TILE_DEG,
  };
}

function cacheKey(bbox: BoundingBox): string {
  return `${bbox.south.toFixed(4)},${bbox.west.toFixed(4)},${bbox.north.toFixed(4)},${bbox.east.toFixed(4)}`;
}

const cache = new Map<string, OSMWay[]>();

export async function fetchOsmWays(bbox: BoundingBox): Promise<OSMWay[]> {
  const snapped = snapToTileGrid(bbox);
  const key = cacheKey(snapped);
  const cached = cache.get(key);
  if (cached) return cached;

  const query = `
    [out:json][timeout:60];
    way["highway"~"${HIGHWAY_FILTER}"]["access"!~"private|no"]
       (${snapped.south},${snapped.west},${snapped.north},${snapped.east});
    out geom;
  `;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let response: Response;
  try {
    response = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': 'course-matcher/0.1 (local development)',
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Overpass request failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as OverpassResponse;
  const ways: OSMWay[] = data.elements
    .filter((el): el is OverpassElement & { type: 'way'; nodes: number[]; geometry: { lat: number; lon: number }[] } =>
      el.type === 'way' && !!el.nodes && !!el.geometry
    )
    .map((el) => ({ id: el.id, nodes: el.nodes, geometry: el.geometry, tags: el.tags }));

  cache.set(key, ways);
  return ways;
}

export function clearOverpassCache() {
  cache.clear();
}
