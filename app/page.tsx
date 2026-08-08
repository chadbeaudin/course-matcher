'use client';

import { useState } from 'react';
import { parseGpx, computeRouteStats, type RouteStats } from '@/lib/gpx';
import ElevationProfileChart from '@/components/ElevationProfileChart';

export default function Home() {
  const [stats, setStats] = useState<RouteStats | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setFileName(file.name);

    try {
      const text = await file.text();
      const points = parseGpx(text);
      setStats(computeRouteStats(points));
    } catch (err) {
      setStats(null);
      setError(err instanceof Error ? err.message : 'Failed to parse GPX file');
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold">course-matcher</h1>
      <p className="mt-2 text-gray-600">
        Upload your race&apos;s GPX file to see its distance and elevation profile.
      </p>

      <div className="mt-8">
        <label className="block w-fit cursor-pointer rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50">
          Upload race GPX
          <input type="file" accept=".gpx" className="hidden" onChange={handleFileChange} />
        </label>
        {fileName && <p className="mt-2 text-sm text-gray-500">{fileName}</p>}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {stats && (
        <div className="mt-8">
          <div className="grid grid-cols-3 gap-4 text-center">
            <Stat label="Distance" value={`${stats.distanceKm.toFixed(1)} km`} />
            <Stat label="Elevation gain" value={`${Math.round(stats.elevationGainM)} m`} />
            <Stat label="Climb segments" value={String(stats.climbSegments.length)} />
          </div>

          <div className="mt-6">
            <ElevationProfileChart profile={stats.profile} />
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 py-3">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
