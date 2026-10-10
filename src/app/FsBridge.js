const electron = require('electron');
const fs = require('node:fs');

/**
 * Main-side filesystem bridge for Storage.mjs (Fase 1 Slice C).
 * Promise-based throughout (ipcMain.handle); binary payloads cross IPC as
 * Uint8Array (structured clone).
 */
module.exports = class FsBridge {

    constructor(logger) {
        this._logger = logger;
    }

    register() {
        electron.ipcMain.handle('hakuneko:fs:mkdir', (event, path) => {
            // recursive: creates the missing parents, no error when it exists
            return fs.promises.mkdir(path, { recursive: true }).then(() => undefined);
        });
        electron.ipcMain.handle('hakuneko:fs:writeFile', (event, path, data, encoding) => {
            let payload = typeof data === 'string' ? data : Buffer.from(data);
            return fs.promises.writeFile(path, payload, encoding).then(() => undefined);
        });
        electron.ipcMain.handle('hakuneko:fs:rename', (event, oldPath, newPath) => {
            // Atomic when both paths share a filesystem (guaranteed by writing
            // temp files next to their target, see Storage._writeFileAtomic).
            return fs.promises.rename(oldPath, newPath).then(() => undefined);
        });
        electron.ipcMain.handle('hakuneko:fs:unlink', (event, path) => {
            return fs.promises.unlink(path).then(() => undefined);
        });
        electron.ipcMain.handle('hakuneko:fs:readFile', (event, path, encoding) => {
            return fs.promises.readFile(path, encoding || undefined).then(data => {
                return typeof data === 'string' ? data : new Uint8Array(data);
            });
        });
        electron.ipcMain.handle('hakuneko:fs:stat', (event, path) => {
            return fs.promises.stat(path).then(stats => {
                return {
                    isDirectory: stats.isDirectory(),
                    isFile: stats.isFile(),
                    size: stats.size
                };
            });
        });
        electron.ipcMain.handle('hakuneko:fs:readdir', (event, path) => {
            return fs.promises.readdir(path);
        });
    }
};
