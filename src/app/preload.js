// Only require('electron') is available here: preloads run sandboxed on new
// Electron (module not found: path/os otherwise). Everything the renderer needs
// inline (platform, portable flag, temp dir, application paths) arrives once
// through `additionalArguments` (ElectronBootstrap._rendererBootstrap), so no
// call on this bridge blocks the renderer with a synchronous IPC round trip.
const { contextBridge, ipcRenderer } = require('electron');

const BOOTSTRAP_ARGUMENT = '--hakuneko-bootstrap=';
const argument = process.argv.find(arg => arg.startsWith(BOOTSTRAP_ARGUMENT));
if (!argument) {
    throw new Error(`The renderer was started without its bootstrap data (${BOOTSTRAP_ARGUMENT})!`);
}
const bootstrap = JSON.parse(decodeURIComponent(argument.slice(BOOTSTRAP_ARGUMENT.length)));

// Renderer-facing bridge (Fase 1: remote -> preload + IPC), Promise-based (invoke)
// throughout. Binary payloads cross IPC as Uint8Array (structured clone).
contextBridge.exposeInMainWorld('hakuneko', {
    platform: bootstrap.platform,
    env: bootstrap.env,
    os: {
        tmpdir: bootstrap.tmpdir
    },
    fs: {
        mkdir: p => ipcRenderer.invoke('hakuneko:fs:mkdir', p),
        writeFile: (p, data, encoding) => ipcRenderer.invoke('hakuneko:fs:writeFile', p, data, encoding),
        rename: (oldPath, newPath) => ipcRenderer.invoke('hakuneko:fs:rename', oldPath, newPath),
        unlink: p => ipcRenderer.invoke('hakuneko:fs:unlink', p),
        readFile: (p, encoding) => ipcRenderer.invoke('hakuneko:fs:readFile', p, encoding),
        stat: p => ipcRenderer.invoke('hakuneko:fs:stat', p),
        readdir: p => ipcRenderer.invoke('hakuneko:fs:readdir', p)
    },
    app: {
        // same contract as Electron's app.getPath: a name without a directory throws
        getPath: name => {
            if (!Object.hasOwn(bootstrap.paths, name)) {
                throw new Error(`Failed to get '${name}' path`);
            }
            return bootstrap.paths[name];
        }
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
    sqlite: {
        query: (bytes, sql) => ipcRenderer.invoke('hakuneko:sqlite:query', bytes, sql)
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
