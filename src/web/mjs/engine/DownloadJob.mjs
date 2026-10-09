const events = {
    updated: 'updated'
};

const statusDefinitions = {
    unavailable: 'unavailable', // chapter/manga that cannot be downloaded
    offline: 'offline', // chapter/manga that cannot be downloaded, but exist in manga directory
    available: 'available', // chapter/manga that can be added to the download list
    queued: 'queued', // chapter/manga that is queued for download to the users device
    downloading: 'downloading', // chapter/manga that is currently downloaded to the users device
    completed: 'completed', // chapter/manga that already exist on the users device
    failed: 'failed' // chapter/manga that failed to be downloaded
};

export default class DownloadJob extends EventTarget {

    // TODO: use dependency injection instead of globals for Engine.Storage, Enums
    constructor( chapter ) {
        super();
        this.id = Symbol();
        this.chapter = chapter;
        this.labels = {
            connector: chapter.manga.connector.label,
            manga: chapter.manga.title,
            chapter: chapter.title
        };
        this.requestOptions = chapter.manga.connector.requestOptions || {};
        // TODO: initialize requestOptions.headers = new Headers() if not set
        this.throttle = chapter.manga.connector.config && chapter.manga.connector.config['throttle'] ? chapter.manga.connector.config['throttle'].value : 0;
        this.status = undefined;
        this.progress = 0;
        this.errors = [];
    }

    /**
     *
     */
    isSame( job ) {
        // comparing chapter objects works, because chapters for each manga are cached
        return this.chapter === job.chapter;
        //return ( this.chapter.id === job.chapter.id && this.chapter.manga.id === job.chapter.manga.id && this.chapter.manga.connector.id === job.chapter.manga.connector.id );
    }

    /**
     * Apply a new status for the job and publish the corresponding event.
     */
    setStatus( status ) {
        if( status !== this.status ) {
            this.status = status;
            this.chapter.setStatus( status );
            this.chapter.manga.updateStatus();
            this.dispatchEvent( new CustomEvent( events.updated, { detail: this } ) );
        }
    }

    /**
     * Apply a new status for the job and publish the corresponding event.
     */
    setProgress( progress ) {
        if( progress !== this.progress ) {
            this.progress = progress;
            this.dispatchEvent( new CustomEvent( events.updated, { detail: this } ) );
        }
    }

    /**
     *
     */
    downloadPages( directory, callback ) {
        this.setStatus( statusDefinitions.downloading );
        this.chapter.getPages( ( error, data ) => {
            if( !error && data ) {
                // manga pages
                if( data instanceof Array ) {
                    this._downloadPages( data, directory, callback );
                    return;
                }
            }

            if( error ) {
                this.errors.push( error );
            } else {
                this.errors.push( new Error( 'Page list is empty' ) );
            }
            this.setStatus( statusDefinitions.failed );
            this.setProgress( 100 );
            callback();
        } );
    }

    async _wait(delay) {
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    async _downloadPages(pages, directory, callback) {
        try {
            const content = Engine.Settings.useSequentialMediaDownloads.value ? await this._downloadPagesSequential(pages) : await this._downloadPagesConcurrent(pages);
            await Engine.Storage.saveChapterPages(this.chapter, content);
            this.setProgress(100);
            this.setStatus(statusDefinitions.completed);
            callback();
        } catch(error) {
            this.errors.push(error);
            console.error(error, pages);
            this.setProgress(100);
            this.setStatus(statusDefinitions.failed);
            callback();
        }
    }

    async _downloadPagesSequential(pages) {
        const result = [];
        for(let page of pages) {
            await this._wait(this.throttle);
            // NOTE: bounded per-page timeout — a stalled connection must fail
            // the job instead of leaking activeCount and starving the queue.
            const response = await fetch(page, { ...this.requestOptions, signal: AbortSignal.timeout(120000) });
            if(response.status !== 200 && !Engine.Settings.ignoreErrorOnDownload.value) {
                throw new Error(`Page " ${page}" returned status: ${response.status} - ${response.statusText}`);
            }
            result.push(await response.blob());
            this.setProgress(this.progress + (pages.length ? 100/pages.length : 0));
        }
        return result;
    }

    async _downloadPagesConcurrent(pages) {
        const throttle = this.throttle || 50;
        // get data for all pages of chapter
        let promises = pages.map(async (page, index) => {
            await this._wait(index * throttle);
            // NOTE: bounded per-page timeout — see _downloadPagesSequential.
            const response = await fetch(page, { ...this.requestOptions, signal: AbortSignal.timeout(120000) });
            if(response.status !== 200 && !Engine.Settings.ignoreErrorOnDownload.value) {
                throw new Error(`Page " ${page}" returned status: ${response.status} - ${response.statusText}`);
            }
            this.setProgress(this.progress + (pages.length ? 100/pages.length : 0));
            return response.blob();
        });
        /*
         * TODO: abort/block all other page downloads that are still running for this job ...
         * https://stackoverflow.com/questions/31424561/wait-until-all-es6-promises-complete-even-rejected-promises
         */
        return Promise.all(promises);
    }
}
