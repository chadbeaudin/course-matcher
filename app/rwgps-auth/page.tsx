'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function RwgpsAuthCallback() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const error = searchParams.get('error');
  const router = useRouter();
  const [status, setStatus] = useState('Connecting to RideWithGPS…');

  useEffect(() => {
    if (error) {
      setStatus(`Authorization failed: ${error}. You may have denied the request.`);
      return;
    }

    if (!code) {
      setStatus('No authorization code found in URL.');
      return;
    }

    const stateCookie = document.cookie
      .split(';')
      .find((c) => c.trim().startsWith('rwgps_oauth_state='))
      ?.split('=')[1];

    if (!stateParam || !stateCookie || stateParam !== stateCookie) {
      setStatus('Authorization failed: invalid state parameter. Please try connecting again.');
      return;
    }

    document.cookie = 'rwgps_oauth_state=; Max-Age=0; path=/';
    setStatus('Exchanging authorization code securely…');

    fetch('/api/rwgps/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.access_token) {
          localStorage.setItem('rwgps_settings', JSON.stringify({ accessToken: data.access_token }));
          setStatus('Successfully connected to RideWithGPS! Redirecting…');
          setTimeout(() => router.push('/'), 1500);
        } else {
          const detail = data.details ? JSON.stringify(data.details) : '';
          setStatus('Failed to get token: ' + (data.error || JSON.stringify(data)) + (detail ? ` — ${detail}` : ''));
        }
      })
      .catch((err) => {
        setStatus('Network error during token exchange: ' + err.message);
      });
  }, [code, error, stateParam, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 p-8 text-center dark:border-gray-800">
        <h1 className="text-lg font-semibold">RideWithGPS Connection</h1>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{status}</p>
      </div>
    </main>
  );
}

export default function RwgpsAuthPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-gray-500 dark:text-gray-400">
          Loading…
        </div>
      }
    >
      <RwgpsAuthCallback />
    </Suspense>
  );
}
