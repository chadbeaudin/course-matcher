'use client';

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceDot,
  ResponsiveContainer,
} from 'recharts';
import { resampleProfile, type ProfilePoint } from '@/lib/gpx';
import {
  type UnitSystem,
  kmToMi,
  mToFt,
  distanceUnitLabel,
  elevationUnitLabel,
} from '@/lib/units';
import type { Theme } from '@/lib/theme';

interface ChartPoint {
  distance: number;
  elevation: number | null;
  targetElevation?: number | null;
  lat: number;
  lon: number;
}

interface LatLon {
  lat: number;
  lon: number;
}

export default function ElevationProfileChart({
  profile,
  targetProfile,
  unitSystem,
  theme,
  onHoverPoint,
  highlightPoint,
}: {
  profile: ProfilePoint[];
  /** An optional second profile (e.g. the race being matched) to overlay for comparison. */
  targetProfile?: ProfilePoint[];
  unitSystem: UnitSystem;
  theme: Theme;
  /** Called with the lat/lon under the cursor as the chart is hovered (e.g. to show it on a map), or null on mouse-leave. */
  onHoverPoint?: (point: LatLon | null) => void;
  /** A lat/lon (e.g. from hovering the map) to highlight on the chart. */
  highlightPoint?: LatLon | null;
}) {
  const distUnit = distanceUnitLabel(unitSystem);
  const eleUnit = elevationUnitLabel(unitSystem);
  const tickColor = theme === 'dark' ? '#9ca3af' : '#666';
  const toDisplayDistance = (km: number) => (unitSystem === 'imperial' ? kmToMi(km) : km);
  const toDisplayElevation = (m: number) => (unitSystem === 'imperial' ? mToFt(m) : m);

  const data = useMemo(
    () => buildChartData(profile, targetProfile, toDisplayDistance, toDisplayElevation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile, targetProfile, unitSystem]
  );

  const highlight = useMemo(() => {
    if (!highlightPoint || data.length === 0) return null;
    const cosLat = Math.cos((highlightPoint.lat * Math.PI) / 180);
    let best = data[0];
    let bestDistSq = Infinity;
    for (const point of data) {
      const dLat = point.lat - highlightPoint.lat;
      const dLon = (point.lon - highlightPoint.lon) * cosLat;
      const distSq = dLat * dLat + dLon * dLon;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = point;
      }
    }
    return best;
  }, [data, highlightPoint]);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart
        data={data}
        margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
        onMouseMove={(state: { activeTooltipIndex?: number | string | null }) => {
          if (!onHoverPoint) return;
          const index = typeof state.activeTooltipIndex === 'string'
            ? Number(state.activeTooltipIndex)
            : state.activeTooltipIndex;
          const point = index !== undefined && index !== null ? data[index] : null;
          onHoverPoint(point ? { lat: point.lat, lon: point.lon } : null);
        }}
        onMouseLeave={() => onHoverPoint?.(null)}
      >
        <XAxis
          dataKey="distance"
          tickFormatter={(v) => `${v} ${distUnit}`}
          minTickGap={40}
          tick={{ fill: tickColor }}
        />
        <YAxis tickFormatter={(v) => `${v} ${eleUnit}`} width={72} tick={{ fill: tickColor }} />
        <Tooltip
          formatter={(value, name) => [`${value} ${eleUnit}`, name]}
          labelFormatter={(v) => `${v} ${distUnit}`}
          contentStyle={
            theme === 'dark'
              ? { backgroundColor: '#111827', borderColor: '#374151', color: '#f3f4f6' }
              : undefined
          }
        />
        {targetProfile && <Legend />}
        <Area
          type="monotone"
          dataKey="elevation"
          name="This route"
          stroke="#2563eb"
          fill="none"
          connectNulls
        />
        {targetProfile && (
          <Line
            type="monotone"
            dataKey="targetElevation"
            name="Race"
            stroke="#f59e0b"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            connectNulls
          />
        )}
        {highlight && highlight.elevation !== null && (
          <ReferenceDot
            x={highlight.distance}
            y={highlight.elevation}
            r={6}
            fill="#f59e0b"
            stroke="white"
            strokeWidth={2}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

function buildChartData(
  profile: ProfilePoint[],
  targetProfile: ProfilePoint[] | undefined,
  toDisplayDistance: (km: number) => number,
  toDisplayElevation: (m: number) => number
): ChartPoint[] {
  if (!targetProfile || targetProfile.length === 0) {
    return profile.map((p) => ({
      distance: Number(toDisplayDistance(p.distanceKm).toFixed(2)),
      elevation: Math.round(toDisplayElevation(p.elevationM)),
      lat: p.lat,
      lon: p.lon,
    }));
  }

  const maxDistanceKm = Math.max(
    profile.at(-1)?.distanceKm ?? 0,
    targetProfile.at(-1)?.distanceKm ?? 0
  );
  const binCount = 60;
  const binDistancesKm = Array.from({ length: binCount + 1 }, (_, i) => (i / binCount) * maxDistanceKm);

  const primary = resampleProfile(profile, binDistancesKm);
  const target = resampleProfile(targetProfile, binDistancesKm);

  return binDistancesKm.map((distanceKm, i) => ({
    distance: Number(toDisplayDistance(distanceKm).toFixed(2)),
    elevation: primary[i] === null ? null : Math.round(toDisplayElevation(primary[i]!.elevationM)),
    targetElevation: target[i] === null ? null : Math.round(toDisplayElevation(target[i]!.elevationM)),
    lat: primary[i]?.lat ?? profile[0]?.lat ?? 0,
    lon: primary[i]?.lon ?? profile[0]?.lon ?? 0,
  }));
}
