const { ipcRenderer } = require('electron');

// Renderer-facing bridge (Fase 1: remote -> preload + IPC).
// NOTE: attached directly (no contextBridge) while contextIsolation is off —
// identical posture to the current nodeIntegration sandbox. Converted to
// contextBridge.exposeInMainWorld at the isolation flip (Fase 1 Slice D).
// Synchronous where the legacy call sites require it (app.getPath),
// Promise-based (ipcRenderer.invoke) everywhere else.
window.hakuneko = {
    platform: process.platform,
    app: {
        getPath: name => ipcRenderer.sendSync('hakuneko:app:getPath', name)
    },
    dialog: {
        showMessageBox: options => ipcRenderer.invoke('hakuneko:dialog:showMessageBox', options),
        showOpenDialog: options => ipcRenderer.invoke('hakuneko:dialog:showOpenDialog', options)
    },
    shell: {
        openExternal: url => ipcRenderer.invoke('hakuneko:shell:openExternal', url),
        showItemInFolder: path => ipcRenderer.invoke('hakuneko:shell:showItemInFolder', path)
    },
    window: {
        minimize: () => ipcRenderer.invoke('hakuneko:window:minimize'),
        maximize: () => ipcRenderer.invoke('hakuneko:window:maximize'),
        unmaximize: () => ipcRenderer.invoke('hakuneko:window:unmaximize'),
        isMaximized: () => ipcRenderer.invoke('hakuneko:window:isMaximized'),
        close: () => ipcRenderer.invoke('hakuneko:window:close')
    },
    exec: (command, options) => ipcRenderer.invoke('hakuneko:exec', command, options),
    fetch: job => ipcRenderer.invoke('hakuneko:fetch', job),
    session: {
        getCookies: filter => ipcRenderer.invoke('hakuneko:session:getCookies', filter),
        setCookie: details => ipcRenderer.invoke('hakuneko:session:setCookie', details),
        removeCookie: (url, name) => ipcRenderer.invoke('hakuneko:session:removeCookie', url, name),
        setProxy: config => ipcRenderer.invoke('hakuneko:session:setProxy', config)
    }
};
