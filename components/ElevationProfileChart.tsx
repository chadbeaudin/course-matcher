'use client';

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { ProfilePoint } from '@/lib/gpx';

export default function ElevationProfileChart({ profile }: { profile: ProfilePoint[] }) {
  const data = profile.map((p) => ({
    distance: Number(p.distanceKm.toFixed(2)),
    elevation: Math.round(p.elevationM),
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <XAxis
          dataKey="distance"
          tickFormatter={(v) => `${v} km`}
          minTickGap={40}
        />
        <YAxis tickFormatter={(v) => `${v} m`} width={72} />
        <Tooltip
          formatter={(value: number) => [`${value} m`, 'Elevation']}
          labelFormatter={(v) => `${v} km`}
        />
        <Area type="monotone" dataKey="elevation" stroke="#2563eb" fill="#93c5fd" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
