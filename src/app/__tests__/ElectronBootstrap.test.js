// The Electron bootstrap: the privileged `hakuneko://` and `connector://` schemes and what they serve, the user agent, the
// header surgery of the web requests, the proxy login, the main window with its security settings and its close and quit
// flow. Electron is replaced by doubles that record what they are given and emit what Electron would emit; the real
// windows, protocols and sessions are covered by the end-to-end suite (src/__tests__/App.e2e.mjs).
const { mockModule } = require('./support/mockRequire');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// what Electron 44 reports on Linux for an application called RakKomik, and what the application sends instead
const ELECTRON_USER_AGENT =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) RakKomik/1.0.0 Chrome/152.0.7977.130 Electron/44.7.0 Safari/537.36';
const CHROMIUM_USER_AGENT =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36';

// what the doubles keep for the tests
const world = {
    windows: [],
    trays: [],
    loading: false,
    // answers the requests of the main process the way the renderer does: (channel, payload) => answer
    reply: undefined,
};

function createWindow(options) {
    const webContents = Object.assign(new EventEmitter(), {
        send: vi.fn((channel, id, payload) => {
            if (id !== undefined && world.reply) {
                const answer = world.reply(channel, payload);
                queueMicrotask(() => electron.ipcMain.emit(id, { sender: webContents }, answer));
            }
        }),
        isLoading: vi.fn(() => world.loading),
        getURL: vi.fn(() => 'https://site.test/'),
        loadURL: vi.fn(async () => undefined),
        setWindowOpenHandler: vi.fn(),
    });
    const win = Object.assign(new EventEmitter(), {
        options,
        webContents,
        destroyed: false,
        setMenuBarVisibility: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
        loadURL: vi.fn(async () => undefined),
        isDestroyed() {
            return this.destroyed;
        },
        // like Electron: a listener can prevent `close`, otherwise the window is gone, and says so, a little later
        close: vi.fn(function () {
            const event = {
                defaultPrevented: false,
                preventDefault() {
                    this.defaultPrevented = true;
                },
            };
            this.emit('close', event);
            if (!event.defaultPrevented) {
                setImmediate(() => {
                    this.destroyed = true;
                    this.emit('closed');
                });
            }
        }),
    });
    world.windows.push(win);
    // Electron announces every new web contents on the application
    electron.app.emit('web-contents-created', {}, webContents);
    return win;
}

const electron = mockModule('electron', () => {
    const app = Object.assign(new EventEmitter(), {
        name: 'RakKomik',
        userAgentFallback: ELECTRON_USER_AGENT,
        getPath: vi.fn(),
        getAppPath: vi.fn(() => os.tmpdir()),
        setPath: vi.fn(),
        quit: vi.fn(),
        whenReady: vi.fn(() => Promise.resolve()),
        dock: { hide: vi.fn(), show: vi.fn() },
    });
    const BrowserWindow = vi.fn(function (options) {
        return createWindow(options);
    });
    BrowserWindow.getAllWindows = vi.fn(() => world.windows.filter((win) => !win.destroyed));
    return {
        app,
        BrowserWindow,
        ipcMain: Object.assign(new EventEmitter(), { handle: vi.fn() }),
        Tray: vi.fn(function (icon) {
            const tray = { icon, setContextMenu: vi.fn(), setToolTip: vi.fn(), destroy: vi.fn() };
            world.trays.push(tray);
            return tray;
        }),
        Menu: {
            buildFromTemplate: vi.fn((template) => ({ template })),
            setApplicationMenu: vi.fn(),
        },
        clipboard: { readText: vi.fn(() => ''), writeText: vi.fn() },
        nativeImage: { createFromPath: vi.fn((file) => ({ file })) },
        protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
        session: {
            defaultSession: {
                webRequest: { onBeforeSendHeaders: vi.fn(), onHeadersReceived: vi.fn() },
                setPermissionRequestHandler: vi.fn(),
                setPermissionCheckHandler: vi.fn(),
            },
        },
        // for the preload script, which the main window loads
        contextBridge: { exposeInMainWorld: vi.fn() },
        ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn() },
    };
});
const ElectronBootstrap = require('../ElectronBootstrap');
const Configuration = require('../Configuration');
const { ConsoleLogger } = require('../Logger');

const PLATFORM = Object.getOwnPropertyDescriptor(process, 'platform');

// lets the windows that are closing finish
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function withPlatform(platform, action) {
    Object.defineProperty(process, 'platform', { ...PLATFORM, value: platform });
    try {
        return await action();
    } finally {
        Object.defineProperty(process, 'platform', PLATFORM);
    }
}

