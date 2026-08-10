'use client';

import { Fragment, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Leaflet's default marker icon paths don't survive bundling; point at a CDN instead.
// @ts-expect-error - _getIconUrl is a private Leaflet API this workaround intentionally removes
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface LatLon {
  lat: number;
  lon: number;
}

interface RouteOption {
  id: number;
  points: [number, number][];
}

interface MapProps {
  center: [number, number];
  zoom?: number;
  markerPosition?: [number, number] | null;
  onMapClick?: (lat: number, lon: number) => void;
  route?: [number, number][];
  className?: string;
  /** A point (e.g. from hovering an elevation chart) to highlight on the map. */
  hoveredPoint?: LatLon | null;
  /** Called with the nearest point on `route` as the mouse moves over it, or null when it leaves. */
  onRouteHover?: (point: LatLon | null) => void;
  /** Multiple candidate routes to render at once, e.g. on a route-selection screen. */
  routeOptions?: RouteOption[];
  /** id of the route drawn in the highlight color (defaults to the recommended one). */
  recommendedRouteId?: number;
  /** id of the route currently hovered/highlighted, overriding the recommended color. */
  highlightedRouteId?: number | null;
  /** Called with a route's id when the mouse enters/leaves it, or null on leave. */
  onRouteOptionHover?: (id: number | null) => void;
  /** Called with a route's id when it's clicked. */
  onRouteOptionClick?: (id: number) => void;
}

function ClickHandler({ onMapClick }: { onMapClick?: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function InvalidateSizeOnMount() {
  const map = useMap();
  useEffect(() => {
    // Leaflet measures its container synchronously on init, which can run before a
    // flex/dynamic layout has settled into its final size.
    const id = requestAnimationFrame(() => map.invalidateSize());
    return () => cancelAnimationFrame(id);
  }, [map]);
  return null;
}

function RecenterOnChange({ center }: { center: [number, number] }) {
  const map = useMap();
  const [lat, lon] = center;
  useEffect(() => {
    map.setView([lat, lon]);
    // Only re-center when the coordinates actually change, not on every
    // parent re-render (`center` is a new array literal each time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, map]);
  return null;
}

/**
 * Zooms/pans the map once so the full extent of the given route(s) is visible,
 * rather than leaving it centered at the default zoom around the start point.
 */
function FitRouteBounds({
  route,
  routeOptions,
}: {
  route?: [number, number][];
  routeOptions?: RouteOption[];
}) {
  const map = useMap();
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    const allPoints: [number, number][] = [...(route ?? [])];
    routeOptions?.forEach((option) => allPoints.push(...option.points));
    if (allPoints.length < 2) return;

    firedRef.current = true;
    // The container's real size (e.g. from a flex layout) can settle after Leaflet's
    // initial measurement, leaving its cached size stale — invalidate it first so
    // fitBounds (and the SVG renderer's clip bounds) use the actual visible area.
    map.invalidateSize();
    map.fitBounds(L.latLngBounds(allPoints), { padding: [32, 32] });
  }, [map, route, routeOptions]);

  return null;
}

function HoverMarker({ point }: { point: LatLon | null | undefined }) {
  if (!point) return null;
  const icon = L.divIcon({
    className: '',
    html: '<div style="width:16px;height:16px;background:#f59e0b;border:3px solid white;border-radius:50%;box-shadow:0 0 8px rgba(0,0,0,0.5);"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
  return <Marker position={[point.lat, point.lon]} icon={icon} zIndexOffset={1000} interactive={false} />;
}

/**
 * Tracks the mouse over the whole map and, when near `route`, reports the
 * closest point on it via `onRouteHover` — segment-projected, so it works
 * between vertices rather than only snapping to route points.
 */
function RouteHoverTracker({
  route,
  onRouteHover,
}: {
  route: [number, number][];
  onRouteHover: (point: LatLon | null) => void;
}) {
  const map = useMap();
  const lastRef = useRef<LatLon | null>(null);

  useEffect(() => {
    const clearHover = () => {
      if (lastRef.current !== null) {
        lastRef.current = null;
        onRouteHover(null);
      }
    };

    const handleMove = (e: L.LeafletMouseEvent) => {
      const cosLat = Math.cos((e.latlng.lat * Math.PI) / 180);
      const cx = e.latlng.lng * cosLat;
      const cy = e.latlng.lat;

      let best: LatLon | null = null;
      let bestDistSq = Infinity;

      for (let i = 0; i < route.length - 1; i++) {
        const ax = route[i][1] * cosLat;
        const ay = route[i][0];
        const bx = route[i + 1][1] * cosLat;
        const by = route[i + 1][0];
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        let t = lenSq === 0 ? 0 : ((cx - ax) * dx + (cy - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const px = ax + t * dx;
        const py = ay + t * dy;
        const distSq = (cx - px) ** 2 + (cy - py) ** 2;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          best = { lat: py, lon: px / cosLat };
        }
      }

      if (!best) return;

      const routePx = map.latLngToContainerPoint(L.latLng(best.lat, best.lon));
      const cursorPx = map.latLngToContainerPoint(e.latlng);
      if (routePx.distanceTo(cursorPx) > 20) {
        clearHover();
        return;
      }

      const last = lastRef.current;
      if (!last || Math.abs(last.lat - best.lat) > 1e-6 || Math.abs(last.lon - best.lon) > 1e-6) {
        lastRef.current = best;
        onRouteHover(best);
      }
    };

    map.on('mousemove', handleMove);
    map.on('mouseout', clearHover);
    return () => {
      map.off('mousemove', handleMove);
      map.off('mouseout', clearHover);
    };
  }, [map, route, onRouteHover]);

  return null;
}

export default function Map({
  center,
  zoom = 14,
  markerPosition,
  onMapClick,
  route,
  className,
  hoveredPoint,
  onRouteHover,
  routeOptions,
  recommendedRouteId,
  highlightedRouteId,
  onRouteOptionHover,
  onRouteOptionClick,
}: MapProps) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      zoomSnap={1}
      className={className ?? 'h-full w-full'}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <InvalidateSizeOnMount />
      <RecenterOnChange center={center} />
      <FitRouteBounds route={route} routeOptions={routeOptions} />
      <ClickHandler onMapClick={onMapClick} />
      {markerPosition && <Marker position={markerPosition} />}
      {route && route.length > 1 && (
        <Polyline positions={route} pathOptions={{ color: '#2563eb', weight: 5, opacity: 0.85 }} />
      )}
      {route && route.length > 1 && onRouteHover && (
        <RouteHoverTracker route={route} onRouteHover={onRouteHover} />
      )}
      {[...(routeOptions ?? [])]
        .sort((a, b) => {
          const aHighlighted =
            (highlightedRouteId != null ? a.id === highlightedRouteId : a.id === recommendedRouteId) ? 1 : 0;
          const bHighlighted =
            (highlightedRouteId != null ? b.id === highlightedRouteId : b.id === recommendedRouteId) ? 1 : 0;
          return aHighlighted - bHighlighted;
        })
        .map((option) => {
        const isHighlighted =
          highlightedRouteId != null
            ? option.id === highlightedRouteId
            : option.id === recommendedRouteId;
        const eventHandlers =
          onRouteOptionHover || onRouteOptionClick
            ? {
                mouseover: () => onRouteOptionHover?.(option.id),
                mouseout: () => onRouteOptionHover?.(null),
                click: () => onRouteOptionClick?.(option.id),
              }
            : undefined;
        return (
          <Fragment key={option.id}>
            {/* Wide, invisible line so hovering/clicking near a thin route doesn't require pixel-precision. */}
            <Polyline
              positions={option.points}
              pathOptions={{ opacity: 0, weight: 20 }}
              eventHandlers={eventHandlers}
            />
            <Polyline
              positions={option.points}
              pathOptions={{
                color: isHighlighted ? '#2563eb' : '#9ca3af',
                weight: isHighlighted ? 5 : 4,
                opacity: isHighlighted ? 0.9 : 0.6,
              }}
              interactive={false}
            />
          </Fragment>
        );
      })}
      <HoverMarker point={hoveredPoint} />
    </MapContainer>
  );
}
