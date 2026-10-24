const electron = require('electron');
const { ConsoleLogger } = require('./Logger');

/**
 * Updates of the web part (connectors and user interface) while the application runs, for the settings of the menu:
 * the version in the cache, whether the update server has another one, installing it (its steps go to the window as
 * `update-progress`, see Updater.updateCache) and reloading the window onto it. The start of the application does the
 * same on its own (App).
 */
module.exports = class UpdateBridge {
    /**
     * @param {Updater} updater
     * @param {CacheDirectoryManager} cacheManager
     * @param {string} publicKey the key that the signature of an update is verified with
     * @param {Logger} logger
     */
    constructor(updater, cacheManager, publicKey, logger) {
        this._logger = logger || new ConsoleLogger(ConsoleLogger.LEVEL.Warn);
        this._updater = updater;
        this._cacheManager = cacheManager;
        this._publicKey = publicKey;
        this._installation = null;
    }

    register() {
        electron.ipcMain.handle('rakkomik:update:current', () => this._current());
        electron.ipcMain.handle('rakkomik:update:check', () => this._check());
        electron.ipcMain.handle('rakkomik:update:apply', (event) => this._apply(event.sender));
        electron.ipcMain.handle('rakkomik:update:restart', (event) => {
            event.sender.reloadIgnoringCache();
        });
    }

    async _current() {
        return (await this._cacheManager.getCurrentVersion()) || null;
    }

    async _check() {
        try {
            return await this._updater.check();
        } catch (error) {
            this._logger.warn('The update server could not be asked', error);
            return { error: error && error.message ? error.message : String(error) };
        }
    }

    _apply(sender) {
        // one installation at a time: a second request gets the outcome of the running one
        if (!this._installation) {
            this._installation = this._install(sender).finally(() => {
                this._installation = null;
            });
        }
        return this._installation;
    }

    async _install(sender) {
        let last = { stage: 'failed', message: 'The update did not start' };
        await this._updater.updateCache(this._publicKey, (status) => {
            last = status;
            if (!sender.isDestroyed()) {
                sender.send('update-progress', status);
            }
        });
        return last;
    }
};
