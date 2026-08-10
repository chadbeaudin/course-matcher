import type { BoundingBox } from './overpass';
import { fetchElevationsCoarse } from './elevation';
import type { LatLon } from './geo';

// Caps the number of elevation API calls for a single generate request
// regardless of how large the search bounding box is.
const MAX_GRID_POINTS = 2500;

export interface ElevationGrid {
  elevationAt(point: LatLon): number;
}

/** A coarse, cached elevation surface over `bbox`, sampled on a regular grid and looked up by nearest cell. */
export async function buildElevationGrid(bbox: BoundingBox): Promise<ElevationGrid> {
  const latSpan = Math.max(bbox.north - bbox.south, 1e-6);
  const lonSpan = Math.max(bbox.east - bbox.west, 1e-6);
  const aspect = lonSpan / latSpan;

  const rows = Math.max(2, Math.round(Math.sqrt(MAX_GRID_POINTS / aspect)));
  const cols = Math.max(2, Math.round(MAX_GRID_POINTS / rows));
  const latStep = latSpan / (rows - 1);
  const lonStep = lonSpan / (cols - 1);

  const points: LatLon[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push({ lat: bbox.south + r * latStep, lon: bbox.west + c * lonStep });
    }
  }

  const elevations = await fetchElevationsCoarse(points);

  return {
    elevationAt({ lat, lon }: LatLon): number {
      const r = Math.min(rows - 1, Math.max(0, Math.round((lat - bbox.south) / latStep)));
      const c = Math.min(cols - 1, Math.max(0, Math.round((lon - bbox.west) / lonStep)));
      return elevations[r * cols + c] ?? 0;
    },
  };
}
