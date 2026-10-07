const electron = require('electron');
const exec = require('child_process').exec;

/**
 * Main-side counterpart of src/app/preload.js `window.hakuneko`.
 * Registers all renderer-invoked channels (Fase 1: remote -> preload + IPC).
 */
module.exports = class IpcBridge {

    constructor(logger) {
        this._logger = logger;
    }

    register() {
        // Synchronous: legacy call sites (Storage, Settings) need the value inline.
        electron.ipcMain.on('hakuneko:app:getPath', (event, name) => {
            event.returnValue = electron.app.getPath(name);
        });
        electron.ipcMain.handle('hakuneko:dialog:showMessageBox', async (event, options) => {
            // dialog.showMessageBox resolves to a button index on old Electron
            // and to { response, checkboxChecked } on new ones — normalize to
            // the index (Fase 1: version-proof across the 8 -> 44 upgrade).
            let result = await electron.dialog.showMessageBox(options);
            return typeof result === 'number' ? result : result.response;
        });
        electron.ipcMain.handle('hakuneko:dialog:showOpenDialog', (event, options) => {
            return electron.dialog.showOpenDialog(options);
        });
        electron.ipcMain.handle('hakuneko:shell:openExternal', (event, url) => {
            return electron.shell.openExternal(url);
        });
        electron.ipcMain.handle('hakuneko:shell:showItemInFolder', (event, path) => {
            electron.shell.showItemInFolder(path);
        });
        electron.ipcMain.handle('hakuneko:clipboard:readText', () => {
            return electron.clipboard.readText();
        });
        electron.ipcMain.handle('hakuneko:window:minimize', event => {
            this._window(event).minimize();
        });
        electron.ipcMain.handle('hakuneko:window:maximize', event => {
            this._window(event).maximize();
        });
        electron.ipcMain.handle('hakuneko:window:unmaximize', event => {
            this._window(event).unmaximize();
        });
        electron.ipcMain.handle('hakuneko:window:isMaximized', event => {
            return this._window(event).isMaximized();
        });
        electron.ipcMain.handle('hakuneko:window:close', event => {
            this._window(event).close();
        });
        electron.ipcMain.handle('hakuneko:exec', (event, command, options) => {
            return new Promise(resolve => {
                exec(command, options, (error, stdout, stderr) => {
                    resolve({
                        error: error ? error.message : undefined,
                        stdout: stdout,
                        stderr: stderr
                    });
                });
            });
        });
        electron.ipcMain.handle('hakuneko:session:getCookies', (event, filter) => {
            return electron.session.defaultSession.cookies.get(filter);
        });
        electron.ipcMain.handle('hakuneko:session:setCookie', (event, details) => {
            return electron.session.defaultSession.cookies.set(details);
        });
        electron.ipcMain.handle('hakuneko:session:removeCookie', (event, url, name) => {
            return electron.session.defaultSession.cookies.remove(url, name);
        });
        electron.ipcMain.handle('hakuneko:session:setProxy', (event, config) => {
            // setProxy is callback-based on old Electron, Promise-based on new —
            // single call, settle on whichever signal fires first.
            return new Promise((resolve, reject) => {
                let result;
                try {
                    result = electron.session.defaultSession.setProxy(config, () => resolve());
                } catch (error) {
                    reject(error);
                    return;
                }
                if (result && typeof result.then === 'function') {
                    result.then(() => resolve(), reject);
                }
            });
        });
    }

    _window(event) {
        return electron.BrowserWindow.fromWebContents(event.sender);
    }
};
