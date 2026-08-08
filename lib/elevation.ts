import type { LatLon } from './geo';

interface ElevationProvider {
  name: string;
  batchSize: number;
  fetch(points: LatLon[]): Promise<number[]>;
}

const OpenTopoDataProvider: ElevationProvider = {
  name: 'Open Topo Data',
  batchSize: 100,
  async fetch(points) {
    const locations = points.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|');
    const res = await fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${locations}`);
    if (!res.ok) throw new Error(`Open Topo Data HTTP ${res.status}`);
    const data = await res.json();
    if (!data.results) throw new Error('Open Topo Data: malformed response');
    return data.results.map((r: { elevation: number }) => r.elevation);
  },
};

const OpenMeteoProvider: ElevationProvider = {
  name: 'Open-Meteo',
  batchSize: 500,
  async fetch(points) {
    const lats = points.map((p) => p.lat.toFixed(6)).join(',');
    const lons = points.map((p) => p.lon.toFixed(6)).join(',');
    const res = await fetch(
      `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`
    );
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const data = await res.json();
    if (!data.elevation) throw new Error('Open-Meteo: malformed response');
    return data.elevation;
  },
};

const PROVIDERS = [OpenTopoDataProvider, OpenMeteoProvider];

async function fetchBatchWithRetry(
  provider: ElevationProvider,
  points: LatLon[],
  maxRetries = 2
): Promise<number[]> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await provider.fetch(points);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    }
  }
  throw new Error('unreachable');
}

/** Elevations (meters) for each point, tried against providers in order until one succeeds fully. */
export async function fetchElevations(points: LatLon[]): Promise<number[]> {
  if (points.length === 0) return [];

  let lastError: unknown;
  for (const provider of PROVIDERS) {
    try {
      const elevations: number[] = [];
      for (let i = 0; i < points.length; i += provider.batchSize) {
        const batch = points.slice(i, i + provider.batchSize);
        elevations.push(...(await fetchBatchWithRetry(provider, batch)));
      }
      return elevations;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('All elevation providers failed');
}
