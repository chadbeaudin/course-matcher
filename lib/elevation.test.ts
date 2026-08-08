import { fetchElevations } from './elevation';

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
