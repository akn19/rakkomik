// Only require('electron') is available here: preloads run sandboxed on new
// Electron (module not found: path/os otherwise). Everything platform-specific
// is computed in main via synchronous IPC (same modules, same platform).
const { contextBridge, ipcRenderer } = require('electron');

// Renderer-facing bridge (Fase 1: remote -> preload + IPC).
// Synchronous (sendSync) where legacy call sites need values inline,
// Promise-based (invoke) everywhere else. Binary payloads cross IPC as
// Uint8Array (structured clone).
contextBridge.exposeInMainWorld('hakuneko', {
    platform: ipcRenderer.sendSync('hakuneko:app:platform'),
    env: ipcRenderer.sendSync('hakuneko:app:env'),
    os: {
        tmpdir: ipcRenderer.sendSync('hakuneko:os:tmpdir')
    },
    path: {
        sep: ipcRenderer.sendSync('hakuneko:path:sep'),
        join: (...parts) => ipcRenderer.sendSync('hakuneko:path:join', ...parts),
        dirname: p => ipcRenderer.sendSync('hakuneko:path:dirname', p),
        basename: (p, ext) => ipcRenderer.sendSync('hakuneko:path:basename', p, ext),
        extname: p => ipcRenderer.sendSync('hakuneko:path:extname', p),
        parse: p => ipcRenderer.sendSync('hakuneko:path:parse', p),
        normalize: p => ipcRenderer.sendSync('hakuneko:path:normalize', p)
    },
    fs: {
        existsSync: p => ipcRenderer.sendSync('hakuneko:fs:existsSync', p),
        mkdirSync: p => ipcRenderer.sendSync('hakuneko:fs:mkdirSync', p),
        writeFile: (p, data, encoding) => ipcRenderer.invoke('hakuneko:fs:writeFile', p, data, encoding),
        readFile: (p, encoding) => ipcRenderer.invoke('hakuneko:fs:readFile', p, encoding),
        stat: p => ipcRenderer.invoke('hakuneko:fs:stat', p),
        readdir: p => ipcRenderer.invoke('hakuneko:fs:readdir', p)
    },
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
    clipboard: {
        readText: () => ipcRenderer.invoke('hakuneko:clipboard:readText')
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
    },
    presence: {
        ensureStarted: () => ipcRenderer.invoke('hakuneko:presence:ensureStarted'),
        setActivity: status => ipcRenderer.invoke('hakuneko:presence:setActivity', status),
        clearAndDestroy: () => ipcRenderer.invoke('hakuneko:presence:clearAndDestroy')
    },
    // Main-to-renderer subscriptions (whitelisted channels only).
    on: (channel, listener) => {
        const allowed = ['on-before-send-headers', 'on-headers-received', 'on-connector-protocol-handler', 'login', 'close', 'quit'];
        if (!allowed.includes(channel)) {
            throw new Error(`IPC channel "${channel}" is not allowed!`);
        }
        ipcRenderer.on(channel, (event, ...args) => listener(...args));
    },
    send: (channel, ...args) => ipcRenderer.send(channel, ...args)
});
