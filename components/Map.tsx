'use client';

import { useEffect } from 'react';
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

interface MapProps {
  center: [number, number];
  zoom?: number;
  markerPosition?: [number, number] | null;
  onMapClick?: (lat: number, lon: number) => void;
  route?: [number, number][];
  className?: string;
}

function ClickHandler({ onMapClick }: { onMapClick?: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function RecenterOnChange({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center);
  }, [center, map]);
  return null;
}

export default function Map({ center, zoom = 14, markerPosition, onMapClick, route, className }: MapProps) {
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
      <RecenterOnChange center={center} />
      <ClickHandler onMapClick={onMapClick} />
      {markerPosition && <Marker position={markerPosition} />}
      {route && route.length > 1 && (
        <Polyline positions={route} color="#2563eb" weight={5} opacity={0.85} />
      )}
    </MapContainer>
  );
}
