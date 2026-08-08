import type { OSMWay } from './overpass';

export const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>Sample Race</name>
    <trkseg>
      <trkpt lat="40.0000" lon="-105.0000"><ele>1500</ele></trkpt>
      <trkpt lat="40.0020" lon="-105.0000"><ele>1510</ele></trkpt>
      <trkpt lat="40.0040" lon="-105.0000"><ele>1540</ele></trkpt>
      <trkpt lat="40.0060" lon="-105.0000"><ele>1600</ele></trkpt>
      <trkpt lat="40.0080" lon="-105.0000"><ele>1650</ele></trkpt>
      <trkpt lat="40.0100" lon="-105.0000"><ele>1670</ele></trkpt>
      <trkpt lat="40.0100" lon="-105.0020"><ele>1660</ele></trkpt>
      <trkpt lat="40.0100" lon="-105.0040"><ele>1620</ele></trkpt>
      <trkpt lat="40.0100" lon="-105.0060"><ele>1580</ele></trkpt>
      <trkpt lat="40.0100" lon="-105.0080"><ele>1560</ele></trkpt>
      <trkpt lat="40.0080" lon="-105.0080"><ele>1600</ele></trkpt>
      <trkpt lat="40.0060" lon="-105.0080"><ele>1660</ele></trkpt>
      <trkpt lat="40.0040" lon="-105.0080"><ele>1700</ele></trkpt>
      <trkpt lat="40.0020" lon="-105.0080"><ele>1650</ele></trkpt>
      <trkpt lat="40.0000" lon="-105.0080"><ele>1580</ele></trkpt>
      <trkpt lat="40.0000" lon="-105.0060"><ele>1550</ele></trkpt>
      <trkpt lat="40.0000" lon="-105.0040"><ele>1520</ele></trkpt>
      <trkpt lat="40.0000" lon="-105.0020"><ele>1505</ele></trkpt>
      <trkpt lat="40.0000" lon="-105.0000"><ele>1500</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

// An NxN grid of intersections connected by N horizontal + N vertical ways, node ids
// row-major from the SW corner. Default spacing (~111m) matches GRID_WAYS below.
export function makeGridWays(size = 3, spacingDeg = 0.001): OSMWay[] {
  const coord = (row: number, col: number) => ({
    lat: 40.0 + row * spacingDeg,
    lon: -105.0 + col * spacingDeg,
  });
  const nodeId = (row: number, col: number) => row * size + col + 1;
  const indices = Array.from({ length: size }, (_, i) => i);

  const rows = indices.map((row) => ({
    id: 100 + row,
    nodes: indices.map((col) => nodeId(row, col)),
    geometry: indices.map((col) => coord(row, col)),
  }));

  const cols = indices.map((col) => ({
    id: 200 + col,
    nodes: indices.map((row) => nodeId(row, col)),
    geometry: indices.map((row) => coord(row, col)),
  }));

  return [...rows, ...cols];
}

// 3x3 grid of intersections (~111m spacing, node ids 1-9 row-major from the SW corner).
export const GRID_WAYS: OSMWay[] = makeGridWays();
