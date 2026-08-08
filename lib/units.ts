export type UnitSystem = 'metric' | 'imperial';

const STORAGE_KEY = 'course-matcher:unitSystem';

// Countries where everyday distances are commonly given in miles/feet rather than km/m.
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM']);

export function detectDefaultUnitSystem(): UnitSystem {
  if (typeof navigator === 'undefined') return 'metric';
  try {
    const locale = navigator.language || 'en-US';
    const region = new Intl.Locale(locale).maximize().region;
    return region && IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric';
  } catch {
    return 'metric';
  }
}

export function loadStoredUnitSystem(): UnitSystem | null {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'metric' || stored === 'imperial' ? stored : null;
}

export function storeUnitSystem(system: UnitSystem) {
  window.localStorage.setItem(STORAGE_KEY, system);
}

export function kmToMi(km: number): number {
  return km * 0.621371;
}

export function mToFt(m: number): number {
  return m * 3.28084;
}

export function formatDistance(km: number, system: UnitSystem): string {
  return system === 'imperial' ? `${kmToMi(km).toFixed(1)} mi` : `${km.toFixed(1)} km`;
}

export function formatElevation(m: number, system: UnitSystem): string {
  return system === 'imperial' ? `${Math.round(mToFt(m))} ft` : `${Math.round(m)} m`;
}

export function distanceUnitLabel(system: UnitSystem): string {
  return system === 'imperial' ? 'mi' : 'km';
}

export function elevationUnitLabel(system: UnitSystem): string {
  return system === 'imperial' ? 'ft' : 'm';
}
