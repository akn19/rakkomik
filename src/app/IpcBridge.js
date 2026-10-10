const os = require('node:os');
const path = require('node:path');
const { exec } = require('node:child_process');
const electron = require('electron');

/**
 * Main-side counterpart of src/app/preload.js `window.hakuneko`.
 * Registers all renderer-invoked channels (Fase 1: remote -> preload + IPC).
 */
module.exports = class IpcBridge {

    constructor(logger) {
        this._logger = logger;
    }

    register() {
        // Synchronous: legacy call sites (Storage, Settings, preload) need values inline.
        electron.ipcMain.on('hakuneko:app:getPath', (event, name) => {
            event.returnValue = electron.app.getPath(name);
        });
        electron.ipcMain.on('hakuneko:app:platform', event => {
            event.returnValue = process.platform;
        });
        electron.ipcMain.on('hakuneko:app:env', event => {
            event.returnValue = { HAKUNEKO_PORTABLE: process.env.HAKUNEKO_PORTABLE };
        });
        electron.ipcMain.on('hakuneko:os:tmpdir', event => {
            event.returnValue = os.tmpdir();
        });
        electron.ipcMain.on('hakuneko:path:sep', event => {
            event.returnValue = path.sep;
        });
        for (const method of ['join', 'dirname', 'basename', 'extname', 'parse', 'normalize']) {
            electron.ipcMain.on(`hakuneko:path:${method}`, (event, ...args) => {
                event.returnValue = path[method](...args);
            });
        }
        electron.ipcMain.handle('hakuneko:dialog:showMessageBox', async (event, options) => {
            // the renderer's confirm()/alert() shims expect the button index
            return (await electron.dialog.showMessageBox(options)).response;
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
            return electron.session.defaultSession.setProxy(config);
        });
    }

    _window(event) {
        return electron.BrowserWindow.fromWebContents(event.sender);
    }
};
