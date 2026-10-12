import DownloadJob from './DownloadJob.mjs';

const statusDefinitions = {
    queued: 'queued', // chapter/manga that is queued for download to the users device
};

export default class DownloadManager extends EventTarget {
    constructor() {
        super();
        this.queue = [];
        // The jobs that run. A job leaves its queue when it starts, so this is where it is found to be stopped.
        this.running = new Set();
        this.worker = setInterval(this.processQueue.bind(this), 250);
    }

    /**
     * Add a new job to the download queue.
     */
    addDownload(chapter) {
        let manga = chapter.manga;
        let connector = manga.connector;

        if (!this.queue[connector.id]) {
            this.queue[connector.id] = [];
            this.queue[connector.id].activeCount = 0;
        }
        // create a job for the chapter and add the job to the download queue (if not already exist)
        let job = new DownloadJob(chapter);
        let jobExist = this.queue[connector.id].find((item) => {
            return job.isSame(item);
        });
        if (!jobExist) {
            // cannot dispatch the same event twice => create new event
            job.addEventListener('updated', (evt) =>
                this.dispatchEvent(new CustomEvent(evt.type, evt)),
            );
            this.queue[connector.id].push(job);
            job.setStatus(statusDefinitions.queued);
        }
    }

    /**
     *
     */
    processQueue() {
        // find a connector in queue that has downloads available and is not locked
        for (let connectorID in this.queue) {
            // check if queue is not empty, there are no active jobs for this connector and the connector is not locked internally through other requests
            if (
                this.queue[connectorID].length > 0 &&
                this.queue[connectorID].activeCount < 1 &&
                !this.queue[connectorID][0].chapter.manga.connector.isLocked
            ) {
                this.queue[connectorID].activeCount++;
                let job = this.queue[connectorID].shift();
                this.running.add(job);
                try {
                    job.downloadPages('', () => {
                        this.running.delete(job);
                        this.queue[connectorID].activeCount--;
                    });
                } catch (error) {
                    // never leak activeCount: a synchronous throw must not
                    // starve all later jobs for this connector
                    console.error(error);
                    job.errors.push(error);
                    job.setStatus('failed');
                    this.running.delete(job);
                    this.queue[connectorID].activeCount--;
                }
            }
        }
    }

    /**
     * The jobs that wait and the jobs that run.
     */
    get jobs() {
        return [
            ...Object.values(this.queue)
                .filter((entry) => Array.isArray(entry))
                .flat(),
            ...this.running,
        ];
    }

    /**
     * Stop a download: a job that waits is taken out of its queue, one that runs is stopped and gives its place back.
     * @param {DownloadJob} job
     * @returns {boolean} whether the job was stopped (not when it is not known, or when its pages are being written)
     */
    cancel(job) {
        let queue = this.queue[job.chapter.manga.connector.id];
        let index = queue ? queue.indexOf(job) : -1;
        if (index > -1) {
            queue.splice(index, 1);
            return job.cancel();
        }
        return this.running.has(job) && job.cancel();
    }

    /**
     * Stop the download of a chapter, wherever it is in the process.
     * @returns {boolean} whether a download was stopped
     */
    cancelChapter(chapter) {
        let job = this.jobs.find((entry) => entry.chapter === chapter);
        return !!job && this.cancel(job);
    }

    /**
     * Stop every download. The jobs that wait go first, so that none of them starts when a job that runs gives its place back.
     * @returns {number} how many downloads were stopped
     */
    cancelAll() {
        let stopped = 0;
        for (let connectorID in this.queue) {
            for (let job of this.queue[connectorID].splice(0)) {
                stopped += job.cancel() ? 1 : 0;
            }
        }
        for (let job of this.running) {
            stopped += job.cancel() ? 1 : 0;
        }
        return stopped;
    }
}
