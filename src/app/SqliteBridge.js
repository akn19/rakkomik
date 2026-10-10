const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');

/**
 * Read-only SQL over a database the renderer hands over as bytes (bookmark
 * import of FMD's SQLite favorites). Backed by Node's built-in `node:sqlite`;
 * the renderer itself ships no SQLite engine any more.
 */
module.exports = class SqliteBridge {

    constructor(logger) {
        this._logger = logger;
    }

    register() {
        electron.ipcMain.handle('rakkomik:sqlite:query', (event, bytes, sql) => {
            return SqliteBridge.query(bytes, sql);
        });
    }

    /**
     * @param {Uint8Array} bytes content of a SQLite database file
     * @param {string} sql a single read-only statement
     * @returns {Promise<Array<object>>} the rows, keyed by column name
     */
    static async query(bytes, sql) {
        // loaded on first use: SQLite is only needed when a user imports bookmarks
        const { DatabaseSync } = require('node:sqlite');
        // `node:sqlite` opens files only, so the bytes land in a private temp directory for the duration of the query
        let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rakkomik-sqlite-'));
        try {
            let file = path.join(directory, 'database.sqlite');
            await fs.writeFile(file, bytes);
            let database = new DatabaseSync(file, { readOnly: true });
            try {
                return database.prepare(sql).all();
            } finally {
                database.close();
            }
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    }
};
