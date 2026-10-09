import React from 'react';
import { getDownloadJobs, subscribeDownloads, mergeDownloadJobs } from './engine.js';

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
