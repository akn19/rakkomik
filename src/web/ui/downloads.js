import React from 'react';
import { getDownloadJobs, subscribeDownloads, mergeDownloadJobs, cancelDownload, cancelAllDownloads } from './engine.js';
import { useToast } from './notify.jsx';

/**
 * Live download queue (classic jobs.html parity). Shared by the jobs popup
 * in the shell and the full downloads view.
 */
export function useDownloadJobs() {
    const [jobs, setJobs] = React.useState(() => getDownloadJobs());
    React.useEffect(() => subscribeDownloads(event => {
        setJobs(current => mergeDownloadJobs(current, event.detail));
    }), []);
    return jobs;
}

/**
 * A download that waits or runs can be canceled, one that failed (or is over) cannot.
 */
export function isCancelable(job) {
    return job.status === 'queued' || job.status === 'downloading';
}

/**
 * Canceling downloads, one or all of them, with the messages that tell what came of it (shared by the jobs bar and the
 * downloads view).
 */
export function useCancelDownloads() {
    const { notify } = useToast();
    const cancel = job => {
        try {
            if (cancelDownload(job)) {
                notify(`Canceled "${job.labels.chapter}".`, 'success');
            } else {
                notify(`"${job.labels.chapter}" cannot be canceled any more.`, 'info');
            }
        } catch (error) {
            notify(`Cancel failed: ${error.message}`, 'error');
        }
    };
    const cancelAll = () => {
        try {
            const stopped = cancelAllDownloads();
            if (stopped > 0) {
                notify(`Canceled ${stopped} download(s).`, 'success');
            } else {
                notify('No download was left to cancel.', 'info');
            }
        } catch (error) {
            notify(`Cancel failed: ${error.message}`, 'error');
        }
    };
    return { cancel, cancelAll };
}
