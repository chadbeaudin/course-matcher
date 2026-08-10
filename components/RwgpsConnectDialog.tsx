'use client';

export default function RwgpsConnectDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-gray-300 bg-white text-gray-900 shadow-xl dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100">
        <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <h2 className="text-base font-semibold">Connect RideWithGPS</h2>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Connect your RideWithGPS account to upload generated routes directly to your library. You&apos;ll be
            redirected to RideWithGPS to sign in and authorize course-matcher — your password is never shared with
            this app.
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            Routes land in your default library. RideWithGPS&apos;s API doesn&apos;t support placing them into a
            specific folder — you can move them there manually afterward.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.href = '/api/rwgps/auth';
            }}
            className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            Connect to RideWithGPS
          </button>
        </div>
      </div>
    </div>
  );
}
