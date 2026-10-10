const path = require('node:path');
const fs = require('node:fs/promises');
const { unzipSync } = require('fflate');
const { ConsoleLogger } = require('./Logger');

module.exports = class CacheDirectoryManager {

    /**
     *
     * @param {string} applicationCacheDirectory
     * @param {Logger} logger
     */
    constructor(applicationCacheDirectory, logger) {
        try {
            this._logger = logger || new ConsoleLogger(ConsoleLogger.LEVEL.Warn);
            this._applicationCacheDirectory = path.normalize(applicationCacheDirectory);
            this._versionFile = path.join(this._applicationCacheDirectory, 'version');
        } catch(error) {
            this._applicationCacheDirectory = undefined;
            this._versionFile = undefined;
        }
    }

    /**
     *
     * @returns {Promise<string>}
     */
    getCurrentVersion() {
        return fs.readFile(this._versionFile, 'utf8')
            .catch(() => Promise.resolve(undefined));
    }

    /**
     * Target path of an archive entry, refusing entries that would escape the cache directory.
     * @param {string} entry
     * @returns {string}
     */
    _entryPath(entry) {
        let root = path.resolve(this._applicationCacheDirectory);
        let file = path.resolve(root, entry);
        if(!file.startsWith(root + path.sep)) {
            throw new Error(`Refusing to extract "${entry}" outside of the cache directory!`);
        }
        return file;
    }

    /**
     * Replace the content of the cache directory with the content of the (ZIP) archive.
     * The archive is parsed before the cache is removed, so an invalid archive keeps the current cache.
     * @param {string} version
     * @param {Uint8Array} data
     * @returns {Promise<void>}
     */
    async applyUpdateArchive(version, data) {
        // directory entries (names ending with a slash) are implied by the files inside them
        let entries = Object.entries(unzipSync(data)).filter(([ entry ]) => !entry.endsWith('/'));
        let files = entries.map(([ entry, bytes ]) => [ this._entryPath(entry), bytes ]);
        await fs.rm(this._applicationCacheDirectory, { recursive: true, force: true });
        await Promise.all(files.map(async ([ file, bytes ]) => {
            this._logger.verbose('Extracting:', file);
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, bytes);
        }));
        await fs.writeFile(this._versionFile, version);
    }
};
