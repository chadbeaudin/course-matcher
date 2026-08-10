/** @jest-environment node */
jest.mock('@/lib/rwgps');

import type { NextRequest } from 'next/server';
import { POST } from './route';
import { uploadRouteToRwgps } from '@/lib/rwgps';

const mockUpload = uploadRouteToRwgps as jest.MockedFunction<typeof uploadRouteToRwgps>;

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const validPoints = [
  { lat: 40, lon: -105, ele: 1500 },
  { lat: 40.001, lon: -105.001, ele: 1510 },
];

describe('POST /api/export/rwgps', () => {
  it('rejects a request with no points', async () => {
    const res = await POST(makeRequest({ points: [], name: 'Route', accessToken: 'tok' }));
    expect(res.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('rejects a request missing a name', async () => {
    const res = await POST(makeRequest({ points: validPoints, name: '', accessToken: 'tok' }));
    expect(res.status).toBe(400);
  });

  it('rejects a request missing an access token', async () => {
    const res = await POST(makeRequest({ points: validPoints, name: 'Route' }));
    expect(res.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('builds a GPX course and uploads it, returning the result', async () => {
    mockUpload.mockResolvedValue({ routeId: 42, routeUrl: 'https://ridewithgps.com/routes/42' });

    const res = await POST(makeRequest({ points: validPoints, name: 'My Route', accessToken: 'tok' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ routeId: 42, routeUrl: 'https://ridewithgps.com/routes/42' });
    expect(mockUpload).toHaveBeenCalledWith('tok', expect.stringContaining('My Route'), 'My Route');
  });

  it('returns a 502 with the error message when the upload fails', async () => {
    mockUpload.mockRejectedValue(new Error('RideWithGPS upload failed: 401 Unauthorized'));

    const res = await POST(makeRequest({ points: validPoints, name: 'My Route', accessToken: 'bad' }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe('RideWithGPS upload failed: 401 Unauthorized');
  });
});
