import { uploadRouteToRwgps } from './rwgps';

describe('uploadRouteToRwgps', () => {
  const originalApiKey = process.env.RWGPS_API_KEY;

  beforeEach(() => {
    process.env.RWGPS_API_KEY = 'test-api-key';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.RWGPS_API_KEY = originalApiKey;
  });

  it('throws when RWGPS_API_KEY is not configured', async () => {
    delete process.env.RWGPS_API_KEY;

    await expect(uploadRouteToRwgps('token', '<gpx/>', 'My Route')).rejects.toThrow(
      'RWGPS_API_KEY not configured'
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uploads the GPX, polls the returned task, and resolves the route URL', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => (name === 'Location' ? 'https://ridewithgps.com/tasks/123.json' : null) },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: { status: 'completed', items: [{ item_id: 456 }] } }),
      });

    const result = await uploadRouteToRwgps('token', '<gpx/>', 'My Route');

    expect(result).toEqual({ routeId: 456, routeUrl: 'https://ridewithgps.com/routes/456' });
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const uploadCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(uploadCall[0]).toBe('https://ridewithgps.com/api/v1/routes.json');
    expect(uploadCall[1].headers['x-rwgps-api-key']).toBe('test-api-key');
    expect(uploadCall[1].headers.Authorization).toBe('Bearer token');
  });

  it('keeps polling until the task completes', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'https://ridewithgps.com/tasks/123.json' },
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ task: { status: 'pending' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ task: { status: 'completed', items: [{ item_id: 1 }] } }) });

    const result = await uploadRouteToRwgps('token', '<gpx/>', 'My Route');

    expect(result.routeId).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  }, 10000);

  it('throws when the upload request itself fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid token',
    });

    await expect(uploadRouteToRwgps('bad-token', '<gpx/>', 'My Route')).rejects.toThrow('RideWithGPS upload failed');
  });

  it('throws when RideWithGPS reports import errors', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'https://ridewithgps.com/tasks/123.json' },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: { status: 'completed', errors: [{ code: 'invalid_gpx' }] } }),
      });

    await expect(uploadRouteToRwgps('token', '<gpx/>', 'My Route')).rejects.toThrow('invalid_gpx');
  });
});
