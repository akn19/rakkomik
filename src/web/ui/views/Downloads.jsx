import React from 'react';
import { restartChapterDownload } from '../engine.js';
import { useDownloadJobs } from '../downloads.js';
import { useToast } from '../notify.jsx';
import { ConfirmDialog } from '../dialog.jsx';

const STATUS_LABEL = {
    unavailable: 'Unavailable',
    offline: 'Offline',
    available: 'Available',
    queued: 'Queued',
    downloading: 'Downloading',
    completed: 'Completed',
    failed: 'Failed'
};

function errorText(job) {
    if (!job.errors || !job.errors.length) {
        return STATUS_LABEL[job.status] || job.status;
    }
    return job.errors.map(error => error.message || String(error)).join('\n');
}

export default function DownloadsView() {
    const { notify } = useToast();
    const jobs = useDownloadJobs();
    const [confirmRestart, setConfirmRestart] = React.useState(null);

    const restart = job => {
        try {
            restartChapterDownload(job.chapter);
            notify(`Restarted download of "${job.labels.chapter}".`, 'success');
        } catch (error) {
            notify(`Restart failed: ${error.message}`, 'error');
        } finally {
            setConfirmRestart(null);
        }
    };

    return (
        <div className="mx-auto max-w-4xl pb-8">
            <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{jobs.length} Download(s)</p>
            {!jobs.length && (
                <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        The queue is empty. Download chapters from the chapter list.
                    </p>
                </div>
            )}
            <div className="space-y-2">
                {jobs.map((job, index) => (
                    <div
                        key={`${job.labels.connector}/${job.labels.manga}/${job.labels.chapter}/${index}`}
                        title={`${job.labels.connector}\n${job.labels.manga}\n${job.labels.chapter}`}
                        className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                title={(job.status === 'failed' || job.status === 'completed')
                                    ? 'Click to download again'
                                    : errorText(job)}
                                onClick={() => {
                                    if (job.status === 'failed' || job.status === 'completed') {
                                        setConfirmRestart(job);
                                    }
                                }}
                                className={
                                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ' +
                                    (job.status === 'failed'
                                        ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                                        : job.status === 'completed'
                                            ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                                            : 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300')
                                }
                            >
                                {STATUS_LABEL[job.status] || job.status}
                            </button>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{job.labels.manga}</p>
                                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                                    {job.labels.chapter} — {job.labels.connector}
                                </p>
                            </div>
                            <span className="shrink-0 text-xs text-zinc-500">{Math.round(job.progress || 0)}%</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                            <div
                                className="h-full rounded-full bg-sky-500"
                                style={{ width: `${Math.min(100, Math.max(0, job.progress || 0))}%` }}
                            />
                        </div>
                        {job.status === 'failed' && job.errors && job.errors.length > 0 && (
                            <p className="mt-1 whitespace-pre-line text-xs text-red-600 dark:text-red-400">{errorText(job)}</p>
                        )}
                    </div>
                ))}
            </div>
            <ConfirmDialog
                open={confirmRestart !== null}
                title="Download again?"
                message={confirmRestart ? `"${confirmRestart.labels.chapter}" will be queued again.` : ''}
                confirmLabel="Download"
                onConfirm={() => restart(confirmRestart)}
                onCancel={() => setConfirmRestart(null)}
            />
        </div>
    );
}
