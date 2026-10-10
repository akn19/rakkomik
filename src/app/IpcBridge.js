const { exec } = require('node:child_process');
const electron = require('electron');

/**
 * Main-side counterpart of the preload bridge (src/app/preload.js).
 * Registers all renderer-invoked channels (Fase 1: remote -> preload + IPC).
 * Everything is Promise-based: the values the renderer needs inline (platform,
 * paths, ...) are handed to the preload at window creation (ElectronBootstrap).
 */
module.exports = class IpcBridge {

    constructor(logger) {
        this._logger = logger;
    }

    register() {
        electron.ipcMain.handle('rakkomik:dialog:showMessageBox', async (event, options) => {
            // the renderer's confirm()/alert() shims expect the button index
            return (await electron.dialog.showMessageBox(options)).response;
        });
        electron.ipcMain.handle('rakkomik:dialog:showOpenDialog', (event, options) => {
            return electron.dialog.showOpenDialog(options);
        });
        electron.ipcMain.handle('rakkomik:shell:openExternal', (event, url) => {
            return electron.shell.openExternal(url);
        });
        electron.ipcMain.handle('rakkomik:shell:showItemInFolder', (event, path) => {
            electron.shell.showItemInFolder(path);
        });
        electron.ipcMain.handle('rakkomik:clipboard:readText', () => {
            return electron.clipboard.readText();
        });
        electron.ipcMain.handle('rakkomik:window:minimize', event => {
            this._window(event).minimize();
        });
        electron.ipcMain.handle('rakkomik:window:maximize', event => {
            this._window(event).maximize();
        });
        electron.ipcMain.handle('rakkomik:window:unmaximize', event => {
            this._window(event).unmaximize();
        });
        electron.ipcMain.handle('rakkomik:window:isMaximized', event => {
            return this._window(event).isMaximized();
        });
        electron.ipcMain.handle('rakkomik:window:close', event => {
            this._window(event).close();
        });
        electron.ipcMain.handle('rakkomik:exec', (event, command, options) => {
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
        electron.ipcMain.handle('rakkomik:session:getCookies', (event, filter) => {
            return electron.session.defaultSession.cookies.get(filter);
        });
        electron.ipcMain.handle('rakkomik:session:setCookie', (event, details) => {
            return electron.session.defaultSession.cookies.set(details);
        });
        electron.ipcMain.handle('rakkomik:session:removeCookie', (event, url, name) => {
            return electron.session.defaultSession.cookies.remove(url, name);
        });
        electron.ipcMain.handle('rakkomik:session:setProxy', (event, config) => {
            return electron.session.defaultSession.setProxy(config);
        });
    }

    _window(event) {
        return electron.BrowserWindow.fromWebContents(event.sender);
    }
};
