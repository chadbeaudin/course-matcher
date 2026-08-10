import { fetchElevations, fetchElevationsCoarse } from './elevation';

const points = [
  { lat: 40.0, lon: -105.0 },
  { lat: 40.001, lon: -105.001 },
];

describe('fetchElevations', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('returns an empty array without calling out for no points', async () => {
    expect(await fetchElevations([])).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses Open Topo Data when it succeeds', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ elevation: 10 }, { elevation: 20 }] }),
    });

    const result = await fetchElevations(points);

    expect(result).toEqual([10, 20]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('opentopodata.org');
  });

  it('falls back to Open-Meteo when Open Topo Data fails on every retry', async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elevation: [11, 21] }) });

    const result = await fetchElevations(points);

    expect(result).toEqual([11, 21]);
    const lastCallUrl = (global.fetch as jest.Mock).mock.calls.at(-1)![0];
    expect(lastCallUrl).toContain('open-meteo.com');
  }, 10000);

  it('throws when every provider fails', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('all down'));

    await expect(fetchElevations(points)).rejects.toThrow();
  }, 15000);
});

describe('fetchElevationsCoarse', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('prefers Open-Meteo (larger batches) over Open Topo Data', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ elevation: [10, 20] }),
    });

    const result = await fetchElevationsCoarse(points);

    expect(result).toEqual([10, 20]);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('open-meteo.com');
  });

  it('batches points in parallel rather than one request at a time', async () => {
    const manyPoints = Array.from({ length: 1200 }, (_, i) => ({ lat: 40 + i * 0.0001, lon: -105 }));
    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;

    (global.fetch as jest.Mock).mockImplementation(async () => {
      concurrentCalls++;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
      await Promise.resolve();
      concurrentCalls--;
      return { ok: true, json: async () => ({ elevation: Array(500).fill(0) }) };
    });

    await fetchElevationsCoarse(manyPoints);

    // 1200 points at a 500-point batch size is 3 requests; parallel means more than 1 in flight at once.
    expect(maxConcurrentCalls).toBeGreaterThan(1);
  });
});
