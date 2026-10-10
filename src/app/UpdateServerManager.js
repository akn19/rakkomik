const { ConsoleLogger } = require('./Logger');
const UpdatePackageInfo = require('./UpdatePackageInfo');

// a stalled update check must not block the application start forever
const REQUEST_TIMEOUT = 60000;

module.exports = class UpdateServerManager {

    constructor(applicationUpdateURL, logger) {
        this._logger = logger || new ConsoleLogger(ConsoleLogger.LEVEL.Warn);
        // an unusable URL (e.g. `--update-url=DISABLED`) simply disables the updater
        if(URL.canParse(applicationUpdateURL)) {
            this._applicationUpdateURL = applicationUpdateURL;
        } else {
            this._logger.warn('Initialization of "UpdateServerManager" failed!', new Error(`Invalid update URL: ${applicationUpdateURL}`));
            this._applicationUpdateURL = undefined;
        }
    }

    /**
     * Download content via HTTP(S), following redirects.
     * @param {string} uri
     * @returns {Promise<Uint8Array>}
     */
    async _request(uri) {
        if(!uri) {
            throw new Error('Invalid request for connection to the update server!');
        }
        let response;
        try {
            response = await fetch(uri, { redirect: 'follow', signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
        } catch(error) {
            // surface the underlying failure (e.g. ECONNREFUSED, Invalid URL) instead of the generic "fetch failed"
            throw error.cause instanceof Error ? error.cause : error;
        }
        if(response.status !== 200) {
            throw new Error('Status: ' + response.status);
        }
        return new Uint8Array(await response.arrayBuffer());
    }

    /**
     * @returns {Promise<UpdatePackageInfo>}
     */
    async getUpdateInfo() {
        let data = await this._request(this._applicationUpdateURL);
        let link = new TextDecoder().decode(data).trim();
        let resolved = new URL(link, this._applicationUpdateURL);
        return new UpdatePackageInfo(link.split('.')[0], resolved.searchParams.get('signature'), resolved.href);
    }

    /**
     *
     * @param {UpdatePackageInfo} info The update package information received with getUpdateInfo()
     * @returns {Promise<Uint8Array>} A promise that resolves with the received bytes
     */
    getUpdateArchive(info) {
        return this._request(info ? info.link : undefined);
    }
};
