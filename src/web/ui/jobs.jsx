import React from 'react';
import { restartChapterDownload } from './engine.js';
import { useDownloadJobs, useCancelDownloads, isCancelable } from './downloads.js';
import { useToast } from './notify.jsx';
import { ConfirmDialog } from './dialog.jsx';
import Icon from './icon.jsx';

// Classic jobs.html getStatusClass parity (icon + token color per status). The label is what a screen reader reads.
const STATUS = {
    queued: { icon: 'clock', color: 'text-(--job-list-button-queued-color)', label: 'Queued' },
    downloading: {
        icon: 'exchange',
        color: 'text-(--job-list-button-downloading-color)',
        label: 'Downloading',
    },
    completed: {
        icon: 'check',
        color: 'text-(--job-list-button-completed-color)',
        label: 'Completed',
    },
    failed: { icon: 'warning', color: 'text-(--job-list-button-failed-color)', label: 'Failed' },
};

function errorTitle(job) {
    const errors = job.errors || [];
    return (
        (errors.length > 0 ? 'Click to re-download\n' : '') +
        errors.map((error) => error.toString()).join('\n')
    );
}

// a job that is done, well or not, can be downloaded again
function restartable(job) {
    return job.status === 'failed' || job.status === 'completed';
}

/**
 * Download bar of the control column (classic jobs.html parity): the
 * expandable job list sits above a bar with the toggle and the counter.
 */
export default function JobsBar({ inert }) {
    const { notify } = useToast();
    const jobs = useDownloadJobs();
    const { cancel, cancelAll } = useCancelDownloads();
    const [open, setOpen] = React.useState(false);
    const [confirmAll, setConfirmAll] = React.useState(false);
    const listId = React.useId();
    const active = jobs.filter(isCancelable);

    const restart = (job) => {
        if (!restartable(job)) {
            return;
        }
        try {
            restartChapterDownload(job.chapter);
        } catch (error) {
            notify(`Restart failed: ${error.message}`, 'error');
        }
    };

    return (
        <section
            aria-label="Downloads"
            inert={inert || undefined}
            className="w-full bg-(--job-control-background-color)"
        >
            {open && (
                <div
                    id={listId}
                    className="h-[8em] overflow-x-hidden overflow-y-scroll bg-(--job-list-background-color)"
                >
                    {jobs.length === 0 && (
                        <p className="p-[0.5em] text-(--menu-control-category-color)">
                            No downloads.
                        </p>
                    )}
                    <table className="w-full table-fixed border-collapse">
                        <caption className="sr-only">
                            Download list: status, website, manga, chapter, progress
                        </caption>
                        {/* the manga takes what is left: the website is mostly a short name, the chapter and the
                            progress get the room that their text needs */}
                        <colgroup>
                            <col className="w-[1.75em]" />
                            <col className="w-[16%]" />
                            <col />
                            <col className="w-[24%]" />
                            <col className="w-[6.5em]" />
                            <col className="w-[1.75em]" />
                        </colgroup>
                        <tbody>
                            {jobs.map((job, index) => {
                                const status = STATUS[job.status];
                                const errors = (job.errors || [])
                                    .map((error) => error.toString())
                                    .join('; ');
                                const progress = Math.min(100, Math.max(0, job.progress || 0));
                                return (
                                    <tr
                                        key={`${job.labels.connector}/${job.labels.manga}/${job.labels.chapter}/${index}`}
                                        title={`${job.labels.connector}\n${job.labels.manga}\n${job.labels.chapter}`}
                                    >
                                        <td className="cursor-default text-center [border-bottom:var(--job-list-row-border)]">
                                            {status && restartable(job) && (
                                                <button
                                                    type="button"
                                                    title={errorTitle(job)}
                                                    aria-label={`${status.label}${errors ? ` (${errors})` : ''}: download again`}
                                                    onClick={() => restart(job)}
                                                    className={'align-middle ' + status.color}
                                                >
                                                    <Icon name={status.icon} size={13} />
                                                </button>
                                            )}
                                            {status && !restartable(job) && (
                                                <span
                                                    role="img"
                                                    aria-label={status.label}
                                                    className={
                                                        'inline-block align-middle ' + status.color
                                                    }
                                                >
                                                    <Icon name={status.icon} size={13} />
                                                </span>
                                            )}
                                        </td>
                                        <td className="cursor-default overflow-hidden px-[0.25em] text-ellipsis whitespace-nowrap [border-bottom:var(--job-list-row-border)]">
                                            {job.labels.connector}
                                        </td>
                                        <td className="cursor-default overflow-hidden px-[0.25em] text-ellipsis whitespace-nowrap [border-bottom:var(--job-list-row-border)]">
                                            {job.labels.manga}
                                        </td>
                                        <td className="cursor-default overflow-hidden px-[0.25em] text-ellipsis whitespace-nowrap [border-bottom:var(--job-list-row-border)]">
                                            {job.labels.chapter}
                                        </td>
                                        <td className="cursor-default px-[0.25em] whitespace-nowrap [border-bottom:var(--job-list-row-border)]">
                                            <span
                                                aria-hidden="true"
                                                className="inline-block h-[0.375em] w-[calc(100%-3em)] overflow-hidden rounded-full bg-(--job-list-progress-background-color) align-middle"
                                            >
                                                <span
                                                    className="block h-full rounded-full bg-(--job-list-progress-color)"
                                                    style={{ width: `${progress}%` }}
                                                />
                                            </span>
                                            <span className="inline-block w-[3em] text-right align-middle tabular-nums">
                                                {Math.round(progress)}%
                                            </span>
                                        </td>
                                        <td className="cursor-default text-center [border-bottom:var(--job-list-row-border)]">
                                            {isCancelable(job) && (
                                                <button
                                                    type="button"
                                                    title="Cancel this download"
                                                    aria-label={`Cancel the download of ${job.labels.chapter}`}
                                                    onClick={() => cancel(job)}
                                                    className="rk-icon cursor-pointer align-middle"
                                                >
                                                    <Icon name="close" size={13} />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            <div className="flex p-[0.25em]">
                <div className="p-[0.25em]">
                    <button
                        type="button"
                        title="Toggle download list"
                        aria-label={open ? 'Hide the download list' : 'Show the download list'}
                        aria-expanded={open}
                        aria-controls={open ? listId : undefined}
                        onClick={() => setOpen((value) => !value)}
                        className="rk-button"
                    >
                        <Icon name={open ? 'closeBox' : 'chart'} size={16} />
                    </button>
                </div>
                <div className="p-[0.25em]">
                    <button
                        type="button"
                        title="Cancel all downloads"
                        aria-label="Cancel all downloads"
                        disabled={active.length === 0}
                        onClick={() => setConfirmAll(true)}
                        className="rk-button disabled:cursor-not-allowed disabled:opacity-25"
                    >
                        <Icon name="ban" size={16} />
                    </button>
                </div>
                <div role="status" className="flex-1 p-[0.25em] text-right">
                    {jobs.length} Download(s)
                </div>
            </div>
            <ConfirmDialog
                open={confirmAll}
                title="Cancel all downloads?"
                message={`${active.length} download(s) that wait or run will be stopped.`}
                confirmLabel="Cancel downloads"
                cancelLabel="Keep them"
                onConfirm={() => {
                    setConfirmAll(false);
                    cancelAll();
                }}
                onCancel={() => setConfirmAll(false)}
            />
        </section>
    );
}