describe('ElectronBootstrap', () => {
    let root = null;
    let cache = null;
    let userData = null;
    let plugins = null;
    let logger = null;
    let bootstrap = null;

    // the cache protocol never leaves its directories, so a secret next to them must stay unreachable
    const SECRET = 'TOP SECRET OUTSIDE OF THE CACHE';

    function configure(options = {}) {
        return new Configuration({
            applicationCacheDirectory: cache,
            applicationUserDataDirectory: userData,
            ...options,
        });
    }

    async function launch(options) {
        bootstrap = new ElectronBootstrap(configure(options), logger);
        await bootstrap.launch();
        return bootstrap;
    }

    const mainWindow = () => world.windows[0];
    const protocolHandler = (scheme) =>
        electron.protocol.handle.mock.calls.find(([name]) => name === scheme)[1];

    beforeEach(() => {
        vi.clearAllMocks();
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-bootstrap-'));
        cache = path.join(root, 'cache');
        userData = path.join(root, 'userdata');
        plugins = path.join(userData, 'rakkomik.plugins');
        fs.mkdirSync(cache);
        fs.mkdirSync(plugins, { recursive: true });
        fs.writeFileSync(path.join(root, 'secret.txt'), SECRET);
        logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
        world.windows.length = 0;
        world.trays.length = 0;
        world.loading = false;
        world.reply = undefined;
        electron.app.removeAllListeners();
        electron.ipcMain.removeAllListeners();
        electron.app.name = 'RakKomik';
        electron.app.userAgentFallback = ELECTRON_USER_AGENT;
        // `clearAllMocks` keeps what a test made the doubles do: put the defaults back
        electron.app.getPath.mockImplementation((name) =>
            path.join(os.tmpdir(), 'rk-electron-double', name),
        );
        electron.app.whenReady.mockImplementation(() => Promise.resolve());
        electron.clipboard.readText.mockReturnValue('');
    });

    afterEach(async () => {
        // windows that are still closing must not report to the next test (they close each other, so twice)
        await settle();
        await settle();
        vi.restoreAllMocks();
        Object.defineProperty(process, 'platform', PLATFORM);
        fs.rmSync(root, { recursive: true, force: true });
    });

    describe('constructor', () => {
        it('should log through a console logger of its own when it is given none', () => {
            expect(new ElectronBootstrap(configure())._logger).toBeInstanceOf(ConsoleLogger);
        });

        it('should open no window before it is launched', () => {
            new ElectronBootstrap(configure(), logger);
            expect(electron.BrowserWindow).not.toHaveBeenCalled();
        });
    });

    describe('launch()', () => {
        it('should register the schemes before the application is ready and everything else after it', async () => {
            let ready = null;
            electron.app.whenReady.mockImplementation(
                () =>
                    new Promise((resolve) => {
                        ready = resolve;
                    }),
            );
            bootstrap = new ElectronBootstrap(configure(), logger);
            const launching = bootstrap.launch();
            // Electron only accepts privileged schemes before `ready`
            expect(electron.protocol.registerSchemesAsPrivileged).toHaveBeenCalledTimes(1);
            expect(electron.protocol.handle).not.toHaveBeenCalled();
            expect(electron.BrowserWindow).not.toHaveBeenCalled();
            ready();
            await launching;
            expect(electron.protocol.handle).toHaveBeenCalledTimes(2);
            expect(electron.BrowserWindow).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['the application scheme', 0, 'hakuneko'],
            ['the connector scheme', 1, 'connector'],
        ])(
            'should give %s exactly the privileges the engine needs and no more',
            async (_, index, scheme) => {
                await launch();
                const schemes = electron.protocol.registerSchemesAsPrivileged.mock.calls[0][0];
                expect(schemes).toHaveLength(2);
                // `bypassCSP` and `allowServiceWorkers` would be a security regression
                expect(schemes[index]).toEqual({
                    scheme,
                    privileges: {
                        secure: true,
                        standard: true,
                        supportFetchAPI: true,
                        corsEnabled: true,
                    },
                });
            },
        );

        it('should name the application scheme after the startup URL', async () => {
            await launch({ applicationStartupURL: 'custom://app/index.html' });
            expect(
                electron.protocol.registerSchemesAsPrivileged.mock.calls[0][0].map(
                    (entry) => entry.scheme,
                ),
            ).toEqual(['custom', 'connector']);
            expect(electron.protocol.handle.mock.calls.map(([scheme]) => scheme)).toEqual([
                'custom',
                'connector',
            ]);
        });

        it('should serve the application scheme from the cache and the connector scheme from the renderer', async () => {
            await launch();
            expect(electron.protocol.handle.mock.calls.map(([scheme]) => scheme)).toEqual([
                'hakuneko',
                'connector',
            ]);
        });

        it('should keep the user data where the configuration says (e.g. next to a portable application)', async () => {
            await launch();
            expect(electron.app.setPath).toHaveBeenCalledWith('userData', userData);
        });

        it('should open the main window once the application is ready', async () => {
            await launch();
            expect(world.windows).toHaveLength(1);
        });

        it('should fail, and open nothing, when the application cannot become ready', async () => {
            electron.app.whenReady.mockRejectedValue(new Error('no display'));
            bootstrap = new ElectronBootstrap(configure(), logger);
            await expect(bootstrap.launch()).rejects.toThrow('no display');
            expect(electron.BrowserWindow).not.toHaveBeenCalled();
            expect(electron.protocol.handle).not.toHaveBeenCalled();
        });

        it.each([
            ['linux', 'logo.png'],
            ['darwin', 'logo.png'],
            ['win32', 'logo.ico'],
        ])(
            'should take the icon of the window from the cache directory (%s: %s)',
            async (platform, file) => {
                await withPlatform(platform, () => launch());
                const expected = path.join(cache, 'img', 'tray', file);
                expect(electron.nativeImage.createFromPath).toHaveBeenCalledWith(expected);
                expect(mainWindow().options.icon).toEqual({ file: expected });
            },
        );
    });

    describe('user agent', () => {
        it('should send the one of Chromium: without the product tokens of Electron and of the application', async () => {
            await launch();
            expect(electron.app.userAgentFallback).toBe(CHROMIUM_USER_AGENT);
        });

        it.each([
            [
                'a user agent without the tokens',
                CHROMIUM_USER_AGENT,
                'RakKomik',
                CHROMIUM_USER_AGENT,
            ],
            [
                'every occurrence of a token',
                'A/1 Electron/1.0 B/2 Electron/2.0 RakKomik/3 C/4',
                'RakKomik',
                'A/1 B/2 C/4',
            ],
            [
                'only whole product tokens',
                'Mozilla/5.0 ElectronicsBot/1.0 Chrome/150 RakKomikLite/2',
                'RakKomik',
                'Mozilla/5.0 ElectronicsBot/1.0 Chrome/150 RakKomikLite/2',
            ],
            [
                'an application that is called Electron',
                'Mozilla/5.0 Chrome/150 Electron/44.7.0 Safari/537.36',
                'Electron',
                'Mozilla/5.0 Chrome/150 Safari/537.36',
            ],
            [
                'the version up to the next space',
                'Mozilla/5.0 RakKomik/1.0.0-beta.2+build.5 Chrome/150',
                'RakKomik',
                'Mozilla/5.0 Chrome/150',
            ],
        ])('should strip %s', async (_, userAgent, name, expected) => {
            electron.app.name = name;
            electron.app.userAgentFallback = userAgent;
            await launch();
            expect(electron.app.userAgentFallback).toBe(expected);
        });

        it('should take the name of the application literally, whatever characters it has', async () => {
            electron.app.name = 'Rak.Komik+(beta)';
            electron.app.userAgentFallback =
                'Mozilla/5.0 RakXKomik+(beta)/1.0 Rak.Komik+(beta)/1.0 Chrome/150 Electron/44.7.0';
            await launch();
            expect(electron.app.userAgentFallback).toBe(
                'Mozilla/5.0 RakXKomik+(beta)/1.0 Chrome/150',
            );
        });
    });

    describe('main window', () => {
        it('should open a hidden frameless window of the size of the interface and show it when it is ready', async () => {
            await launch();
            const win = mainWindow();
            expect(win.options).toMatchObject({
                width: 1120,
                height: 680,
                title: 'RakKomik',
                show: false,
                frame: false,
            });
            win.emit('ready-to-show');
            expect(win.show).toHaveBeenCalledTimes(1);
            win.emit('ready-to-show');
            expect(win.show).toHaveBeenCalledTimes(1);
            expect(win.setMenuBarVisibility).toHaveBeenCalledWith(false);
        });

        it('should keep the page away from Node.js: no integration, isolated context, sandboxed renderer', async () => {
            await launch();
            const preferences = mainWindow().options.webPreferences;
            expect(preferences.nodeIntegration).toBe(false);
            expect(preferences.contextIsolation).toBe(true);
            // `true`, or left to the default of Electron, which is the sandbox
            expect(preferences.sandbox).not.toBe(false);
            for (const unsafe of [
                'nodeIntegrationInWorker',
                'nodeIntegrationInSubFrames',
                'webviewTag',
                'allowRunningInsecureContent',
                'enableRemoteModule',
            ]) {
                expect(preferences[unsafe]).not.toBe(true);
            }
        });

        it('should load the preload script that sits next to it', async () => {
            await launch();
            const preload = mainWindow().options.webPreferences.preload;
            expect(path.isAbsolute(preload)).toBe(true);
            expect(preload).toBe(path.join(__dirname, '..', 'preload.js'));
            expect(fs.existsSync(preload)).toBe(true);
        });

        it('should hand the values the renderer needs to the preload script in one argument', async () => {
            await launch();
            const argv = mainWindow().options.webPreferences.additionalArguments;
            expect(argv).toHaveLength(1);
            expect(argv[0].startsWith('--rakkomik-bootstrap=')).toBe(true);
        });

        it('should open the window only once while it exists, and again after it is gone', async () => {
            await launch();
            electron.app.emit('activate');
            electron.app.emit('activate');
            expect(world.windows).toHaveLength(1);
            electron.ipcMain.emit('quit');
            await settle();
            expect(mainWindow().destroyed).toBe(true);
            electron.app.emit('activate');
            expect(world.windows).toHaveLength(2);
            expect(world.windows[1].destroyed).toBe(false);
        });

        it('should show no tray icon by default', async () => {
            await launch();
            expect(electron.Tray).not.toHaveBeenCalled();
        });

        it('should stop the page of the main window from navigating to another origin', async () => {
            await launch();
            const contents = mainWindow().webContents;
            const away = { url: 'https://evil.example/', preventDefault: vi.fn() };
            contents.emit('will-navigate', away, away.url);
            expect(away.preventDefault).toHaveBeenCalled();
            const home = { url: 'hakuneko://cache/index.html', preventDefault: vi.fn() };
            contents.emit('will-navigate', home, home.url);
            expect(home.preventDefault).not.toHaveBeenCalled();
        });

        it.each([
            ['a website', 'http://localhost:8080/index.html'],
            ['a file of the user', 'file:///home/user/.ssh/id_rsa'],
            ['a page that is made of text', 'data:text/html;base64,PHA+eDwvcD4='],
            ['the scheme of the connectors', 'connector://mangadex?payload=x'],
            [
                'a scheme that only starts like the one of the application',
                'hakuneko-evil://cache/index.html',
            ],
            [
                'a website that has the scheme in its address',
                'https://evil.example/hakuneko://cache/index.html',
            ],
        ])('should not let the page of the main window navigate to %s', async (_, url) => {
            await launch();
            const event = { url, preventDefault: vi.fn() };
            mainWindow().webContents.emit('will-navigate', event, url);
            expect(event.preventDefault).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['the cache', 'hakuneko://cache/index.html?v=2'],
            ['the plugins', 'hakuneko://plugins/MyConnector.mjs'],
        ])(
            'should let the page of the main window navigate within the application (%s)',
            async (_, url) => {
                await launch();
                const event = { url, preventDefault: vi.fn() };
                mainWindow().webContents.emit('will-navigate', event, url);
                expect(event.preventDefault).not.toHaveBeenCalled();
            },
        );

        it('should take the scheme of the application from the startup URL', async () => {
            await launch({ applicationStartupURL: 'custom://app/index.html' });
            const inside = { url: 'custom://app/other.html', preventDefault: vi.fn() };
            const outside = { url: 'hakuneko://cache/index.html', preventDefault: vi.fn() };
            mainWindow().webContents.emit('will-navigate', inside, inside.url);
            mainWindow().webContents.emit('will-navigate', outside, outside.url);
            expect(inside.preventDefault).not.toHaveBeenCalled();
            expect(outside.preventDefault).toHaveBeenCalledTimes(1);
        });

        // the hidden fetch windows and the windows a link opens load the websites, which is what they are for
        it('should leave the other windows, which load websites, free to navigate', async () => {
            await launch();
            const child = new electron.BrowserWindow({});
            expect(child.webContents.listenerCount('will-navigate')).toBe(0);
            expect(mainWindow().webContents.listenerCount('will-navigate')).toBe(1);
        });
    });

    describe('permissions of remote pages', () => {
        // the permission requests of every page of the session, as Electron asks for them
        function ask(handler, permission) {
            const callback = vi.fn();
            handler({ getURL: () => 'https://site.test/' }, permission, callback, {
                requestingUrl: 'https://site.test/',
                isMainFrame: true,
            });
            return callback;
        }

        it('should not approve the permission requests of a remote page on its own', async () => {
            await launch();
            const [handler] =
                electron.session.defaultSession.setPermissionRequestHandler.mock.calls[0] || [];
            expect(handler).toBeTypeOf('function');
            for (const permission of [
                'media',
                'notifications',
                'geolocation',
                'midi',
                'clipboard-read',
                'hid',
                'serial',
            ]) {
                const callback = vi.fn();
                handler({ getURL: () => 'https://site.test/' }, permission, callback, {
                    requestingUrl: 'https://site.test/',
                    isMainFrame: true,
                });
                expect(callback).toHaveBeenCalledWith(false);
            }
        });

        it.each([
            ['a video in full screen', 'fullscreen'],
            ['a text copied to the clipboard', 'clipboard-sanitized-write'],
        ])('should approve the request for %s, and no more than that', async (_, permission) => {
            await launch();
            const [handler] =
                electron.session.defaultSession.setPermissionRequestHandler.mock.calls[0];
            expect(ask(handler, permission).mock.calls).toEqual([[true]]);
        });

        it.each([
            'media',
            'display-capture',
            'clipboard-read',
            'deprecated-sync-clipboard-read',
            'openExternal',
            'fileSystem',
            'automatic-fullscreen',
            'unknown',
            // what a later version of Electron may ask for
            'a-permission-that-does-not-exist-yet',
        ])('should deny the request for %s', async (permission) => {
            await launch();
            const [handler] =
                electron.session.defaultSession.setPermissionRequestHandler.mock.calls[0];
            expect(ask(handler, permission).mock.calls).toEqual([[false]]);
        });

        it('should install the handler once on the session of the application, after the application is ready', async () => {
            let ready = null;
            electron.app.whenReady.mockImplementation(
                () =>
                    new Promise((resolve) => {
                        ready = resolve;
                    }),
            );
            bootstrap = new ElectronBootstrap(configure(), logger);
            const launching = bootstrap.launch();
            expect(
                electron.session.defaultSession.setPermissionRequestHandler,
            ).not.toHaveBeenCalled();
            ready();
            await launching;
            expect(
                electron.session.defaultSession.setPermissionRequestHandler,
            ).toHaveBeenCalledTimes(1);
            electron.app.emit('activate');
            expect(
                electron.session.defaultSession.setPermissionRequestHandler,
            ).toHaveBeenCalledTimes(1);
        });
    });

    describe('renderer bootstrap', () => {
        const PATHS = [
            'home',
            'appData',
            'userData',
            'sessionData',
            'temp',
            'desktop',
            'documents',
            'downloads',
            'music',
            'pictures',
            'videos',
        ];

        it('should name the platform, the temp directory and every directory the renderer asks for', async () => {
            await launch();
            const values = bootstrap._rendererBootstrap();
            expect(values.platform).toBe(process.platform);
            expect(values.tmpdir).toBe(os.tmpdir());
            expect(Object.keys(values.paths)).toEqual(PATHS);
            for (const name of PATHS) {
                expect(values.paths[name]).toBe(electron.app.getPath(name));
            }
        });

        it('should leave out a directory the system does not have, and warn', async () => {
            await launch();
            const failure = new Error("Failed to get 'documents' path");
            electron.app.getPath.mockImplementation((name) => {
                if (name === 'documents') {
                    throw failure;
                }
                return path.join(os.tmpdir(), name);
            });
            const values = bootstrap._rendererBootstrap();
            expect(Object.keys(values.paths)).toEqual(PATHS.filter((name) => name !== 'documents'));
            expect(logger.warn).toHaveBeenCalledWith(failure);
        });

        it('should pass the portable flag under the key the engine reads', async () => {
            const original = process.env.RAKKOMIK_PORTABLE;
            try {
                await launch();
                process.env.RAKKOMIK_PORTABLE = 'TRUE';
                expect(bootstrap._rendererBootstrap().env).toEqual({ HAKUNEKO_PORTABLE: 'TRUE' });
                delete process.env.RAKKOMIK_PORTABLE;
                expect(bootstrap._rendererBootstrap().env.HAKUNEKO_PORTABLE).toBeUndefined();
            } finally {
                if (original === undefined) {
                    delete process.env.RAKKOMIK_PORTABLE;
                } else {
                    process.env.RAKKOMIK_PORTABLE = original;
                }
            }
        });

        it('should name the platform it runs on, whichever that is', async () => {
            await launch();
            for (const platform of ['linux', 'darwin', 'win32']) {
                await withPlatform(platform, () => {
                    expect(bootstrap._rendererBootstrap().platform).toBe(platform);
                });
            }
        });

        it('should be understood by the preload script that the window loads', async () => {
            await launch();
            const argv = process.argv;
            const preload = mainWindow().options.webPreferences.preload;
            try {
                process.argv = [
                    ...argv.slice(0, 2),
                    ...mainWindow().options.webPreferences.additionalArguments,
                ];
                delete require.cache[preload];
                electron.contextBridge.exposeInMainWorld.mockClear();
                require(preload);
            } finally {
                process.argv = argv;
            }
            const [name, api] = electron.contextBridge.exposeInMainWorld.mock.calls[0];
            expect(name).toBe('hakuneko');
            expect(api.platform).toBe(process.platform);
            expect(api.os.tmpdir).toBe(os.tmpdir());
            expect(api.app.getPath('userData')).toBe(electron.app.getPath('userData'));
            expect(api.app.getPath('downloads')).toBe(electron.app.getPath('downloads'));
        });
    });

    describe('web requests', () => {
        const requestHooks = () => electron.session.defaultSession.webRequest;

        it.each(['onBeforeSendHeaders', 'onHeadersReceived'])(
            'should rewrite the headers of web requests only with %s, never those of the application schemes',
            async (hook) => {
                await launch();
                expect(requestHooks()[hook]).toHaveBeenCalledTimes(1);
                expect(requestHooks()[hook].mock.calls[0][0]).toEqual({
                    urls: ['http://*/*', 'https://*/*'],
                });
            },
        );

        describe('before they are sent', () => {
            async function send(details) {
                await launch();
                const [, listener] = requestHooks().onBeforeSendHeaders.mock.calls[0];
                const callback = vi.fn();
                listener(details, callback);
                return callback;
            }

            it('should apply the header surgery and let the request go', async () => {
                const callback = await send({
                    url: 'https://example.org/page',
                    requestHeaders: {
                        'User-Agent': ELECTRON_USER_AGENT,
                        'x-referer': 'https://example.org/',
                        'x-cookie': 'a=1',
                        Cookie: 'b=2',
                    },
                });
                expect(callback).toHaveBeenCalledTimes(1);
                const { cancel, requestHeaders } = callback.mock.calls[0][0];
                expect(cancel).toBe(false);
                expect(requestHeaders.Referer).toBe('https://example.org/');
                expect(requestHeaders.Cookie).toBe('b=2; a=1');
                expect(requestHeaders['Cache-Control']).toBe('no-cache');
                expect(Object.keys(requestHeaders).filter((name) => name.startsWith('x-'))).toEqual(
                    [],
                );
            });

            it('should align a stray Electron user agent with the user agent of the application', async () => {
                const callback = await send({
                    url: 'https://example.org/',
                    requestHeaders: { 'User-Agent': ELECTRON_USER_AGENT },
                });
                expect(callback.mock.calls[0][0].requestHeaders['User-Agent']).toBe(
                    CHROMIUM_USER_AGENT,
                );
            });

            it('should let the request go with its own headers, and warn, when the surgery fails', async () => {
                const requestHeaders = { 'x-referer': 'https://example.org/' };
                const callback = await send({ url: 'not a URL', requestHeaders });
                expect(callback).toHaveBeenCalledTimes(1);
                expect(callback.mock.calls[0][0]).toEqual({ cancel: false, requestHeaders });
                expect(callback.mock.calls[0][0].requestHeaders).toBe(requestHeaders);
                expect(logger.warn).toHaveBeenCalledTimes(1);
                expect(logger.warn.mock.calls[0][0]).toBeInstanceOf(TypeError);
            });
        });

        describe('when the response arrives', () => {
            async function receive(details) {
                await launch();
                const [, listener] = requestHooks().onHeadersReceived.mock.calls[0];
                const callback = vi.fn();
                listener(details, callback);
                return callback;
            }

            it('should apply the header surgery and let the response through', async () => {
                const callback = await receive({
                    url: 'https://stream.test/video',
                    responseHeaders: {
                        'x-redirect': ['https://stream.test/next'],
                        'set-cookie': ['a=1; SameSite=Lax; Path=/'],
                    },
                });
                expect(callback).toHaveBeenCalledTimes(1);
                const { cancel, responseHeaders } = callback.mock.calls[0][0];
                expect(cancel).toBe(false);
                expect(responseHeaders.Location).toEqual(['https://stream.test/next']);
                expect(responseHeaders['set-cookie']).toEqual([
                    'a=1; Path=/; Secure; SameSite=None',
                ]);
            });

            it('should let the response through with its own headers, and warn, when the surgery fails', async () => {
                const responseHeaders = { 'set-cookie': ['a=1'] };
                const callback = await receive({ url: '::not a URL::', responseHeaders });
                expect(callback.mock.calls).toEqual([[{ cancel: false, responseHeaders }]]);
                expect(callback.mock.calls[0][0].responseHeaders).toBe(responseHeaders);
                expect(logger.warn).toHaveBeenCalledTimes(1);
            });
        });
    });

    describe('hakuneko:// protocol', () => {
        const MIME_TYPES = [
            ['app.mjs', 'text/javascript'],
            ['app.js', 'text/javascript'],
            ['index.html', 'text/html'],
            ['style.css', 'text/css'],
            ['data.json', 'application/json'],
            ['app.js.map', 'application/json'],
            ['logo.png', 'image/png'],
            ['photo.jpg', 'image/jpeg'],
            ['photo.jpeg', 'image/jpeg'],
            ['anim.gif', 'image/gif'],
            ['picture.webp', 'image/webp'],
            ['picture.avif', 'image/avif'],
            ['picture.bmp', 'image/bmp'],
            ['vector.svg', 'image/svg+xml'],
            ['favicon.ico', 'image/x-icon'],
            ['font.woff2', 'font/woff2'],
            // the icons of the connectors have no extension: still rendered by <img>
            ['mangadex', 'application/octet-stream'],
            ['archive.zip', 'application/octet-stream'],
        ];

        async function get(url, scheme = 'hakuneko') {
            return protocolHandler(scheme)({ url });
        }

        beforeEach(async () => {
            await launch();
        });

        it.each(MIME_TYPES)(
            'should serve %s as %s, readable from the other schemes',
            async (file, mimeType) => {
                fs.writeFileSync(path.join(cache, file), 'content of ' + file);
                const response = await get('hakuneko://cache/' + file);
                expect(response.status).toBe(200);
                expect(response.headers.get('Content-Type')).toBe(mimeType);
                // connector:// images and the hidden fetch windows read it across schemes
                expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
                await expect(response.text()).resolves.toBe('content of ' + file);
            },
        );

        it('should serve the bytes of a file unchanged', async () => {
            const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
            fs.writeFileSync(path.join(cache, 'all-bytes.png'), bytes);
            const response = await get('hakuneko://cache/all-bytes.png');
            expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
        });

        it('should serve a file below directories', async () => {
            fs.mkdirSync(path.join(cache, 'mjs', 'engine'), { recursive: true });
            fs.writeFileSync(
                path.join(cache, 'mjs', 'engine', 'Connectors.mjs'),
                'export default 1;',
            );
            const response = await get('hakuneko://cache/mjs/engine/Connectors.mjs');
            expect(response.headers.get('Content-Type')).toBe('text/javascript');
            await expect(response.text()).resolves.toBe('export default 1;');
        });

        it('should ignore the query and the fragment of the URL', async () => {
            fs.writeFileSync(path.join(cache, 'index.html'), '<html></html>');
            const response = await get('hakuneko://cache/index.html?v=2&debug=1#top');
            expect(response.status).toBe(200);
            await expect(response.text()).resolves.toBe('<html></html>');
        });

        it.each([
            ['with a slash', 'hakuneko://cache/mjs/'],
            ['without a slash', 'hakuneko://cache/mjs'],
            ['with dot segments', 'hakuneko://cache/mjs/./sub/..'],
        ])('should list a directory as a JSON array of its entries (%s)', async (_, url) => {
            fs.mkdirSync(path.join(cache, 'mjs', 'sub'), { recursive: true });
            fs.writeFileSync(path.join(cache, 'mjs', 'a.mjs'), '');
            fs.writeFileSync(path.join(cache, 'mjs', 'b.mjs'), '');
            const response = await get(url);
            expect(response.status).toBe(200);
            expect(response.headers.get('Content-Type')).toBe('application/json');
            expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
            expect((await response.json()).sort()).toEqual(['a.mjs', 'b.mjs', 'sub']);
        });

        it('should list the cache directory itself', async () => {
            fs.writeFileSync(path.join(cache, 'index.html'), '');
            expect(await (await get('hakuneko://cache')).json()).toEqual(['index.html']);
            expect(await (await get('hakuneko://cache/')).json()).toEqual(['index.html']);
        });

        it('should list an empty directory as an empty array', async () => {
            expect(await (await get('hakuneko://cache/')).json()).toEqual([]);
        });

        it('should serve the plugins of the user from the plugins directory, listed for the engine to load', async () => {
            fs.writeFileSync(path.join(plugins, 'MyConnector.mjs'), 'export default class {}');
            fs.writeFileSync(path.join(cache, 'MyConnector.mjs'), 'not the plugin');
            expect(await (await get('hakuneko://plugins/')).json()).toEqual(['MyConnector.mjs']);
            const response = await get('hakuneko://plugins/MyConnector.mjs');
            expect(response.headers.get('Content-Type')).toBe('text/javascript');
            await expect(response.text()).resolves.toBe('export default class {}');
        });

        it('should answer a missing plugins directory with a 404 that is no JSON, so that the engine finds no plugin', async () => {
            fs.rmSync(plugins, { recursive: true });
            const response = await get('hakuneko://plugins/');
            expect(response.status).toBe(404);
            await expect(response.json()).rejects.toThrow();
        });

        it.each([
            ['a file that does not exist', 'hakuneko://cache/missing.js'],
            ['a directory that does not exist', 'hakuneko://cache/missing/'],
            ['a path below a file', 'hakuneko://cache/index.html/inside.js'],
        ])('should answer %s with a 404', async (_, url) => {
            fs.writeFileSync(path.join(cache, 'index.html'), '');
            const response = await get(url);
            expect(response.status).toBe(404);
            await expect(response.text()).resolves.toBe('Not Found');
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it.each([
            ['dot segments', 'hakuneko://cache/../secret.txt'],
            ['many dot segments', 'hakuneko://cache/../../../../secret.txt'],
            ['dot segments inside a path', 'hakuneko://cache/mjs/../../secret.txt'],
            ['encoded dots', 'hakuneko://cache/%2e%2e/secret.txt'],
            ['capital encoded dots', 'hakuneko://cache/%2E%2E/%2E%2E/secret.txt'],
            ['an encoded slash', 'hakuneko://cache/..%2fsecret.txt'],
            ['encoded dots and slash', 'hakuneko://cache/%2e%2e%2fsecret.txt'],
            ['an encoded backslash', 'hakuneko://cache/..%5csecret.txt'],
            ['a backslash', 'hakuneko://cache/..\\secret.txt'],
            ['a double encoding', 'hakuneko://cache/%252e%252e/secret.txt'],
            ['the plugins host', 'hakuneko://plugins/../../secret.txt'],
            // the directory of the test only exists while it runs
            [
                'the absolute path of the file',
                () => 'hakuneko://cache/' + path.join(root, 'secret.txt').split(path.sep).join('/'),
            ],
        ])('should not serve a file outside of the cache by %s', async (_, url) => {
            const response = await get(typeof url === 'function' ? url() : url);
            expect(response.status).not.toBe(200);
            await expect(response.text()).resolves.not.toContain(SECRET);
        });

        it.each([
            ['another name', 'hakuneko://elsewhere/index.html'],
            ['a name of Object.prototype', 'hakuneko://constructor/index.html'],
            ['the prototype', 'hakuneko://__proto__/index.html'],
            ['no name at all', 'hakuneko:///index.html'],
        ])(
            'should refuse a host that is neither the cache nor the plugins (%s) and say so in the log',
            async (_, url) => {
                // the cache holds the same file: it must not be found for another host
                fs.writeFileSync(path.join(cache, 'index.html'), 'the cache');
                const response = await get(url);
                expect(response.ok).toBe(false);
                await expect(response.text()).resolves.not.toContain('the cache');
                expect(logger.warn).toHaveBeenCalledTimes(1);
            },
        );

        it('should answer a failure of the file system with a 500 and a warning, not with an exception', async () => {
            fs.writeFileSync(path.join(cache, 'index.html'), '');
            const failure = Object.assign(new Error('EACCES: permission denied'), {
                code: 'EACCES',
            });
            vi.spyOn(fs.promises, 'stat').mockRejectedValueOnce(failure);
            const response = await get('hakuneko://cache/index.html');
            expect(response.status).toBe(500);
            await expect(response.text()).resolves.toBe('Internal Error');
            expect(logger.warn).toHaveBeenCalledWith(failure);
        });

        it.each(['readFile', 'readdir'])(
            'should answer a failure of %s with a 500 and a warning',
            async (method) => {
                fs.mkdirSync(path.join(cache, 'directory'));
                fs.writeFileSync(path.join(cache, 'file.js'), '');
                const failure = Object.assign(new Error('EIO'), { code: 'EIO' });
                vi.spyOn(fs.promises, method).mockRejectedValueOnce(failure);
                const response = await get(
                    method === 'readFile'
                        ? 'hakuneko://cache/file.js'
                        : 'hakuneko://cache/directory',
                );
                expect(response.status).toBe(500);
                expect(logger.warn).toHaveBeenCalledWith(failure);
            },
        );

        it('should serve a file that is read while another request is still waiting', async () => {
            fs.writeFileSync(path.join(cache, 'a.js'), 'A');
            fs.writeFileSync(path.join(cache, 'b.js'), 'B');
            const [a, b] = await Promise.all([
                get('hakuneko://cache/a.js'),
                get('hakuneko://cache/b.js'),
            ]);
            expect([await a.text(), await b.text()]).toEqual(['A', 'B']);
        });

        it('should serve a file whose name is percent-encoded in the URL', async () => {
            fs.writeFileSync(path.join(plugins, 'My Connector.mjs'), 'export default class {}');
            fs.writeFileSync(path.join(cache, 'ü 100%.js'), 'umlaut');
            const plugin = await get('hakuneko://plugins/My%20Connector.mjs');
            expect(plugin.status).toBe(200);
            await expect(plugin.text()).resolves.toBe('export default class {}');
            const umlaut = await get('hakuneko://cache/' + encodeURIComponent('ü 100%.js'));
            expect(umlaut.status).toBe(200);
            await expect(umlaut.text()).resolves.toBe('umlaut');
        });

        // the path is decoded before it is checked against the directory: what the decoding makes of it must stay inside
        describe('encoded paths', () => {
            it.each([
                [
                    'a double encoding with an encoded slash',
                    'hakuneko://cache/%252e%252e%252fsecret.txt',
                ],
                ['a double encoding of the slash only', 'hakuneko://cache/..%252fsecret.txt'],
                ['an encoded slash after an encoded dot', 'hakuneko://cache/.%2e%2fsecret.txt'],
                [
                    'encoded dots, slashes and a backslash',
                    'hakuneko://cache/%2e%2e%2f%2e%2e%5csecret.txt',
                ],
                [
                    'encoded dots below a directory',
                    'hakuneko://cache/mjs/%2e%2e%2f%2e%2e%2fsecret.txt',
                ],
                [
                    'an encoded NUL and encoded dots',
                    'hakuneko://cache/index.html%00%2f%2e%2e%2f%2e%2e%2fsecret.txt',
                ],
                ['an encoded NUL at the end of a name', 'hakuneko://cache/index.html%00'],
                [
                    'the plugins host and encoded dots',
                    'hakuneko://plugins/%2e%2e%2f%2e%2e%2fsecret.txt',
                ],
            ])('should not serve a file outside of the directory by %s', async (_, url) => {
                fs.writeFileSync(path.join(cache, 'index.html'), 'inside');
                const response = await get(url);
                expect(response.status).not.toBe(200);
                await expect(response.text()).resolves.not.toContain(SECRET);
            });

            it('should look for a path that decodes to a parent directory inside of the directory, never outside', async () => {
                // the name of the secret next to the cache: its twin inside of the cache is the only one that can be reached
                fs.writeFileSync(path.join(cache, 'secret.txt'), 'the file inside');
                for (const url of [
                    'hakuneko://cache/%2e%2e%2fsecret.txt',
                    'hakuneko://cache/..%2f..%2fsecret.txt',
                    'hakuneko://cache/%2E%2E%2Fsecret.txt',
                ]) {
                    const response = await get(url);
                    await expect(response.text()).resolves.toBe('the file inside');
                }
            });

            it('should decode the path once: the name of a file that is encoded in its own name is that name', async () => {
                fs.writeFileSync(
                    path.join(cache, '%2e%2e%2fsecret.txt'),
                    'the file whose name looks encoded',
                );
                const response = await get('hakuneko://cache/%252e%252e%252fsecret.txt');
                expect(response.status).toBe(200);
                await expect(response.text()).resolves.toBe('the file whose name looks encoded');
            });

            it.each([
                ['an escape that is no hexadecimal number', 'hakuneko://cache/100%zz.js'],
                ['a lone percent sign', 'hakuneko://cache/100%.js'],
                ['a percent sign at the end', 'hakuneko://cache/index.html%'],
                ['half of an escape', 'hakuneko://cache/index.html%2'],
                ['a cut off character', 'hakuneko://cache/%E0%A4%A'],
                ['bytes that are no UTF-8', 'hakuneko://plugins/%C3%28.mjs'],
            ])('should answer %s with an error status, not with an exception', async (_, url) => {
                const response = await get(url);
                expect(response.status).toBe(400);
                await expect(response.text()).resolves.toBe('Bad Request');
                expect(logger.warn).not.toHaveBeenCalled();
            });
        });
    });

    describe('connector:// protocol', () => {
        const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255]);

        async function get(url) {
            return protocolHandler('connector')({ url });
        }

        beforeEach(async () => {
            await launch();
        });

        it('should ask the renderer, which hosts the connectors, and hand over nothing but the URL', async () => {
            world.reply = () => ({ data: IMAGE, mimeType: 'image/png' });
            const request = {
                url: 'connector://mangadex?payload=eyJ4IjoxfQ==',
                method: 'GET',
                headers: { a: 'b' },
            };
            await protocolHandler('connector')(request);
            expect(mainWindow().webContents.send).toHaveBeenCalledTimes(1);
            const [channel, id, payload] = mainWindow().webContents.send.mock.calls[0];
            expect(channel).toBe('on-connector-protocol-handler');
            expect(typeof id).toBe('string');
            expect(payload).toEqual({ url: 'connector://mangadex?payload=eyJ4IjoxfQ==' });
        });

        it('should answer with the data and the mime type of the renderer, readable from the other schemes', async () => {
            world.reply = () => ({ data: IMAGE, mimeType: 'image/png' });
            const response = await get('connector://mangadex?payload=x');
            expect(response.status).toBe(200);
            expect(response.headers.get('Content-Type')).toBe('image/png');
            expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
            expect(new Uint8Array(await response.arrayBuffer())).toEqual(IMAGE);
        });

        it('should call data of an unknown type a binary', async () => {
            world.reply = () => ({ data: IMAGE });
            const response = await get('connector://mangadex?payload=x');
            expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
        });

        it.each([
            ['nothing', undefined],
            ['null', null],
            ['an answer without data', { mimeType: 'image/png' }],
            ['an empty text as data', { data: '', mimeType: 'text/plain' }],
        ])('should answer a 404 when the renderer answers %s', async (_, answer) => {
            world.reply = () => answer;
            const response = await get('connector://unknown?payload=x');
            expect(response.status).toBe(404);
            expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
            await expect(response.text()).resolves.toBe('Not Found');
        });

        it.each([
            [
                'is still loading',
                () => {
                    world.loading = true;
                },
            ],
            [
                'has been closed',
                () => {
                    bootstrap._window = null;
                },
            ],
        ])('should answer a 404 and warn while the window %s', async (_, close) => {
            close();
            const response = await get('connector://mangadex?payload=x');
            expect(response.status).toBe(404);
            expect(logger.warn).toHaveBeenCalledTimes(1);
            expect(logger.warn.mock.calls[0][0].message).toMatch(/not yet ready/);
        });

        it('should wait for a renderer that answers late and then answer', async () => {
            let answer = null;
            world.reply = () => undefined;
            mainWindow().webContents.send.mockImplementation((channel, id) => {
                answer = (data) => electron.ipcMain.emit(id, {}, data);
            });
            const pending = get('connector://mangadex?payload=x');
            let settled = false;
            pending.then(() => {
                settled = true;
            });
            await new Promise((resolve) => setImmediate(resolve));
            expect(settled).toBe(false);
            answer({ data: IMAGE, mimeType: 'image/png' });
            expect((await pending).status).toBe(200);
        });

        it('should keep concurrent requests apart', async () => {
            const answers = {};
            mainWindow().webContents.send.mockImplementation((channel, id, payload) => {
                answers[payload.url] = (data) => electron.ipcMain.emit(id, {}, data);
            });
            const first = get('connector://a?payload=1');
            const second = get('connector://b?payload=2');
            answers['connector://b?payload=2']({ data: new Uint8Array([2]), mimeType: 'image/b' });
            answers['connector://a?payload=1']({ data: new Uint8Array([1]), mimeType: 'image/a' });
            const [a, b] = await Promise.all([first, second]);
            expect(a.headers.get('Content-Type')).toBe('image/a');
            expect(b.headers.get('Content-Type')).toBe('image/b');
            expect(new Uint8Array(await a.arrayBuffer())).toEqual(new Uint8Array([1]));
            expect(new Uint8Array(await b.arrayBuffer())).toEqual(new Uint8Array([2]));
        });

        it('should stop listening for the answer once it has come', async () => {
            world.reply = () => ({ data: IMAGE });
            await get('connector://a?payload=1');
            await get('connector://b?payload=2');
            const ids = mainWindow().webContents.send.mock.calls.map((call) => call[1]);
            expect(new Set(ids).size).toBe(2);
            for (const id of ids) {
                expect(electron.ipcMain.listenerCount(id)).toBe(0);
            }
        });
    });

    describe('proxy login', () => {
        const AUTH = {
            isProxy: true,
            scheme: 'basic',
            host: 'proxy.test',
            port: 8080,
            realm: 'proxy',
        };

        function login() {
            const event = { preventDefault: vi.fn() };
            const callback = vi.fn();
            electron.app.emit(
                'login',
                event,
                mainWindow().webContents,
                { url: 'http://site.test/' },
                AUTH,
                callback,
            );
            return { event, callback };
        }

        beforeEach(async () => {
            await launch();
        });

        it('should ask the renderer for the credentials and hand them to Electron', async () => {
            world.reply = () => ['user', 'secret'];
            const { event, callback } = login();
            expect(event.preventDefault).toHaveBeenCalledTimes(1);
            await vi.waitFor(() => expect(callback).toHaveBeenCalled());
            expect(callback.mock.calls).toEqual([['user', 'secret']]);
            expect(mainWindow().webContents.send.mock.calls[0][0]).toBe('login');
            expect(mainWindow().webContents.send.mock.calls[0][2]).toEqual(AUTH);
        });

        it.each([
            ['nothing', undefined],
            ['null', null],
        ])(
            'should cancel the login when the renderer has no credentials (%s)',
            async (_, answer) => {
                world.reply = () => answer;
                const { callback } = login();
                await vi.waitFor(() => expect(callback).toHaveBeenCalled());
                expect(callback.mock.calls).toEqual([[]]);
            },
        );

        it('should cancel the login when Electron does not take the credentials', async () => {
            world.reply = () => ['user', 'secret'];
            const event = { preventDefault: vi.fn() };
            const callback = vi.fn().mockImplementationOnce(() => {
                throw new Error('the request is gone');
            });
            electron.app.emit(
                'login',
                event,
                mainWindow().webContents,
                { url: 'http://site.test/' },
                AUTH,
                callback,
            );
            await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(2));
            expect(callback.mock.calls).toEqual([['user', 'secret'], []]);
        });

        it('should cancel the login, and warn, when the renderer cannot be asked', async () => {
            world.loading = true;
            const { event, callback } = login();
            await vi.waitFor(() => expect(callback).toHaveBeenCalled());
            expect(event.preventDefault).toHaveBeenCalledTimes(1);
            expect(callback.mock.calls).toEqual([[]]);
            expect(logger.warn).toHaveBeenCalledTimes(1);
        });
    });

    describe('certificate errors', () => {
        // NOTE: every certificate error is accepted, the expired and the self-signed ones as well as a forged one, so a
        // connection to a website can be read and changed by anyone on the way. Meant that way (the sites of the
        // connectors are often misconfigured) and documented in the source; a hardening gap all the same. Characterisation.
        it.each([
            'net::ERR_CERT_DATE_INVALID',
            'net::ERR_CERT_AUTHORITY_INVALID',
            'net::ERR_CERT_COMMON_NAME_INVALID',
        ])('should accept the certificate error %s', async (error) => {
            await launch();
            const event = { preventDefault: vi.fn() };
            const callback = vi.fn();
            electron.app.emit(
                'certificate-error',
                event,
                {},
                'https://site.test/',
                error,
                { subjectName: 'site.test' },
                callback,
            );
            expect(event.preventDefault).toHaveBeenCalledTimes(1);
            expect(callback.mock.calls).toEqual([[true]]);
        });
    });

    describe('local hotkeys', () => {
        function applicationMenu() {
            expect(electron.Menu.setApplicationMenu).toHaveBeenCalledTimes(1);
            const menu = electron.Menu.setApplicationMenu.mock.calls[0][0];
            return menu.template;
        }

        const items = (template) =>
            template.flatMap((entry) => [entry, ...(entry.submenu ? items(entry.submenu) : [])]);

        it('should bind F12 to the developer tools, as a local hotkey because Windows cannot take F12 globally', async () => {
            await launch();
            const view = applicationMenu().find((entry) => entry.role === 'viewMenu');
            expect(view.submenu.find((entry) => entry.role === 'toggleDevTools').accelerator).toBe(
                'F12',
            );
            expect(view.submenu.some((entry) => entry.role === 'togglefullscreen')).toBe(true);
        });

        it.each([
            ['darwin', ['quit']],
            ['linux', []],
            ['win32', []],
        ])(
            'should offer the zoom of the window on %s, so that the text can be made larger',
            async (platform, more) => {
                await withPlatform(platform, () => launch());
                const view = applicationMenu().find((entry) => entry.role === 'viewMenu');
                const roles = view.submenu.map((entry) => entry.role).filter(Boolean);
                expect(roles).toEqual([
                    'togglefullscreen',
                    'toggleDevTools',
                    'zoomIn',
                    'zoomOut',
                    'resetZoom',
                    ...more,
                ]);
            },
        );

        it('should offer the clipboard shortcuts and the two shortcuts for the URL of a window', async () => {
            await launch();
            const edit = applicationMenu().find((entry) => entry.role === 'editMenu');
            const roles = edit.submenu.map((entry) => entry.role).filter(Boolean);
            expect(roles).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectall']);
            const labelled = Object.fromEntries(
                edit.submenu
                    .filter((entry) => entry.label)
                    .map((entry) => [entry.label, entry.accelerator]),
            );
            expect(labelled).toEqual({ 'Copy URL': 'Shift+C', 'Paste URL': 'Shift+V' });
        });

        it.each([
            ['darwin', true],
            ['linux', false],
            ['win32', false],
        ])('should have a quit entry in the view menu on %s: %s', async (platform, quits) => {
            await withPlatform(platform, () => launch());
            const view = applicationMenu().find((entry) => entry.role === 'viewMenu');
            expect(view.submenu.some((entry) => entry.role === 'quit')).toBe(quits);
            if (quits) {
                expect(view.submenu.at(-2)).toEqual({ type: 'separator' });
            }
        });

        describe('Copy URL and Paste URL', () => {
            let child = null;
            let copyURL = null;
            let pasteURL = null;

            beforeEach(async () => {
                await launch();
                const entries = items(applicationMenu());
                copyURL = entries.find((entry) => entry.label === 'Copy URL').click;
                pasteURL = entries.find((entry) => entry.label === 'Paste URL').click;
                // a window the page opened
                child = new electron.BrowserWindow({});
                child.webContents.getURL.mockReturnValue('https://child.test/chapter/1?x=y');
            });

            it('should copy the URL of a window that is not the main window', () => {
                copyURL({}, child);
                expect(electron.clipboard.writeText).toHaveBeenCalledWith(
                    'https://child.test/chapter/1?x=y',
                );
            });

            it('should open the URL of the clipboard in a window that is not the main window', () => {
                electron.clipboard.readText.mockReturnValue('https://other.test/page');
                pasteURL({}, child);
                expect(child.webContents.loadURL).toHaveBeenCalledWith('https://other.test/page');
            });

            it('should leave the main window alone, which has no address bar', () => {
                electron.clipboard.readText.mockReturnValue('https://other.test/page');
                copyURL({}, mainWindow());
                pasteURL({}, mainWindow());
                expect(electron.clipboard.writeText).not.toHaveBeenCalled();
                expect(mainWindow().webContents.loadURL).not.toHaveBeenCalled();
            });
        });
    });

    describe('close and quit', () => {
        it('should hand a request to close the window to the renderer, which asks the user, and keep the window', async () => {
            await launch();
            mainWindow().close();
            expect(mainWindow().webContents.send).toHaveBeenCalledWith('close');
            expect(mainWindow().destroyed).toBe(false);
            mainWindow().close();
            expect(mainWindow().webContents.send).toHaveBeenCalledTimes(2);
        });

        // NOTE: closing is a handshake, the window only goes when the renderer answers with `quit`. A page that does not
        // listen (the loading page while the update is checked, a renderer that has crashed) cannot be closed at all
        // by the user. Characterisation of the current behaviour, reported as unsure: it may be wanted.
        it('should keep the window open, whether the page is able to answer the close request or not', async () => {
            await launch();
            world.loading = true;
            mainWindow().close();
            await settle();
            expect(mainWindow().destroyed).toBe(false);
            expect(mainWindow().webContents.send).toHaveBeenCalledWith('close');
        });

        it('should close the window when the renderer says quit', async () => {
            await launch();
            mainWindow().close();
            electron.ipcMain.emit('quit');
            await settle();
            expect(mainWindow().destroyed).toBe(true);
            // no more `close` message to the renderer for this one
            expect(mainWindow().webContents.send).toHaveBeenCalledTimes(1);
        });

        it('should close the windows the page opened, and forget the main window, when it is closed', async () => {
            await launch();
            const first = new electron.BrowserWindow({});
            const second = new electron.BrowserWindow({});
            electron.ipcMain.emit('quit');
            await settle();
            expect(first.close).toHaveBeenCalledTimes(1);
            expect(second.close).toHaveBeenCalledTimes(1);
            expect(bootstrap._window).toBeNull();
        });

        it('should quit the application when the last window is gone', async () => {
            await launch();
            expect(electron.app.quit).not.toHaveBeenCalled();
            electron.app.emit('window-all-closed');
            expect(electron.app.quit).toHaveBeenCalledTimes(1);
        });

        it('should remove the tray icon on quit', async () => {
            bootstrap = new ElectronBootstrap(configure(), logger);
            bootstrap._showTray = true;
            await bootstrap.launch();
            electron.ipcMain.emit('quit');
            expect(world.trays).toHaveLength(1);
            expect(world.trays[0].destroy).toHaveBeenCalledTimes(1);
        });

        it('should ignore a quit that comes after the window is gone', async () => {
            await launch();
            electron.ipcMain.emit('quit');
            await settle();
            expect(() => electron.ipcMain.emit('quit')).not.toThrow();
        });

        it('should close the window that was opened later when the renderer says quit', async () => {
            await launch();
            electron.ipcMain.emit('quit');
            await settle();
            electron.app.emit('activate');
            expect(world.windows).toHaveLength(2);
            electron.ipcMain.emit('quit');
            await settle();
            expect(world.windows[1].destroyed).toBe(true);
            expect(bootstrap._window).toBeNull();
        });
    });

    describe('tray', () => {
        async function launchWithTray(platform = 'linux') {
            bootstrap = new ElectronBootstrap(configure(), logger);
            bootstrap._showTray = true;
            await withPlatform(platform, () => bootstrap.launch());
            const entries = electron.Menu.buildFromTemplate.mock.calls
                .map((call) => call[0])
                .find((template) => template.some((item) => item.label === 'Minimize to Tray'));
            return { tray: world.trays[0], entries };
        }

        it('should show the icon of the application with a menu to hide, restore and quit', async () => {
            const { tray, entries } = await launchWithTray();
            expect(tray.icon).toEqual(mainWindow().options.icon);
            expect(entries.map((item) => item.label || item.role)).toEqual([
                'Minimize to Tray',
                'Restore from Tray',
                'quit',
            ]);
            expect(tray.setContextMenu).toHaveBeenCalledTimes(1);
            expect(tray.setContextMenu.mock.calls[0][0].template).toBe(entries);
        });

        it.each([
            ['linux', false],
            ['win32', false],
            ['darwin', true],
        ])(
            'should hide and restore the window from the tray menu (%s, dock: %s)',
            async (platform, dock) => {
                const { entries } = await launchWithTray(platform);
                await withPlatform(platform, () => {
                    entries[0].click();
                    expect(mainWindow().hide).toHaveBeenCalledTimes(1);
                    entries[1].click();
                    expect(mainWindow().show).toHaveBeenCalledTimes(1);
                });
                expect(electron.app.dock.hide).toHaveBeenCalledTimes(dock ? 1 : 0);
                expect(electron.app.dock.show).toHaveBeenCalledTimes(dock ? 1 : 0);
            },
        );

        it('should say in the tooltip what a click does', async () => {
            const { tray } = await launchWithTray();
            const win = mainWindow();
            win.emit('minimize', { preventDefault: vi.fn() });
            expect(tray.setToolTip).toHaveBeenLastCalledWith('RakKomik\nClick to show window');
            win.emit('restore');
            expect(tray.setToolTip).toHaveBeenLastCalledWith('RakKomik\nClick to hide window');
            win.emit('minimize', { preventDefault: vi.fn() });
            win.emit('maximize');
            expect(tray.setToolTip).toHaveBeenLastCalledWith('RakKomik\nClick to hide window');
        });

        it('should keep the window in the taskbar when it is minimized, unless it is told to go to the tray', async () => {
            const { tray } = await launchWithTray();
            const event = { preventDefault: vi.fn() };
            mainWindow().emit('minimize', event);
            expect(mainWindow().hide).not.toHaveBeenCalled();
            expect(event.preventDefault).not.toHaveBeenCalled();
            bootstrap._minimizeToTray = true;
            mainWindow().emit('minimize', event);
            expect(mainWindow().hide).toHaveBeenCalledTimes(1);
            expect(event.preventDefault).toHaveBeenCalledTimes(1);
            expect(tray.setToolTip).toHaveBeenCalledTimes(2);
        });

        it('should not touch a tray there is not when the window is minimized or restored', async () => {
            await launch();
            const event = { preventDefault: vi.fn() };
            expect(() => {
                mainWindow().emit('minimize', event);
                mainWindow().emit('restore');
                mainWindow().emit('maximize');
            }).not.toThrow();
            expect(mainWindow().hide).not.toHaveBeenCalled();
            expect(event.preventDefault).not.toHaveBeenCalled();
        });
    });

    describe('showStartupStatus()', () => {
        beforeEach(async () => {
            await launch();
            mainWindow().webContents.executeJavaScript = vi.fn(async () => undefined);
        });

        it('should hand the step to the showStatus of the page', async () => {
            await bootstrap.showStartupStatus({
                stage: 'failed',
                message: 'a "quoted" </script> reason',
            });
            const [script] = mainWindow().webContents.executeJavaScript.mock.calls[0];
            const showStatus = vi.fn();
            new Function('window', script)({ showStatus });
            expect(showStatus).toHaveBeenCalledWith({
                stage: 'failed',
                message: 'a "quoted" </script> reason',
            });
        });

        it('should not stop the start when the page cannot take the step', async () => {
            mainWindow().webContents.executeJavaScript.mockRejectedValue(new Error('navigated'));
            const warn = vi.spyOn(bootstrap._logger, 'warn').mockImplementation(() => undefined);
            await expect(
                bootstrap.showStartupStatus({ stage: 'starting' }),
            ).resolves.toBeUndefined();
            expect(warn).toHaveBeenCalledWith(
                'The start page could not show a step',
                expect.any(Error),
            );
        });

        it('should do nothing without a window', async () => {
            bootstrap._window = null;
            await expect(
                bootstrap.showStartupStatus({ stage: 'starting' }),
            ).resolves.toBeUndefined();
        });
    });

    describe('loadURL() and loadHTML()', () => {
        beforeEach(async () => {
            await launch();
        });

        it('should load a URL in the main window and answer its promise', async () => {
            const loaded = Promise.resolve('loaded');
            mainWindow().loadURL.mockReturnValue(loaded);
            expect(bootstrap.loadURL('hakuneko://cache/index.html')).toBe(loaded);
            expect(mainWindow().loadURL).toHaveBeenCalledWith('hakuneko://cache/index.html');
        });

        it('should pass the failure of loading a URL on', async () => {
            mainWindow().loadURL.mockRejectedValue(new Error('ERR_CONNECTION_REFUSED'));
            await expect(bootstrap.loadURL('http://127.0.0.1:1/')).rejects.toThrow(
                'ERR_CONNECTION_REFUSED',
            );
        });

        it.each([
            ['plain markup', '<p>Checking for Update</p>'],
            ['text of any writing system', '<p>日本語 Ünïcödé € 🙂</p>'],
            ['nothing', ''],
            [
                'markup that would end a data URL early',
                '<a href="x#y?z=1;q">100%</a>\n\t<script>alert("</script>',
            ],
        ])(
            'should show %s through a data URL that keeps the characters intact',
            async (_, html) => {
                bootstrap.loadHTML(html);
                const [url] = mainWindow().loadURL.mock.calls[0];
                const prefix = 'data:text/html;charset=utf-8;base64,';
                expect(url.startsWith(prefix)).toBe(true);
                expect(Buffer.from(url.slice(prefix.length), 'base64').toString('utf8')).toBe(html);
            },
        );

        it('should answer the promise of the window when it shows a page', async () => {
            const loaded = Promise.resolve();
            mainWindow().loadURL.mockReturnValue(loaded);
            expect(bootstrap.loadHTML('<p></p>')).toBe(loaded);
        });

        it('should show a large page', () => {
            const html = '<p>' + 'x'.repeat(1024 * 1024) + '</p>';
            bootstrap.loadHTML(html);
            const [url] = mainWindow().loadURL.mock.calls[0];
            expect(Buffer.from(url.split(',')[1], 'base64').toString('utf8')).toBe(html);
        });

        it('should fail when there is no window, which is gone or was never opened', () => {
            bootstrap._window = null;
            expect(() => bootstrap.loadURL('hakuneko://cache/index.html')).toThrow(TypeError);
            expect(() => bootstrap.loadHTML('<p></p>')).toThrow(TypeError);
        });
    });
});
