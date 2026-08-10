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
  distanceUnitLabel,
  miToKm,
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
  const [approachInput, setApproachInput] = useState('0');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RouteCandidate[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [hoveredRouteIndex, setHoveredRouteIndex] = useState<number | null>(null);
  const [pinnedRouteIndex, setPinnedRouteIndex] = useState<number | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [routeHoverPoint, setRouteHoverPoint] = useState<{ lat: number; lon: number } | null>(null);

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

  // Default the start location to the user's current position once a race is loaded.
  useEffect(() => {
    if (stats && !startPoint) {
      handleUseMyLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats]);

  async function handleGenerate() {
    if (!startPoint || !stats) return;

    setGenerating(true);
    setGenerateError(null);
    setCandidates(null);

    const approachValue = parseFloat(approachInput);
    const approachDistanceKm =
      Number.isFinite(approachValue) && approachValue > 0
        ? unitSystem === 'imperial'
          ? miToKm(approachValue)
          : approachValue
        : 0;

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startLat: startPoint.lat,
          startLon: startPoint.lon,
          targetDistanceKm: stats.distanceKm,
          targetElevationGainM: stats.elevationGainM,
          approachDistanceKm,
          targetProfile: stats.profile,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Route generation failed');

      setCandidates(data.candidates);
      setSelectedIndex(null);
      setPinnedRouteIndex(null);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Route generation failed');
    } finally {
      setGenerating(false);
    }
  }

  function selectCandidate(i: number) {
    setSelectedIndex(i);
    setHoveredPoint(null);
    setRouteHoverPoint(null);
  }

  const selectedCandidate = selectedIndex != null ? candidates?.[selectedIndex] ?? null : null;
  const mapCenter: [number, number] = startPoint
    ? [startPoint.lat, startPoint.lon]
    : DEFAULT_MAP_CENTER;

  if (candidates && candidates.length > 0 && selectedIndex === null && stats) {
    return (
      <RouteSelectionScreen
        candidates={candidates}
        stats={stats}
        unitSystem={unitSystem}
        mapCenter={mapCenter}
        startPoint={startPoint}
        hoveredRouteIndex={hoveredRouteIndex}
        onHoverRoute={setHoveredRouteIndex}
        pinnedRouteIndex={pinnedRouteIndex}
        onPinRoute={setPinnedRouteIndex}
        onConfirmRoute={selectCandidate}
        onBack={() => setCandidates(null)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  if (candidates && candidates.length > 0 && selectedCandidate && stats) {
    return (
      <RouteDetailScreen
        candidate={selectedCandidate}
        stats={stats}
        unitSystem={unitSystem}
        mapCenter={mapCenter}
        startPoint={startPoint}
        hoveredPoint={hoveredPoint}
        onHoverPoint={setHoveredPoint}
        routeHoverPoint={routeHoverPoint}
        onRouteHover={setRouteHoverPoint}
        onBack={() => setSelectedIndex(null)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
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

          <div className="mt-4">
            <label className="block text-sm font-medium">
              Ride out before the match starts
            </label>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Distance you&apos;re willing to ride to clear a city or neighborhood before the
              matched course begins. Leave at 0 to start matching right from the pin.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="0.5"
                value={approachInput}
                onChange={(e) => setApproachInput(e.target.value)}
                className="w-24 rounded-md border border-gray-300 bg-transparent px-3 py-1.5 text-sm dark:border-gray-700"
              />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {distanceUnitLabel(unitSystem)}
              </span>
            </div>
          </div>

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
            className="mt-4 flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            {generating && <Spinner />}
            {generating ? 'Generating route…' : 'Generate route'}
          </button>
          {generating && (
            <p className="mt-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <Spinner />
              Fetching roads and elevation data and scoring candidates — this can take 20-40
              seconds.
            </p>
          )}
          {generateError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{generateError}</p>
          )}
        </div>
      )}

    </main>
  );
}

function RouteSelectionScreen({
  candidates,
  stats,
  unitSystem,
  mapCenter,
  startPoint,
  hoveredRouteIndex,
  onHoverRoute,
  pinnedRouteIndex,
  onPinRoute,
  onConfirmRoute,
  onBack,
  theme,
  onToggleTheme,
}: {
  candidates: RouteCandidate[];
  stats: RouteStats;
  unitSystem: UnitSystem;
  mapCenter: [number, number];
  startPoint: StartPoint | null;
  hoveredRouteIndex: number | null;
  onHoverRoute: (i: number | null) => void;
  pinnedRouteIndex: number | null;
  onPinRoute: (i: number | null) => void;
  onConfirmRoute: (i: number) => void;
  onBack: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const routeOptions = candidates.map((candidate, i) => ({
    id: i,
    points: candidate.points.map((p) => [p.lat, p.lon] as [number, number]),
  }));
  const activeIndex = hoveredRouteIndex ?? pinnedRouteIndex ?? 0;
  const [chartHoverPoint, setChartHoverPoint] = useState<{ lat: number; lon: number } | null>(null);

  // Drop any stale highlight from the previous candidate's chart when switching.
  useEffect(() => {
    setChartHoverPoint(null);
  }, [activeIndex]);

  return (
    <main className="mx-auto flex h-screen max-w-6xl flex-col px-6 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Choose a route</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Target: {formatDistance(stats.distanceKm, unitSystem)} ·{' '}
            {formatElevation(stats.elevationGainM, unitSystem)}. The recommended route is
            highlighted — hover or click a route to preview it, then confirm your choice.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            Back
          </button>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-md border border-gray-300 dark:border-gray-700">
        <MapView
          center={mapCenter}
          markerPosition={startPoint ? [startPoint.lat, startPoint.lon] : null}
          routeOptions={routeOptions}
          recommendedRouteId={0}
          highlightedRouteId={activeIndex}
          onRouteOptionHover={onHoverRoute}
          onRouteOptionClick={onPinRoute}
          hoveredPoint={chartHoverPoint}
        />
      </div>

      <div className="mt-4 shrink-0">
        <ElevationProfileChart
          profile={candidates[activeIndex].matchedStats.profile}
          targetProfile={stats.profile}
          unitSystem={unitSystem}
          theme={theme}
          onHoverPoint={setChartHoverPoint}
          highlightPoint={chartHoverPoint}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {candidates.map((candidate, i) => (
          <button
            key={i}
            type="button"
            onMouseEnter={() => onHoverRoute(i)}
            onMouseLeave={() => onHoverRoute(null)}
            onClick={() => onPinRoute(i)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              activeIndex === i
                ? 'border-blue-600 bg-blue-50 text-blue-900 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-100'
                : 'border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900'
            }`}
          >
            {i === 0 && <span className="mr-1 font-semibold">Recommended</span>}
            {formatDistance(candidate.matchedStats.distanceKm, unitSystem)} ·{' '}
            {formatElevation(candidate.matchedStats.elevationGainM, unitSystem)}
            {candidate.approachDistanceKm > 0 &&
              ` (+${formatDistance(candidate.approachDistanceKm, unitSystem)} out)`}
          </button>
        ))}

        <button
          type="button"
          onClick={() => onConfirmRoute(activeIndex)}
          className="ml-auto rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
        >
          Use this route
        </button>
      </div>
    </main>
  );
}

function RouteDetailScreen({
  candidate,
  stats,
  unitSystem,
  mapCenter,
  startPoint,
  hoveredPoint,
  onHoverPoint,
  routeHoverPoint,
  onRouteHover,
  onBack,
  theme,
  onToggleTheme,
}: {
  candidate: RouteCandidate;
  stats: RouteStats;
  unitSystem: UnitSystem;
  mapCenter: [number, number];
  startPoint: StartPoint | null;
  hoveredPoint: { lat: number; lon: number } | null;
  onHoverPoint: (point: { lat: number; lon: number } | null) => void;
  routeHoverPoint: { lat: number; lon: number } | null;
  onRouteHover: (point: { lat: number; lon: number } | null) => void;
  onBack: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Selected route</h1>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            Back to route options
          </button>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
      </div>

      <div className="mt-4 h-72 overflow-hidden rounded-md border border-gray-300 dark:border-gray-700">
        <MapView
          center={mapCenter}
          markerPosition={startPoint ? [startPoint.lat, startPoint.lon] : null}
          route={candidate.points.map((p) => [p.lat, p.lon])}
          hoveredPoint={hoveredPoint}
          onRouteHover={onRouteHover}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-center">
        <Stat label="Target distance" value={formatDistance(stats.distanceKm, unitSystem)} />
        <Stat
          label="Target elevation gain"
          value={formatElevation(stats.elevationGainM, unitSystem)}
        />
      </div>

      <div
        className={`mt-2 grid gap-4 text-center ${
          candidate.approachDistanceKm > 0 ? 'grid-cols-4' : 'grid-cols-2'
        }`}
      >
        <Stat
          label="Course distance"
          value={formatDistance(candidate.matchedStats.distanceKm, unitSystem)}
        />
        <Stat
          label="Course elevation gain"
          value={formatElevation(candidate.matchedStats.elevationGainM, unitSystem)}
        />
        {candidate.approachDistanceKm > 0 && (
          <>
            <Stat
              label="Ride out"
              value={formatDistance(candidate.approachDistanceKm, unitSystem)}
            />
            <Stat
              label="Total ride"
              value={formatDistance(candidate.stats.distanceKm, unitSystem)}
            />
          </>
        )}
      </div>

      <div className="mt-6">
        <ElevationProfileChart
          profile={candidate.matchedStats.profile}
          targetProfile={stats.profile}
          unitSystem={unitSystem}
          theme={theme}
          onHoverPoint={onHoverPoint}
          highlightPoint={routeHoverPoint}
        />
      </div>
    </main>
  );
}

function Spinner() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      className="h-4 w-4 shrink-0 animate-spin"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
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
