import React from 'react';
import { getBookmarks, subscribeBookmarks, deleteBookmark } from '../engine.js';
import { useToast } from '../notify.jsx';
import { ConfirmDialog } from '../dialog.jsx';

export default function BookmarksView() {
    const { notify } = useToast();
    const bookmarks = React.useSyncExternalStore(subscribeBookmarks, getBookmarks);
    const [pending, setPending] = React.useState(null);

    const confirmDelete = () => {
        if (!pending) {
            return;
        }
        try {
            if (deleteBookmark(pending)) {
                notify('Bookmark removed.', 'success');
            } else {
                notify('Bookmark is already gone.', 'info');
            }
        } catch (error) {
            notify(`Failed to remove bookmark: ${error.message}`, 'error');
        } finally {
            setPending(null);
        }
    };

    if (!bookmarks.length) {
        return (
            <div className="mx-auto max-w-3xl rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    No bookmarks yet. Bookmark manga from the library to find them here.
                </p>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-3xl space-y-2 pb-8">
            {bookmarks.map(bookmark => (
                <div
                    key={`${bookmark.key.connector}/${bookmark.key.manga}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900"
                >
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{bookmark.title.manga}</p>
                        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{bookmark.title.connector}</p>
                    </div>
                    <button
                        type="button"
                        title={`Remove ${bookmark.title.manga}`}
                        onClick={() => setPending(bookmark)}
                        className="shrink-0 rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-red-300 hover:text-red-600 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-red-800 dark:hover:text-red-400"
                    >
                        Remove
                    </button>
                </div>
            ))}
            <ConfirmDialog
                open={pending !== null}
                title="Remove bookmark?"
                message={pending ? `"${pending.title.manga}" will be removed from your bookmarks.` : ''}
                confirmLabel="Remove"
                onConfirm={confirmDelete}
                onCancel={() => setPending(null)}
            />
        </div>
    );
}
