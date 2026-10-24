const { ConsoleLogger } = require('./Logger');

module.exports = class Updater {
    /**
     *
     * @param {UpdateServerManager} serverManager
     * @param {CacheDirectoryManager} cacheManager
     * @param {Logger} logger
     */
    constructor(serverManager, cacheManager, logger) {
        this._logger = logger || new ConsoleLogger(ConsoleLogger.LEVEL.Info);
        this._serverManager = serverManager;
        this._cacheManager = cacheManager;
    }

    /**
     * Whether the update server has another web part than the cache, without downloading it.
     * @returns {Promise<{ disabled: boolean, available: boolean, current?: string, latest?: string }>}
     */
    async check() {
        if (this._serverManager.isDisabled) {
            return { disabled: true, available: false };
        }
        const info = await this._serverManager.getUpdateInfo();
        const current = await this._cacheManager.getCurrentVersion();
        return {
            disabled: false,
            available: info.version !== current,
            current,
            latest: info.version,
        };
    }

    /**
     * @param {string} pubkey
     * @param {function(object)} [report] told every step, for the page that the window shows meanwhile: an object with
     *   the `stage` (`disabled`, `checking`, `current`, `downloading`, `verifying`, `installing`, `updated`, `failed`) and
     *   what goes with it (`version`, `received` and `total` bytes of a download, the `message` of a failure)
     */
    async updateCache(pubkey, report) {
        const tell = (status) => {
            try {
                if (report) {
                    report(status);
                }
            } catch (error) {
                this._logger.warn('The step of the update could not be shown', error);
            }
        };
        if (this._serverManager.isDisabled) {
            this._logger.info('Update is disabled');
            tell({ stage: 'disabled' });
            return;
        }
        try {
            this._logger.info('Checking for Update...');
            tell({ stage: 'checking' });
            let updateInfo = await this._serverManager.getUpdateInfo();
            this._logger.info('Remote Version:', updateInfo.version);
            let currentVersion = await this._cacheManager.getCurrentVersion();
            this._logger.info('Local Version:', currentVersion);
            if (updateInfo.version !== currentVersion) {
                this._logger.info('Starting Update...');
                const version = updateInfo.version;
                tell({ stage: 'downloading', version, received: 0, total: 0 });
                let archive = await this._serverManager.getUpdateArchive(
                    updateInfo,
                    (received, total) => tell({ stage: 'downloading', version, received, total }),
                );
                tell({ stage: 'verifying', version });
                await updateInfo.validate(archive, pubkey);
                tell({ stage: 'installing', version });
                await this._cacheManager.applyUpdateArchive(updateInfo.version, archive);
                this._logger.info('Update Complete');
                tell({ stage: 'updated', version });
            } else {
                this._logger.info('Update Check Complete');
                tell({ stage: 'current', version: currentVersion });
            }
        } catch (error) {
            this._logger.error('Update Failed!', error);
            tell({
                stage: 'failed',
                message: error && error.message ? error.message : String(error),
            });
        }
    }
};
