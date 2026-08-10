'use client';

import { useEffect, useState } from 'react';

export default function RouteNameDialog({
  isOpen,
  initialName,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  initialName: string;
  onClose: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (isOpen) setName(initialName);
  }, [isOpen, initialName]);

  if (!isOpen) return null;

  const canConfirm = name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-300 bg-white text-gray-900 shadow-xl dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100">
        <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <h2 className="text-base font-semibold">Name your route</h2>
        </div>
        <div className="px-5 py-4">
          <label className="block text-sm font-medium">Route name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canConfirm) onConfirm(name.trim());
            }}
            placeholder="Enter a name for this route"
            autoFocus
            className="mt-2 w-full rounded-md border border-gray-300 bg-transparent px-3 py-1.5 text-sm text-gray-900 dark:border-gray-700 dark:text-gray-100"
          />
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
            disabled={!canConfirm}
            onClick={() => canConfirm && onConfirm(name.trim())}
            className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
