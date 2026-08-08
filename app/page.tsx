'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { parseGpx, computeRouteStats, type RouteStats } from '@/lib/gpx';
import type { RouteCandidate } from '@/lib/routeGenerator';
import {
  type UnitSystem,
  detectDefaultUnitSystem,
  loadStoredUnitSystem,
  storeUnitSystem,
  formatDistance,
  formatElevation,
} from '@/lib/units';
import { type Theme, detectDefaultTheme, loadStoredTheme, storeTheme, applyTheme } from '@/lib/theme';
import ElevationProfileChart from '@/components/ElevationProfileChart';

const MapView = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
      Loading map…
    </div>
  ),
});

const DEFAULT_MAP_CENTER: [number, number] = [39.7392, -104.9903];

interface StartPoint {
  lat: number;
  lon: number;
}

export default function Home() {
  const [stats, setStats] = useState<RouteStats | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('metric');
  const [theme, setTheme] = useState<Theme>('light');

  const [startPoint, setStartPoint] = useState<StartPoint | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RouteCandidate[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setUnitSystem(loadStoredUnitSystem() ?? detectDefaultUnitSystem());
    setTheme(loadStoredTheme() ?? detectDefaultTheme());
  }, []);

  function handleUnitChange(system: UnitSystem) {
    setUnitSystem(system);
    storeUnitSystem(system);
  }

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    storeTheme(next);
    applyTheme(next);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setFileName(file.name);
    setCandidates(null);
    setGenerateError(null);

    try {
      const text = await file.text();
      const points = parseGpx(text);
      setStats(computeRouteStats(points));
    } catch (err) {
      setStats(null);
      setError(err instanceof Error ? err.message : 'Failed to parse GPX file');
    }
  }

  function handleUseMyLocation() {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported in this browser');
      return;
    }
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => setStartPoint({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setGeoError('Could not get your location')
    );
  }

  async function handleGenerate() {
    if (!startPoint || !stats) return;

    setGenerating(true);
    setGenerateError(null);
    setCandidates(null);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startLat: startPoint.lat,
          startLon: startPoint.lon,
          targetDistanceKm: stats.distanceKm,
          targetElevationGainM: stats.elevationGainM,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Route generation failed');

      setCandidates(data.candidates);
      setSelectedIndex(0);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Route generation failed');
    } finally {
      setGenerating(false);
    }
  }

  const selectedCandidate = candidates?.[selectedIndex] ?? null;
  const mapCenter: [number, number] = startPoint
    ? [startPoint.lat, startPoint.lon]
    : DEFAULT_MAP_CENTER;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="fixed right-4 top-4 z-10">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">course-matcher</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Upload your race&apos;s GPX file to see its distance and elevation profile.
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <UnitToggle unitSystem={unitSystem} onChange={handleUnitChange} />
        </div>
      </div>

      <div className="mt-8">
        <label className="block w-fit cursor-pointer rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900">
          Upload race GPX
          <input type="file" accept=".gpx" className="hidden" onChange={handleFileChange} />
        </label>
        {fileName && <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{fileName}</p>}
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {stats && (
        <div className="mt-8">
          <div className="grid grid-cols-3 gap-4 text-center">
            <Stat label="Distance" value={formatDistance(stats.distanceKm, unitSystem)} />
            <Stat
              label="Elevation gain"
              value={formatElevation(stats.elevationGainM, unitSystem)}
            />
            <Stat label="Climb segments" value={String(stats.climbSegments.length)} />
          </div>

          <div className="mt-6">
            <ElevationProfileChart profile={stats.profile} unitSystem={unitSystem} theme={theme} />
          </div>
        </div>
      )}

      {stats && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold">Start location</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Click the map or use your location to set where the generated route should start.
          </p>

          <button
            type="button"
            onClick={handleUseMyLocation}
            className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            Use my location
          </button>
          {geoError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{geoError}</p>}

          <div className="mt-3 h-72 overflow-hidden rounded-md border border-gray-300 dark:border-gray-700">
            <MapView
              center={mapCenter}
              markerPosition={startPoint ? [startPoint.lat, startPoint.lon] : null}
              onMapClick={(lat, lon) => setStartPoint({ lat, lon })}
            />
          </div>

          <button
            type="button"
            disabled={!startPoint || generating}
            onClick={handleGenerate}
            className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            {generating ? 'Generating route…' : 'Generate route'}
          </button>
          {generateError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{generateError}</p>
          )}
        </div>
      )}

      {candidates && candidates.length > 0 && selectedCandidate && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold">Candidate routes</h2>

          <div className="mt-3 flex flex-wrap gap-2">
            {candidates.map((candidate, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSelectedIndex(i)}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  i === selectedIndex
                    ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
                    : 'border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900'
                }`}
              >
                {formatDistance(candidate.stats.distanceKm, unitSystem)} ·{' '}
                {formatElevation(candidate.stats.elevationGainM, unitSystem)}
              </button>
            ))}
          </div>

          <div className="mt-4 h-72 overflow-hidden rounded-md border border-gray-300 dark:border-gray-700">
            <MapView
              center={mapCenter}
              markerPosition={startPoint ? [startPoint.lat, startPoint.lon] : null}
              route={selectedCandidate.points.map((p) => [p.lat, p.lon])}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 text-center">
            <Stat
              label="Distance"
              value={formatDistance(selectedCandidate.stats.distanceKm, unitSystem)}
            />
            <Stat
              label="Elevation gain"
              value={formatElevation(selectedCandidate.stats.elevationGainM, unitSystem)}
            />
          </div>

          <div className="mt-6">
            <ElevationProfileChart
              profile={selectedCandidate.stats.profile}
              unitSystem={unitSystem}
              theme={theme}
            />
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 py-3 dark:border-gray-800">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}

function UnitToggle({
  unitSystem,
  onChange,
}: {
  unitSystem: UnitSystem;
  onChange: (system: UnitSystem) => void;
}) {
  return (
    <div className="flex rounded-md border border-gray-300 text-sm dark:border-gray-700">
      <button
        type="button"
        onClick={() => onChange('metric')}
        className={`px-3 py-1.5 rounded-l-md ${
          unitSystem === 'metric'
            ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
            : 'hover:bg-gray-50 dark:hover:bg-gray-900'
        }`}
      >
        km
      </button>
      <button
        type="button"
        onClick={() => onChange('imperial')}
        className={`px-3 py-1.5 rounded-r-md border-l border-gray-300 dark:border-gray-700 ${
          unitSystem === 'imperial'
            ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
            : 'hover:bg-gray-50 dark:hover:bg-gray-900'
        }`}
      >
        mi
      </button>
    </div>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
    >
      {theme === 'dark' ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      )}
    </button>
  );
}
