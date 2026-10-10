// Only require('electron') is available here: preloads run sandboxed on new
// Electron (module not found: path/os otherwise). Everything the renderer needs
// inline (platform, portable flag, temp dir, application paths) arrives once
// through `additionalArguments` (ElectronBootstrap._rendererBootstrap), so no
// call on this bridge blocks the renderer with a synchronous IPC round trip.
const { contextBridge, ipcRenderer } = require('electron');

const BOOTSTRAP_ARGUMENT = '--rakkomik-bootstrap=';
const argument = process.argv.find(arg => arg.startsWith(BOOTSTRAP_ARGUMENT));
if (!argument) {
    throw new Error(`The renderer was started without its bootstrap data (${BOOTSTRAP_ARGUMENT})!`);
}
const bootstrap = JSON.parse(decodeURIComponent(argument.slice(BOOTSTRAP_ARGUMENT.length)));

// Renderer-facing bridge (Fase 1: remote -> preload + IPC), Promise-based (invoke)
// throughout. Binary payloads cross IPC as Uint8Array (structured clone).
// The name of the global is a contract with the engine (src/web/mjs), which reads
// `window.hakuneko` and is deliberately left untouched.
contextBridge.exposeInMainWorld('hakuneko', {
    platform: bootstrap.platform,
    env: bootstrap.env,
    os: {
        tmpdir: bootstrap.tmpdir
    },
    fs: {
        mkdir: p => ipcRenderer.invoke('rakkomik:fs:mkdir', p),
        writeFile: (p, data, encoding) => ipcRenderer.invoke('rakkomik:fs:writeFile', p, data, encoding),
        rename: (oldPath, newPath) => ipcRenderer.invoke('rakkomik:fs:rename', oldPath, newPath),
        unlink: p => ipcRenderer.invoke('rakkomik:fs:unlink', p),
        readFile: (p, encoding) => ipcRenderer.invoke('rakkomik:fs:readFile', p, encoding),
        stat: p => ipcRenderer.invoke('rakkomik:fs:stat', p),
        readdir: p => ipcRenderer.invoke('rakkomik:fs:readdir', p)
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
        showMessageBox: options => ipcRenderer.invoke('rakkomik:dialog:showMessageBox', options),
        showOpenDialog: options => ipcRenderer.invoke('rakkomik:dialog:showOpenDialog', options)
    },
    shell: {
        openExternal: url => ipcRenderer.invoke('rakkomik:shell:openExternal', url),
        showItemInFolder: path => ipcRenderer.invoke('rakkomik:shell:showItemInFolder', path)
    },
    clipboard: {
        readText: () => ipcRenderer.invoke('rakkomik:clipboard:readText')
    },
    window: {
        minimize: () => ipcRenderer.invoke('rakkomik:window:minimize'),
        maximize: () => ipcRenderer.invoke('rakkomik:window:maximize'),
        unmaximize: () => ipcRenderer.invoke('rakkomik:window:unmaximize'),
        isMaximized: () => ipcRenderer.invoke('rakkomik:window:isMaximized'),
        close: () => ipcRenderer.invoke('rakkomik:window:close')
    },
    exec: (command, options) => ipcRenderer.invoke('rakkomik:exec', command, options),
    fetch: job => ipcRenderer.invoke('rakkomik:fetch', job),
    session: {
        getCookies: filter => ipcRenderer.invoke('rakkomik:session:getCookies', filter),
        setCookie: details => ipcRenderer.invoke('rakkomik:session:setCookie', details),
        removeCookie: (url, name) => ipcRenderer.invoke('rakkomik:session:removeCookie', url, name),
        setProxy: config => ipcRenderer.invoke('rakkomik:session:setProxy', config)
    },
    sqlite: {
        query: (bytes, sql) => ipcRenderer.invoke('rakkomik:sqlite:query', bytes, sql)
    },
    presence: {
        ensureStarted: () => ipcRenderer.invoke('rakkomik:presence:ensureStarted'),
        setActivity: status => ipcRenderer.invoke('rakkomik:presence:setActivity', status),
        clearAndDestroy: () => ipcRenderer.invoke('rakkomik:presence:clearAndDestroy')
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
