const electron = require('electron');
const fs = require('node:fs');

/**
 * Main-side filesystem bridge for Storage.mjs (Fase 1 Slice C).
 * Synchronous calls use ipcMain.on + sendSync (legacy call sites need
 * values inline); everything else is Promise-based (ipcMain.handle).
 * Binary payloads cross IPC as Uint8Array (structured clone).
 */
module.exports = class FsBridge {

    constructor(logger) {
        this._logger = logger;
    }

    register() {
        electron.ipcMain.on('hakuneko:fs:existsSync', (event, path) => {
            event.returnValue = fs.existsSync(path);
        });
        electron.ipcMain.on('hakuneko:fs:mkdirSync', (event, path) => {
            event.returnValue = fs.mkdirSync(path, { recursive: true });
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
