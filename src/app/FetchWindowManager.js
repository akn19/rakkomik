const electron = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// How long a hidden window waits for a page to complete its own check before the
// window is shown to the user, and how long the user then gets (both overridable per job).
const DEFAULT_INTERACTIVE_AFTER = 15000;
const DEFAULT_INTERACTIVE_TIMEOUT = 180000;

/**
 * Main-side hidden fetch windows (Fase 1 Slice B: replaces
 * `new (require('electron').remote.BrowserWindow)` in Request.mjs).
 * The full flow (load, interstitial detection, script injection) runs here; the
 * renderer only supplies serializable job parameters and receives the
 * (structured-clone safe) result.
 *
 * A page is loaded like a browser would load it. After every load the detection
 * script (AntiScraping.mjs) classifies what the page shows:
 * - `none`        the content: run the job's script and resolve
 * - `automatic`   an interstitial the page completes on its own: wait for the next load,
 *                 show the window when it takes longer than `interactiveAfter`
 * - `interactive` a human is needed: show the window and extend the deadline
 * - `error`       the site refuses the request: reject at once
 */
module.exports = class FetchWindowManager {

    constructor(logger) {
        this._logger = logger;
    }

    register() {
        electron.ipcMain.handle('rakkomik:fetch', (event, job) => {
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
            preloadFile = path.join(os.tmpdir(), `rakkomik-fetch-${crypto.randomUUID()}.js`);
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

    /**
     * @param {Electron.BrowserWindow} win a hidden window
     * @param {object} job see `_run`
     * @returns {Promise<*>} result of `job.runtimeScript` on the content page
     */
    _load(win, job) {
        const timeout = job.timeout || 60000;
        return new Promise((resolve, reject) => {
            let done = false;
            let shown = false;
            let deadline = null;
            let reveal = null;

            const settle = (callback, value) => {
                if (done) {
                    return;
                }
                done = true; // no other event shall resolve/reject this promise anymore
                clearTimeout(deadline);
                clearTimeout(reveal);
                callback(value);
            };

            const armDeadline = ms => {
                clearTimeout(deadline);
                deadline = setTimeout(() => {
                    settle(reject, new Error(`Failed to load "${job.url}" within the given timeout of ${Math.floor(ms / 1000)} seconds!`));
                }, ms);
            };

            const showToUser = detection => {
                clearTimeout(reveal);
                if (shown) {
                    return;
                }
                shown = true;
                this._log('info', `Showing the window for "${job.url}" to the user (${detection.detector})`);
                win.setSize(1280, 720);
                win.center();
                win.show();
                win.focus();
                // the user gets their own budget, independent of the automated one
                armDeadline(job.interactiveTimeout || DEFAULT_INTERACTIVE_TIMEOUT);
            };

            armDeadline(timeout);

            win.on('closed', () => {
                settle(reject, new Error(`The window for "${job.url}" was closed before the page finished loading!`));
            });

            win.webContents.on('dom-ready', () => {
                if (job.domPreparationScript) {
                    win.webContents.executeJavaScript(job.domPreparationScript).catch(error => this._log('warn', error));
                }
            });

            win.webContents.on('did-fail-load', (event, errCode, errMessage, uri, isMain) => {
                // called whenever any request is blocked by the client (e.g. blacklist feature)
                if (errCode && errCode !== -3 && (isMain || uri === job.url)) {
                    settle(reject, new Error(errMessage + ' ' + uri));
                }
            });

            win.webContents.on('did-finish-load', async () => {
                try {
                    const detection = await this._detect(win, job.scrapingCheckScript);
                    switch (detection.redirection) {
                        case 'error':
                            settle(reject, new Error(detection.message || `The request to "${job.url}" was refused (${detection.detector})`));
                            return;
                        case 'interactive':
                            showToUser(detection);
                            return;
                        case 'automatic':
                            // the page reloads itself when done; the first detection starts the countdown
                            if (!shown && !reveal) {
                                reveal = setTimeout(() => showToUser(detection), job.interactiveAfter || DEFAULT_INTERACTIVE_AFTER);
                            }
                            return;
                        default: {
                            clearTimeout(reveal);
                            const result = await win.webContents.executeJavaScript(job.runtimeScript);
                            settle(resolve, result);
                        }
                    }
                } catch (error) {
                    settle(reject, error);
                }
            });

            win.loadURL(job.url, job.loadOptions || {});
        });
    }

    /**
     * Run the detection script on the current page.
     * @returns {Promise<{ redirection: string, detector?: string, message?: string }>}
     *   plain string results of older detection scripts are accepted as the redirection
     */
    async _detect(win, scrapingCheckScript) {
        if (!scrapingCheckScript) {
            return { redirection: 'none' };
        }
        const result = await win.webContents.executeJavaScript(scrapingCheckScript);
        if (result && typeof result === 'object') {
            return { ...result, redirection: result.redirection || 'none' };
        }
        return { redirection: typeof result === 'string' ? result : 'none', detector: 'legacy' };
    }

    _log(level, message) {
        if (this._logger && typeof this._logger[level] === 'function') {
            this._logger[level](message);
        }
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
                this._log('warn', error);
            }
            browserWindow.close();
        }
    }
};
