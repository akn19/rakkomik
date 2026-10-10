import React from 'react';
import { restartChapterDownload } from './engine.js';
import { useDownloadJobs } from './downloads.js';
import { useToast } from './notify.jsx';
import Icon from './icon.jsx';

// Classic jobs.html getStatusClass parity (icon + token color per status).
const STATUS = {
    queued: { icon: 'clock', color: 'text-(--job-list-button-queued-color)' },
    downloading: { icon: 'exchange', color: 'text-(--job-list-button-downloading-color)' },
    completed: { icon: 'check', color: 'text-(--job-list-button-completed-color)' },
    failed: { icon: 'warning', color: 'text-(--job-list-button-failed-color)' }
};

function errorTitle(job) {
    const errors = job.errors || [];
    return (errors.length > 0 ? 'Click to re-download\n' : '') + errors.map(error => error.toString()).join('\n');
}

/**
 * Download bar of the control column (classic jobs.html parity): the
 * expandable job list sits above a bar with the toggle and the counter.
 */
export default function JobsBar() {
    const { notify } = useToast();
    const jobs = useDownloadJobs();
    const [open, setOpen] = React.useState(false);

    const restart = job => {
        if (job.status !== 'failed' && job.status !== 'completed') {
            return;
        }
        try {
            restartChapterDownload(job.chapter);
        } catch (error) {
            notify(`Restart failed: ${error.message}`, 'error');
        }
    };

    return (
        <div className="w-full bg-(--job-control-background-color)">
            {open && (
                <div className="h-[8em] overflow-y-scroll bg-(--job-list-background-color)">
                    {jobs.length === 0 && <p className="p-[0.5em] opacity-60">No downloads.</p>}
                    <table className="w-full table-fixed border-collapse">
                        <tbody>
                            {jobs.map((job, index) => {
                                const status = STATUS[job.status];
                                return (
                                    <tr
                                        key={`${job.labels.connector}/${job.labels.manga}/${job.labels.chapter}/${index}`}
                                        title={`${job.labels.connector}\n${job.labels.manga}\n${job.labels.chapter}`}
                                    >
                                        <td className="w-[1.25em] cursor-default text-center [border-bottom:var(--job-list-row-border)]">
                                            {status && (
                                                <button
                                                    type="button"
                                                    title={errorTitle(job)}
                                                    onClick={() => restart(job)}
                                                    className={'align-middle ' + status.color}
                                                >
                                                    <Icon name={status.icon} size={13} />
                                                </button>
                                            )}
                                        </td>
                                        <td className="cursor-default overflow-hidden px-[0.25em] text-ellipsis whitespace-nowrap [border-bottom:var(--job-list-row-border)]">{job.labels.connector}</td>
                                        <td className="cursor-default overflow-hidden px-[0.25em] text-ellipsis whitespace-nowrap [border-bottom:var(--job-list-row-border)]">{job.labels.manga}</td>
                                        <td className="cursor-default overflow-hidden px-[0.25em] text-ellipsis whitespace-nowrap [border-bottom:var(--job-list-row-border)]">{job.labels.chapter}</td>
                                        <td
                                            className="w-[4em] [border-bottom:var(--job-list-row-border)]"
                                            style={{
                                                background: `linear-gradient(90deg, var(--job-list-progress-color) ${job.progress || 0}%, var(--job-list-progress-background-color) 0%)`
                                            }}
                                        />
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
                        onClick={() => setOpen(value => !value)}
                        className="rk-button"
                    >
                        <Icon name={open ? 'close' : 'chart'} size={16} />
                    </button>
                </div>
                <div className="flex-1 p-[0.25em] text-right">{jobs.length} Download(s)</div>
            </div>
        </div>
    );
}
