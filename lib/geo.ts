export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Point a given distance and bearing (degrees, 0=north, clockwise) from an origin. */
export function destinationPoint(origin: LatLon, distanceKm: number, bearingDeg: number): LatLon {
  const δ = distanceKm / EARTH_RADIUS_KM;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (origin.lat * Math.PI) / 180;
  const λ1 = (origin.lon * Math.PI) / 180;

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );

  return { lat: (φ2 * 180) / Math.PI, lon: (((λ2 * 180) / Math.PI + 540) % 360) - 180 };
}

/** Axis-aligned bounding box padded by radiusKm around a center point. */
export function boundingBox(center: LatLon, radiusKm: number) {
  const latDelta = radiusKm / EARTH_RADIUS_KM * (180 / Math.PI);
  const lonDelta =
    (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI) / Math.cos((center.lat * Math.PI) / 180);

  return {
    south: center.lat - latDelta,
    north: center.lat + latDelta,
    west: center.lon - lonDelta,
    east: center.lon + lonDelta,
  };
}
