import { fetchOsmWays, clearOverpassCache } from './overpass';

const BBOX = { south: 40.0, west: -105.01, north: 40.01, east: -105.0 };

const WAY_ELEMENT = {
  type: 'way',
  id: 1,
  nodes: [10, 11],
  geometry: [
    { lat: 40.0, lon: -105.0 },
    { lat: 40.001, lon: -105.0 },
  ],
  tags: { highway: 'residential' },
};

function mockOk(elements: unknown[]) {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ elements }) });
}

describe('fetchOsmWays', () => {
  beforeEach(() => {
    clearOverpassCache();
    global.fetch = jest.fn();
  });

  it('posts an Overpass query for the bbox and returns parsed ways', async () => {
    mockOk([WAY_ELEMENT]);

    const ways = await fetchOsmWays(BBOX);

    expect(ways).toEqual([
      { id: 1, nodes: [10, 11], geometry: WAY_ELEMENT.geometry, tags: { highway: 'residential' } },
    ]);

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe('POST');
    const query = decodeURIComponent(init.body.replace('data=', ''));
    expect(query).toContain('out geom;');
    expect(query).toContain('highway');
  });

  it('drops nodes and ways lacking geometry', async () => {
    mockOk([
      WAY_ELEMENT,
      { type: 'node', id: 10, lat: 40.0, lon: -105.0 },
      { type: 'way', id: 2, nodes: [1, 2] },
    ]);

    const ways = await fetchOsmWays(BBOX);
    expect(ways).toHaveLength(1);
    expect(ways[0].id).toBe(1);
  });

  it('serves a repeat request for the same tile from cache', async () => {
    mockOk([WAY_ELEMENT]);

    await fetchOsmWays(BBOX);
    await fetchOsmWays(BBOX);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws on a non-OK response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 504 });

    await expect(fetchOsmWays(BBOX)).rejects.toThrow('HTTP 504');
  });
});
