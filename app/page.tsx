'use client';

import { useEffect, useState } from 'react';
import { parseGpx, computeRouteStats, type RouteStats } from '@/lib/gpx';
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

export default function Home() {
  const [stats, setStats] = useState<RouteStats | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('metric');
  const [theme, setTheme] = useState<Theme>('light');

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
