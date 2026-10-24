const { ConsoleLogger } = require('./Logger');
const UpdatePackageInfo = require('./UpdatePackageInfo');

// a stalled update check must not block the application start forever
const REQUEST_TIMEOUT = 60000;

module.exports = class UpdateServerManager {
    constructor(applicationUpdateURL, logger) {
        this._logger = logger || new ConsoleLogger(ConsoleLogger.LEVEL.Warn);
        // an unusable URL simply disables the updater: `DISABLED` on purpose (packaged applications bring their own
        // web part), anything else is a mistake that is worth a warning
        if (URL.canParse(applicationUpdateURL)) {
            this._applicationUpdateURL = applicationUpdateURL;
        } else {
            if (applicationUpdateURL !== 'DISABLED') {
                this._logger.warn(
                    'Initialization of "UpdateServerManager" failed!',
                    new Error(`Invalid update URL: ${applicationUpdateURL}`),
                );
            }
            this._applicationUpdateURL = undefined;
        }
    }

    /**
     * @returns {boolean} true when there is no usable update URL
     */
    get isDisabled() {
        return this._applicationUpdateURL === undefined;
    }

    /**
     * Download content via HTTP(S), following redirects.
     * @param {string} uri
     * @param {function(number, number)} [onProgress] told the bytes received so far and the size of the content (0 when
     *   the server does not say it), after every part of the content
     * @returns {Promise<Uint8Array>}
     */
    async _request(uri, onProgress) {
        if (!uri) {
            throw new Error('Invalid request for connection to the update server!');
        }
        let response;
        try {
            response = await fetch(uri, {
                redirect: 'follow',
                signal: AbortSignal.timeout(REQUEST_TIMEOUT),
            });
        } catch (error) {
            // surface the underlying failure (e.g. ECONNREFUSED, Invalid URL) instead of the generic "fetch failed"
            throw error.cause instanceof Error ? error.cause : error;
        }
        if (response.status !== 200) {
            throw new Error('Status: ' + response.status);
        }
        if (!onProgress || !response.body) {
            return new Uint8Array(await response.arrayBuffer());
        }
        const total = Number(response.headers.get('content-length')) || 0;
        const parts = [];
        let received = 0;
        for await (const part of response.body) {
            parts.push(part);
            received += part.length;
            onProgress(received, total);
        }
        const data = new Uint8Array(received);
        let offset = 0;
        for (const part of parts) {
            data.set(part, offset);
            offset += part.length;
        }
        return data;
    }

    /**
     * @returns {Promise<UpdatePackageInfo>}
     */
    async getUpdateInfo() {
        let data = await this._request(this._applicationUpdateURL);
        let link = new TextDecoder().decode(data).trim();
        let resolved = new URL(link, this._applicationUpdateURL);
        return new UpdatePackageInfo(
            link.split('.')[0],
            resolved.searchParams.get('signature'),
            resolved.href,
        );
    }

    /**
     *
     * @param {UpdatePackageInfo} info The update package information received with getUpdateInfo()
     * @param {function(number, number)} [onProgress] see `_request`
     * @returns {Promise<Uint8Array>} A promise that resolves with the received bytes
     */
    getUpdateArchive(info, onProgress) {
        return this._request(info ? info.link : undefined, onProgress);
    }
};
