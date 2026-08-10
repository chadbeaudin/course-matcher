import { buildElevationGrid } from './elevationGrid';

describe('buildElevationGrid', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('samples a grid over the bbox and looks up the nearest cell', async () => {
    const bbox = { south: 40, west: -105, north: 40.01, east: -104.99 };

    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      const match = url.match(/locations=([^&]+)/);
      const locations = decodeURIComponent(match![1]).split('|');
      // Elevation rises with latitude, so we can assert the grid interpolates sensibly.
      const results = locations.map((loc) => {
        const [lat] = loc.split(',').map(Number);
        return { elevation: Math.round((lat - bbox.south) * 100000) };
      });
      return { ok: true, json: async () => ({ results }) };
    });

    const grid = await buildElevationGrid(bbox);

    const low = grid.elevationAt({ lat: bbox.south, lon: -105 });
    const high = grid.elevationAt({ lat: bbox.north, lon: -105 });
    expect(high).toBeGreaterThan(low);
  });

  it('clamps lookups outside the bbox to the nearest edge cell', async () => {
    const bbox = { south: 40, west: -105, north: 40.01, east: -104.99 };
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      const match = url.match(/locations=([^&]+)/);
      const count = decodeURIComponent(match![1]).split('|').length;
      return { ok: true, json: async () => ({ results: Array(count).fill({ elevation: 42 }) }) };
    });

    const grid = await buildElevationGrid(bbox);

    expect(grid.elevationAt({ lat: 50, lon: -50 })).toBe(42);
  });
});
