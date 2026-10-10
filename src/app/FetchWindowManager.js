const electron = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Main-side hidden fetch windows (Fase 1 Slice B: replaces
 * `new (require('electron').remote.BrowserWindow)` in Request.mjs).
 * The full flow (load, scraping check, script injection) runs here; the
 * renderer only supplies serializable job parameters and receives the
 * (structured-clone safe) result.
 */
module.exports = class FetchWindowManager {

    constructor(logger) {
        this._logger = logger;
    }

    register() {
        electron.ipcMain.handle('hakuneko:fetch', (event, job) => {
            return this._run(job);
        });
    }

    /**
     * @param {object} job serializable fetch parameters from the renderer
     * @returns {Promise<*>} script result
     */
    async _run(job) {
        let preloadFile;
        if (job.preloadScript) {
            preloadFile = path.join(os.tmpdir(), `hakuneko-fetch-${crypto.randomUUID()}.js`);
            await fs.promises.writeFile(preloadFile, job.preloadScript);
        }
        let preferences = job.preferences || {};
        let win = new electron.BrowserWindow({
            show: false,
            webPreferences: {
                preload: preloadFile,
                nodeIntegration: preferences.nodeIntegration || false,
                webSecurity: preferences.webSecurity || false,
                images: preferences.images || false
            }
        });

        if (job.blacklist && job.blacklist.length) {
            win.webContents.session.webRequest.onBeforeRequest({ urls: job.blacklist }, (_, callback) => callback({ cancel: true }));
        }

        try {
            return await this._load(win, job);
        } finally {
            this._cleanup(win);
            if (preloadFile) {
                await fs.promises.unlink(preloadFile).catch(() => undefined);
            }
        }
    }

    _load(win, job) {
        let timeout = job.timeout || 60000;
        let abortAction;
        return new Promise((resolve, reject) => {
            let preventCallback = false;

            abortAction = setTimeout(() => {
                if (!preventCallback) {
                    reject(new Error(`Failed to load "${job.url}" within the given timeout of ${Math.floor(timeout / 1000)} seconds!`));
                }
            }, timeout);

            win.webContents.on('dom-ready', () => win.webContents.executeJavaScript(job.domPreparationScript));

            win.webContents.on('did-fail-load', (event, errCode, errMessage, uri, isMain) => {
                // called whenever any request is blocked by the client (e.g. blacklist feature)
                if (!preventCallback && errCode && errCode !== -3 && (isMain || uri === job.url)) {
                    preventCallback = true;
                    reject(new Error(errMessage + ' ' + uri));
                }
            });

            win.webContents.on('did-finish-load', async () => {
                try {
                    if (await this._checkScrapingRedirection(win, job.scrapingCheckScript)) {
                        return;
                    }
                    let jsResult = await win.webContents.executeJavaScript(job.runtimeScript);
                    preventCallback = true; // no other event shall resolve/reject this promise anymore
                    resolve(jsResult);
                } catch (error) {
                    preventCallback = true; // no other event shall resolve/reject this promise anymore
                    reject(error);
                }
            });

            win.loadURL(job.url, job.loadOptions || {});
        }).finally(() => clearTimeout(abortAction));
    }

    async _checkScrapingRedirection(win, scrapingCheckScript) {
        let scrapeRedirect = await win.webContents.executeJavaScript(scrapingCheckScript);
        if (scrapeRedirect === 'automatic') {
            return true;
        }
        if (scrapeRedirect === 'interactive') {
            win.setSize(1280, 720);
            win.center();
            win.show();
            win.focus();
            return true;
        }
        return false;
    }

    /**
     * Close window and unsubscribe session events
     */
    _cleanup(browserWindow) {
        if (browserWindow && !browserWindow.isDestroyed()) {
            try {
                // unsubscribe events from session
                browserWindow.webContents.session.webRequest.onBeforeRequest(null);
            } catch (error) {
                this._logger && this._logger.warn(error);
            }
            browserWindow.close();
        }
    }
};
