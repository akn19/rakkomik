import React from 'react';

/**
 * Minimal owned confirm dialog (shadcn-Dialog-style API, zero extra deps).
 * Rendered inline where needed; overlay blocks interaction while open.
 */
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, onConfirm, onCancel }) {
    if (!open) {
        return null;
    }
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
                {message && (
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                        {cancelLabel || 'Cancel'}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                    >
                        {confirmLabel || 'Delete'}
                    </button>
                </div>
            </div>
        </div>
    );
}
