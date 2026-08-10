import type { LatLon } from './geo';

interface ElevationProvider {
  name: string;
  batchSize: number;
  /** How many batches may be in flight at once. Public APIs like Open Topo Data rate-limit aggressively, so keep this low for them. */
  maxConcurrentBatches: number;
  fetch(points: LatLon[]): Promise<number[]>;
}

const OpenTopoDataProvider: ElevationProvider = {
  name: 'Open Topo Data',
  batchSize: 100,
  maxConcurrentBatches: 1,
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
  maxConcurrentBatches: 6,
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
// For coarse, high-volume lookups (e.g. a routing elevation grid) precision matters less than
// round-trip count, so prefer the provider with the larger batch size.
const COARSE_PROVIDERS = [OpenMeteoProvider, OpenTopoDataProvider];

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

/** Runs `fn` over `items`, at most `maxConcurrent` at a time, preserving result order. */
async function mapWithConcurrency<T, R>(items: T[], maxConcurrent: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxConcurrent, items.length) }, worker));
  return results;
}

async function fetchWithProviders(points: LatLon[], providers: ElevationProvider[]): Promise<number[]> {
  if (points.length === 0) return [];

  let lastError: unknown;
  for (const provider of providers) {
    try {
      const batches: LatLon[][] = [];
      for (let i = 0; i < points.length; i += provider.batchSize) {
        batches.push(points.slice(i, i + provider.batchSize));
      }
      const results = await mapWithConcurrency(batches, provider.maxConcurrentBatches, (batch) =>
        fetchBatchWithRetry(provider, batch)
      );
      return results.flat();
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('All elevation providers failed');
}

/** Elevations (meters) for each point, tried against providers in order until one succeeds fully. */
export async function fetchElevations(points: LatLon[]): Promise<number[]> {
  return fetchWithProviders(points, PROVIDERS);
}

/** Like `fetchElevations`, but prefers larger-batch (fewer round-trip) providers for bulk/coarse lookups. */
export async function fetchElevationsCoarse(points: LatLon[]): Promise<number[]> {
  return fetchWithProviders(points, COARSE_PROVIDERS);
}
