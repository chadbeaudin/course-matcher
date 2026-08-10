'use client';

export default function RwgpsSuccessDialog({ routeUrl, onClose }: { routeUrl: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-green-300 bg-white text-gray-900 shadow-xl dark:border-green-800 dark:bg-gray-950 dark:text-gray-100">
        <div className="border-b border-green-200 bg-green-50 px-5 py-4 dark:border-green-900 dark:bg-green-950">
          <h2 className="text-base font-semibold text-green-900 dark:text-green-100">Uploaded to RideWithGPS</h2>
          <p className="mt-1 text-sm text-green-700 dark:text-green-300">Your route was added to your library.</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            Close
          </button>
          <a
            href={routeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            View route
          </a>
        </div>
      </div>
    </div>
  );
}
