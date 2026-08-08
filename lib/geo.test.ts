import { haversineKm, destinationPoint, boundingBox } from './geo';

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm({ lat: 40, lon: -105 }, { lat: 40, lon: -105 })).toBe(0);
  });

  it('computes ~111km per degree of latitude at the equator', () => {
    const d = haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(d).toBeCloseTo(111.19, 0);
  });
});

describe('destinationPoint', () => {
  it('moving due north increases latitude and keeps longitude', () => {
    const p = destinationPoint({ lat: 40, lon: -105 }, 1, 0);
    expect(p.lat).toBeGreaterThan(40);
    expect(p.lon).toBeCloseTo(-105, 2);
  });

  it('the distance to the computed point matches the requested distance', () => {
    const origin = { lat: 40, lon: -105 };
    const dest = destinationPoint(origin, 2, 45);
    expect(haversineKm(origin, dest)).toBeCloseTo(2, 1);
  });
});

describe('boundingBox', () => {
  it('produces a box centered on the origin point', () => {
    const center = { lat: 40, lon: -105 };
    const bbox = boundingBox(center, 5);
    expect(bbox.south).toBeLessThan(center.lat);
    expect(bbox.north).toBeGreaterThan(center.lat);
    expect(bbox.west).toBeLessThan(center.lon);
    expect(bbox.east).toBeGreaterThan(center.lon);
  });
});
