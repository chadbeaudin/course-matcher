'use client';

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { ProfilePoint } from '@/lib/gpx';
import {
  type UnitSystem,
  kmToMi,
  mToFt,
  distanceUnitLabel,
  elevationUnitLabel,
} from '@/lib/units';
import type { Theme } from '@/lib/theme';

export default function ElevationProfileChart({
  profile,
  unitSystem,
  theme,
}: {
  profile: ProfilePoint[];
  unitSystem: UnitSystem;
  theme: Theme;
}) {
  const distUnit = distanceUnitLabel(unitSystem);
  const eleUnit = elevationUnitLabel(unitSystem);
  const tickColor = theme === 'dark' ? '#9ca3af' : '#666';

  const data = profile.map((p) => ({
    distance: Number(
      (unitSystem === 'imperial' ? kmToMi(p.distanceKm) : p.distanceKm).toFixed(2)
    ),
    elevation: Math.round(unitSystem === 'imperial' ? mToFt(p.elevationM) : p.elevationM),
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <XAxis
          dataKey="distance"
          tickFormatter={(v) => `${v} ${distUnit}`}
          minTickGap={40}
          tick={{ fill: tickColor }}
        />
        <YAxis tickFormatter={(v) => `${v} ${eleUnit}`} width={72} tick={{ fill: tickColor }} />
        <Tooltip
          formatter={(value: number) => [`${value} ${eleUnit}`, 'Elevation']}
          labelFormatter={(v) => `${v} ${distUnit}`}
          contentStyle={
            theme === 'dark'
              ? { backgroundColor: '#111827', borderColor: '#374151', color: '#f3f4f6' }
              : undefined
          }
        />
        <Area type="monotone" dataKey="elevation" stroke="#2563eb" fill="#93c5fd" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
