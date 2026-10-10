const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const electron = require('electron');
const HeaderSurgery = require('./HeaderSurgery');
const { ConsoleLogger } = require('./Logger');
const urlFilterAll = { urls: ['http://*/*', 'https://*/*'] };
const trayTooltipMinimize = 'RakKomik\nClick to hide window';
const trayTooltipRestore = 'RakKomik\nClick to show window';

module.exports = class ElectronBootstrap {

    constructor(configuration, logger) {
        this._logger = logger || new ConsoleLogger(ConsoleLogger.LEVEL.Warn);
        this._configuration = configuration;
        this._window = null;
        // NOTE: corsEnabled:true is mandatory on modern Chromium, otherwise
        // fetch() to these schemes fails with CorsDisabledScheme.
        this._schemes = [
            {
                scheme: this._configuration.applicationProtocol,
                privileges: {
                    secure: true,
                    standard: true,
                    supportFetchAPI: true,
                    corsEnabled: true
                }
            },
            // NOTE: connector:// needs secure:true — fetch() from the secure
            // app scheme to a non-secure scheme is blocked as mixed content.
            {
                scheme: this._configuration.connectorProtocol,
                privileges: {
                    secure: true,
                    standard: true,
                    supportFetchAPI: true,
                    corsEnabled: true
                }
            }
        ];
        this._directoryMap = {
            'cache': this._configuration.applicationCacheDirectory,
            'plugins': this._configuration.applicationUserPluginsDirectory
        };
        this._appIcon;
        this._minimizeToTray = false; // only supported when tray is shown
        this._showTray = false;
        this._tray;
    }

    /**
     *
     */
    async launch() {
        /*
         * See: https://fossies.org/linux/electron/atom/browser/api/atom_api_protocol.cc
         * { standard, secure, bypassCSP, corsEnabled, supportFetchAPI, allowServiceWorkers }
         */
        electron.protocol.registerSchemesAsPrivileged(this._schemes);

        // One user agent for everything (renderer fetch(), hidden fetch windows, navigator.userAgent):
        // Chromium's own, without the Electron and application product tokens that websites do not
        // know. Cookies granted by anti-bot interstitials are bound to the user agent that earned them.
        const products = [ 'Electron', electron.app.name ].map(name => RegExp.escape(name)).join('|');
        electron.app.userAgentFallback = electron.app.userAgentFallback.replace(new RegExp(` (?:${products})/\\S+`, 'g'), '');

        // update userdata path (e.g. for portable version)
        electron.app.setPath('userData', this._configuration.applicationUserDataDirectory);

        /*
         * HACK: Create a dummy menu to support local hotkeys (only accessable when app is focused)
         *       This has to be done, because F12 key cannot be used as global key in windows
         */
        this._registerLocalHotkeys();

        /*
         * HACK: prevent default in main process, because it cannot be done in render process:
         *       see: https://github.com/electron/electron/issues/9428#issuecomment-300669586
         * Proxy credentials are provided by the renderer (Request._loginHandler).
         */
        electron.app.on('login', (event, webContents, request, authInfo, callback) => {
            event.preventDefault();
            this._provideLoginCredentials(authInfo)
                .then(credentials => credentials ? callback(...credentials) : callback())
                .catch(() => callback());
        });
        electron.app.on('activate', this._createWindow.bind(this));
        electron.app.on('window-all-closed', this._allWindowsClosedHandler.bind(this));
        electron.app.on('certificate-error', this._certificateErrorHandler.bind(this));

        await electron.app.whenReady();
        this._appIcon = electron.nativeImage.createFromPath(path.join(this._configuration.applicationCacheDirectory, 'img', 'tray', process.platform === 'win32' ? 'logo.ico' : 'logo.png'));
        this._registerCacheProtocol();
        this._registerConnectorProtocol();
        this._createWindow();
    }

    // Explicit MIME map for protocol.handle (Fase 1 Slice D). The legacy
    // registerBufferProtocol relied on Chromium content sniffing ("autodetect")
    // which no longer exists; module scripts additionally require an explicit
    // JavaScript MIME type. Extensionless connector icons fall back to
    // application/octet-stream (still rendered by <img>).
    _mimeType(file) {
        if(file.endsWith('.mjs') || file.endsWith('.js')) {
            return 'text/javascript';
        }
        if(file.endsWith('.html')) {
            return 'text/html';
        }
        if(file.endsWith('.css')) {
            return 'text/css';
        }
        if(file.endsWith('.json') || file.endsWith('.map')) {
            return 'application/json';
        }
        if(file.endsWith('.png')) {
            return 'image/png';
        }
        if(file.endsWith('.jpg') || file.endsWith('.jpeg')) {
            return 'image/jpeg';
        }
        if(file.endsWith('.gif')) {
            return 'image/gif';
        }
        if(file.endsWith('.webp')) {
            return 'image/webp';
        }
        if(file.endsWith('.avif')) {
            return 'image/avif';
        }
        if(file.endsWith('.bmp')) {
            return 'image/bmp';
        }
        if(file.endsWith('.svg')) {
            return 'image/svg+xml';
        }
        if(file.endsWith('.ico')) {
            return 'image/x-icon';
        }
        if(file.endsWith('.woff2')) {
            return 'font/woff2';
        }
        return 'application/octet-stream';
    }

    /**
     *
     */
    _registerCacheProtocol() {
        electron.protocol.handle(this._configuration.applicationProtocol, async request => {
            try {
                let uri = new URL(request.url);
                let endpoint = path.join(this._directoryMap[uri.hostname], path.normalize(uri.pathname));
                // NOTE: cross-scheme consumers (connector:// images, fetch windows)
                // require explicit CORS headers on modern Chromium.
                let cors = { 'Access-Control-Allow-Origin': '*' };
                let stats = null;
                try {
                    stats = await fs.promises.stat(endpoint);
                } catch(error) {
                    if(error.code === 'ENOENT' || error.code === 'ENOTDIR') {
                        return new Response('Not Found', { status: 404 });
                    }
                    throw error;
                }
                if(stats.isDirectory()) {
                    let buffer = Buffer.from(JSON.stringify(await fs.promises.readdir(endpoint)));
                    return new Response(buffer, { headers: { ...cors, 'Content-Type': 'application/json' } });
                }
                let buffer = await fs.promises.readFile(endpoint);
                return new Response(buffer, { headers: { ...cors, 'Content-Type': this._mimeType(endpoint) } });
            } catch(error) {
                this._logger.warn(error);
                return new Response('Internal Error', { status: 500 });
            }
        });
    }

    _registerConnectorProtocol() {
        electron.protocol.handle(this._configuration.connectorProtocol, async request => {
            try {
                // Only the URL is serializable (the legacy handler received the
                // whole request object via remote); the renderer only uses it.
                let result = await this._ipcSend('on-connector-protocol-handler', { url: request.url });
                let cors = { 'Access-Control-Allow-Origin': '*' };
                if(!result || !result.data) {
                    return new Response('Not Found', { status: 404, headers: cors });
                }
                return new Response(result.data, { headers: { ...cors, 'Content-Type': result.mimeType || 'application/octet-stream' } });
            } catch(error) {
                this._logger.warn(error);
                return new Response('Not Found', { status: 404 });
            }
        });
    }

    /**
     * Ask the renderer for proxy credentials (Fase 1: replaces remote.app 'login').
     * @returns {Promise<Array<string>|null>} [username, password] or null
     */
    async _provideLoginCredentials(authInfo) {
        try {
            return await this._ipcSend('login', authInfo);
        } catch(error) {
            this._logger.warn(error);
            return null;
        }
    }

    /**
     * Ignore any certificate errors, such as self-signed, expiration, ...
     */
    _certificateErrorHandler(event, webContents, url, error, certificate, callback) {
        event.preventDefault();
        callback(true);
    }

    /**
     *
     */
    _registerLocalHotkeys() {
        let menu = [
            {
                role: 'viewMenu',
                submenu: [
                    { role: 'togglefullscreen' },
                    {
                        role: 'toggleDevTools',
                        accelerator: 'F12'
                    }
                ]
            },
            {
                role: 'editMenu',
                submenu: [
                    { role: 'undo' },
                    { role: 'redo' },
                    { type: 'separator' },
                    { role: 'cut' },
                    { role: 'copy' },
                    { role: 'paste' },
                    { role: 'selectall' },
                    { type: 'separator' },
                    {
                        label: 'Copy URL',
                        accelerator: 'Shift+C',
                        click: this._copyURL.bind(this)
                    },
                    {
                        label: 'Paste URL',
                        accelerator: 'Shift+V',
                        click: this._pasteURL.bind(this)
                    }
                ]
            }
        ];

        if(process.platform === 'darwin') {
            menu[0].submenu.push({ type: 'separator' });
            menu[0].submenu.push({ role: 'quit' });
        }

        electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(menu));
    }

    /**
     *
     */
    _copyURL(menu, window) {
        if(window !== this._window) {
            electron.clipboard.writeText(window.webContents.getURL());
        }
    }

    /**
     *
     */
    _pasteURL(menu, window) {
        if(window !== this._window) {
            window.webContents.loadURL(electron.clipboard.readText());
        }
    }

    /**
     *
     */
    _allWindowsClosedHandler() {
        electron.app.quit();
    }

    /**
     *
     * @param {bool} showTray
     */
    _setupTray(showTray) {
        if(showTray) {
            let menu = [
                {
                    label: 'Minimize to Tray',
                    //enabled: true,
                    click: () => {
                        if(process.platform === 'darwin') {
                            electron.app.dock.hide();
                        }
                        this._window.hide();
                        //item.enabled = false;
                    }
                },
                {
                    label: 'Restore from Tray',
                    //enabled: false,
                    click: () => {
                        if(process.platform === 'darwin') {
                            electron.app.dock.show();
                        }
                        this._window.show();
                        //item.enabled = false;
                    }
                },
                {
                    role: 'quit',
                }
            ];
            this._tray = new electron.Tray(this._appIcon);
            this._tray.setContextMenu(electron.Menu.buildFromTemplate(menu));
        } else {
            this._tray = undefined;
        }
    }

    /**
     * The values the renderer needs inline (Storage/Settings constructors), handed to
     * the preload through `additionalArguments` instead of synchronous IPC round trips.
     */
    _rendererBootstrap() {
        const paths = {};
        for(const name of [ 'home', 'appData', 'userData', 'sessionData', 'temp', 'desktop', 'documents', 'downloads', 'music', 'pictures', 'videos' ]) {
            try {
                paths[name] = electron.app.getPath(name);
            } catch(error) {
                // e.g. no documents directory on some systems (Settings falls back)
                this._logger.warn(error);
            }
        }
        return {
            platform: process.platform,
            // the engine reads the portable flag under this key of the bridge's `env`
            env: { HAKUNEKO_PORTABLE: process.env.RAKKOMIK_PORTABLE },
            tmpdir: os.tmpdir(),
            paths
        };
    }

    /**
     *
     */
    _createWindow() {
        if(this._window) {
            return;
        }

        this._window = new electron.BrowserWindow({
            width: 1120,
            height: 680,
            title: 'RakKomik',
            icon: this._appIcon,
            show: false,
            backgroundColor: '#f8f8f8',
            webPreferences: {
                experimentalFeatures: true,
                nodeIntegration: false,
                contextIsolation: true, // Fase 1 Slice C: renderer is de-privileged, preload bridge only
                preload: path.join(__dirname, 'preload.js'),
                additionalArguments: [ '--rakkomik-bootstrap=' + encodeURIComponent(JSON.stringify(this._rendererBootstrap())) ],
                webSecurity: false // required to open local images in browser
            },
            frame: false
        });

        this._setupBeforeSendHeaders();
        this._setupHeadersReceived();
        this._setupTray(this._showTray);
        this._window.setMenuBarVisibility(false);
        this._window.once('ready-to-show', () => this._window.show());
        this._window.on('close', this._mainWindowCloseHandler.bind(this));
        this._window.on('closed', this._mainWindowClosedHandler.bind(this));
        this._window.on('restore', this._mainWindowRestoreHandler.bind(this));
        this._window.on('maximize', this._mainWindowRestoreHandler.bind(this));
        this._window.on('minimize', this._mainWindowMinimizeHandler.bind(this));
        electron.ipcMain.on('quit', this._mainWindowQuitHandler.bind(this));
    }

    /**
     *
     * @param {string} uri
     * @returns {Promise}
     */
    loadURL(uri) {
        return this._window.loadURL(uri);
    }

    /**
     *
     * @param {string} html
     * @returns {Promise}
     */
    loadHTML(html) {
        let dataURL = 'data:text/html;charset=utf-8;base64,' + Buffer.from(html).toString('base64');
        return this._window.loadURL(dataURL);
    }

    /**
     *
     * @param {*} evt
     */
    _mainWindowCloseHandler(evt) {
        this._window.webContents.send('close');
        evt.preventDefault();
    }

    /**
     * Exit the application forcefully without raising the close event handler
     */
    _mainWindowQuitHandler() {
        this._tray && this._tray.destroy();
        /*
         * NOTE: removing a certain event handler seems not to work...
         *this._window.removeListener('close', this._mainWindowCloseHandler);
         */
        this._window.removeAllListeners('close');
        this._window.close();
    }

    /**
     *
     */
    _mainWindowClosedHandler() {
        // close all existing windows
        electron.BrowserWindow.getAllWindows().forEach(window => window.close());
        this._window = null;
    }

    /**
     *
     */
    _mainWindowRestoreHandler() {
        if(this._tray && this._showTray) {
            this._tray.setToolTip(trayTooltipMinimize);
        }
    }

    /**
     *
     * @param {*} evt
     */
    _mainWindowMinimizeHandler(evt) {
        if(this._tray && this._showTray) {
            this._tray.setToolTip(trayTooltipRestore);
            if(this._minimizeToTray) {
                this._window.hide();
                evt.preventDefault();
            }
        }
    }

    async _ipcSend(channel, payload) {
        /*
         * inject javascript: looks stupid, but is a working solution to call a function which returns data
         * directly within the render process (without dealing with ipcRenderer)
         */
        return new Promise(resolve => {
            /*
             * prevent from injecting javascript into the webpage while the webcontent is not yet ready
             * => required for loading initial page over http protocol (e.g. local hosted test page)
             */
            if(this._window && this._window.webContents && !this._window.webContents.isLoading()) {
                let responseChannelID = '' + Date.now() + Math.random();
                this._window.webContents.send(channel, responseChannelID, payload);
                // TODO: set timeout and remove listener in case no answer is received ...
                electron.ipcMain.once(responseChannelID, (event, data) => resolve(data));
            } else {
                throw new Error(`Cannot call remote channel "${channel}" while web-application is not yet ready!`);
            }
        });
    }

    _setupBeforeSendHeaders() {
        // inject headers before a request is made (synchronous main-side
        // surgery — the renderer round-trip MUST NOT be used here: on modern
        // Electron an async webRequest listener hangs every request before
        // the hook even fires (verified live on Electron 44).
        const surgery = new HeaderSurgery(electron.app.userAgentFallback);
        electron.session.defaultSession.webRequest.onBeforeSendHeaders(urlFilterAll, (details, callback) => {
            try {
                callback({
                    cancel: false,
                    requestHeaders: surgery.applyBeforeSendHeaders(details.url, details.requestHeaders)
                });
            } catch(error) {
                this._logger.warn(error);
                callback({
                    cancel: false,
                    requestHeaders: details.requestHeaders
                });
            }
        });
        this._headerSurgery = surgery;
    }

    _setupHeadersReceived() {
        // See _setupBeforeSendHeaders for why this stays synchronous.
        const surgery = this._headerSurgery || new HeaderSurgery(electron.app.userAgentFallback);
        electron.session.defaultSession.webRequest.onHeadersReceived(urlFilterAll, (details, callback) => {
            try {
                callback({
                    cancel: false,
                    responseHeaders: surgery.applyHeadersReceived(details.url, details.responseHeaders)
                    // statusLine
                });
            } catch(error) {
                this._logger.warn(error);
                callback({
                    cancel: false,
                    responseHeaders: details.responseHeaders
                    // statusLine
                });
            }
        });
    }
};