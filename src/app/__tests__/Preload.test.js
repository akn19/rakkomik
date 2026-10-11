// The preload script is all a sandboxed renderer has of the main process: it must expose `window.hakuneko` with the
// bridge the engine reads, pass only the intended channels and never hand out Electron's `ipcRenderer` itself.
const { mockModule } = require('./support/mockRequire');
const fs = require('node:fs');
const path = require('node:path');

const electron = mockModule('electron', () => ({
    contextBridge: { exposeInMainWorld: vi.fn() },
    ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn() },
    ipcMain: { handle: vi.fn(), on: vi.fn() }
}));

const PRELOAD = require.resolve('../preload.js');
const ARGUMENT = '--rakkomik-bootstrap=';

const BOOTSTRAP = {
    platform: 'linux',
    env: { HAKUNEKO_PORTABLE: 'TRUE' },
    tmpdir: path.join(path.sep, 'tmp'),
    paths: { home: path.join(path.sep, 'home', 'user'), userData: path.join(path.sep, 'home', 'user', '.config', 'rakkomik') }
};

function argumentOf(bootstrap) {
    return ARGUMENT + encodeURIComponent(JSON.stringify(bootstrap));
}

const FILE = path.join(path.sep, 'data', 'chapter.cbz');
const BYTES = new Uint8Array([1, 2, 3]);

// [function of the bridge, its arguments, the channel it invokes]; the arguments travel unchanged and in order
const TABLE = [
    ['fs.mkdir', [FILE], 'rakkomik:fs:mkdir'],
    ['fs.writeFile', [FILE, BYTES, 'utf8'], 'rakkomik:fs:writeFile'],
    ['fs.rename', [FILE, FILE + '.bak'], 'rakkomik:fs:rename'],
    ['fs.unlink', [FILE], 'rakkomik:fs:unlink'],
    ['fs.readFile', [FILE, 'utf8'], 'rakkomik:fs:readFile'],
    ['fs.stat', [FILE], 'rakkomik:fs:stat'],
    ['fs.readdir', [FILE], 'rakkomik:fs:readdir'],
    ['dialog.showMessageBox', [{ message: 'x' }], 'rakkomik:dialog:showMessageBox'],
    ['dialog.showOpenDialog', [{ properties: ['openDirectory'] }], 'rakkomik:dialog:showOpenDialog'],
    ['shell.openExternal', ['https://example.org/'], 'rakkomik:shell:openExternal'],
    ['shell.showItemInFolder', [FILE], 'rakkomik:shell:showItemInFolder'],
    ['clipboard.readText', [], 'rakkomik:clipboard:readText'],
    ['window.minimize', [], 'rakkomik:window:minimize'],
    ['window.maximize', [], 'rakkomik:window:maximize'],
    ['window.unmaximize', [], 'rakkomik:window:unmaximize'],
    ['window.isMaximized', [], 'rakkomik:window:isMaximized'],
    ['window.close', [], 'rakkomik:window:close'],
    ['exec', ['ls', { cwd: '/' }], 'rakkomik:exec'],
    ['fetch', [{ url: 'https://example.org/' }], 'rakkomik:fetch'],
    ['session.getCookies', [{ name: 'a' }], 'rakkomik:session:getCookies'],
    ['session.setCookie', [{ url: 'https://example.org/', name: 'a' }], 'rakkomik:session:setCookie'],
    ['session.removeCookie', ['https://example.org/', 'a'], 'rakkomik:session:removeCookie'],
    ['session.setProxy', [{ mode: 'direct' }], 'rakkomik:session:setProxy'],
    ['sqlite.query', [BYTES, 'SELECT 1'], 'rakkomik:sqlite:query'],
    ['pdf.render', ['<html></html>'], 'rakkomik:pdf:render'],
    ['presence.ensureStarted', [], 'rakkomik:presence:ensureStarted'],
    ['presence.setActivity', [{ details: 'x' }], 'rakkomik:presence:setActivity'],
    ['presence.clearAndDestroy', [], 'rakkomik:presence:clearAndDestroy']
];

describe('preload', () => {
    const argv = process.argv;

    afterEach(() => {
        process.argv = argv;
    });

    // The preload runs once per page, so it reads `process.argv` while it is loaded: every call loads it again.
    function load(bootstrap = BOOTSTRAP, extra = []) {
        process.argv = [...argv.slice(0, 2), ...extra, ...(bootstrap === null ? [] : [argumentOf(bootstrap)])];
        delete require.cache[PRELOAD];
        electron.contextBridge.exposeInMainWorld.mockClear();
        require(PRELOAD);
        const [name, api] = electron.contextBridge.exposeInMainWorld.mock.calls[0];
        return { name, api };
    }

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('exposure', () => {
        it('should expose one object, under the name the engine reads', () => {
            load();
            expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1);
            expect(electron.contextBridge.exposeInMainWorld.mock.calls[0][0]).toBe('hakuneko');
        });

        it('should expose the values of the main process', () => {
            const { api } = load();
            expect(api.platform).toBe('linux');
            expect(api.env).toEqual({ HAKUNEKO_PORTABLE: 'TRUE' });
            expect(api.os).toEqual({ tmpdir: BOOTSTRAP.tmpdir });
        });

        it('should expose exactly the bridge the engine and the interface use, and nothing else', () => {
            const { api } = load();
            const shape = Object.fromEntries(Object.entries(api).map(([key, value]) => [key, typeof value === 'object' ? Object.keys(value).sort() : typeof value]));
            expect(shape).toEqual({
                platform: 'string',
                env: Object.keys(BOOTSTRAP.env),
                os: ['tmpdir'],
                fs: ['mkdir', 'readFile', 'readdir', 'rename', 'stat', 'unlink', 'writeFile'],
                app: ['getPath'],
                dialog: ['showMessageBox', 'showOpenDialog'],
                shell: ['openExternal', 'showItemInFolder'],
                clipboard: ['readText'],
                window: ['close', 'isMaximized', 'maximize', 'minimize', 'unmaximize'],
                exec: 'function',
                fetch: 'function',
                session: ['getCookies', 'removeCookie', 'setCookie', 'setProxy'],
                sqlite: ['query'],
                pdf: ['render'],
                presence: ['clearAndDestroy', 'ensureStarted', 'setActivity'],
                on: 'function',
                send: 'function'
            });
        });

        it('should never hand out ipcRenderer, nor one of its functions', () => {
            const { api } = load();
            const exposed = new Set();
            const walk = value => {
                exposed.add(value);
                if (value && typeof value === 'object') {
                    Object.values(value).forEach(walk);
                }
            };
            walk(api);
            const forbidden = [electron.ipcRenderer, electron.ipcRenderer.invoke, electron.ipcRenderer.on, electron.ipcRenderer.send];
            for (const value of forbidden) {
                expect(exposed.has(value)).toBe(false);
            }
        });

        it('should not require anything but electron, the only module a sandboxed preload can load', () => {
            // the comments talk about it too
            const source = fs.readFileSync(PRELOAD, 'utf8').replace(/^\s*\/\/.*$/gm, '');
            const required = [...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]);
            expect(required).toEqual(['electron']);
        });
    });

    describe('bootstrap argument', () => {
        it('should find it among the other arguments of the process', () => {
            const { api } = load({ ...BOOTSTRAP, platform: 'darwin' }, ['--no-sandbox', '--user-data-dir=/x', '--other=1']);
            expect(api.platform).toBe('darwin');
        });

        it('should take the first one when there are several', () => {
            process.argv = [...argv.slice(0, 2), argumentOf({ ...BOOTSTRAP, platform: 'first' }), argumentOf({ ...BOOTSTRAP, platform: 'second' })];
            delete require.cache[PRELOAD];
            require(PRELOAD);
            expect(electron.contextBridge.exposeInMainWorld.mock.calls[0][1].platform).toBe('first');
        });

        it('should ignore an argument that only looks like it', () => {
            expect(() => load(null, ['--rakkomik-bootstrapped={}', '--rakkomik-bootstrap', 'rakkomik-bootstrap=x'])).toThrow(/started without its bootstrap data/);
        });

        it('should carry any path of the user through the command line unharmed', () => {
            const paths = {
                documents: path.join(path.sep, 'home', 'Zoë Müller', 'Dokumente & Notizen', '100% #1'),
                downloads: path.join(path.sep, 'ホーム', '漫画', 'ダウンロード'),
                music: 'C:\\Users\\Zoë\\Music;--rakkomik-bootstrap=evil'
            };
            const { api } = load({ ...BOOTSTRAP, paths });
            expect(api.app.getPath('documents')).toBe(paths.documents);
            expect(api.app.getPath('downloads')).toBe(paths.downloads);
            expect(api.app.getPath('music')).toBe(paths.music);
        });

        it('should refuse to start without the argument and name it in the error', () => {
            expect(() => load(null)).toThrow(`The renderer was started without its bootstrap data (${ARGUMENT})!`);
            expect(electron.contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
        });

        it.each([
            ['has no value', ARGUMENT, SyntaxError],
            ['is no JSON', ARGUMENT + encodeURIComponent('{not json'), SyntaxError],
            ['is damaged by its percent encoding', ARGUMENT + '%E0%A4%A', URIError]
        ])('should refuse to start when the argument %s', (_, argument, error) => {
            process.argv = [...argv.slice(0, 2), argument];
            delete require.cache[PRELOAD];
            expect(() => require(PRELOAD)).toThrow(error);
            expect(electron.contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
        });
    });

    describe('app.getPath()', () => {
        it('should answer the directories the main process knows', () => {
            const { api } = load();
            expect(api.app.getPath('home')).toBe(BOOTSTRAP.paths.home);
            expect(api.app.getPath('userData')).toBe(BOOTSTRAP.paths.userData);
        });

        it.each([
            ['a name without a directory', 'documents'],
            ['an unknown name', 'nowhere'],
            ['an empty name', ''],
            ['undefined', undefined],
            ['a name of Object.prototype', 'toString'],
            ['constructor', 'constructor'],
            ['__proto__', '__proto__'],
            ['hasOwnProperty', 'hasOwnProperty']
        ])('should throw like Electron does for %s', (_, name) => {
            const { api } = load();
            expect(() => api.app.getPath(name)).toThrow(`Failed to get '${name}' path`);
        });
    });

    describe('invoke channels', () => {
        const member = (api, name) => name.split('.').reduce((object, key) => object[key], api);

        it.each(TABLE)('should invoke %s on its channel with its arguments and answer what the main process answers', async (name, args, channel) => {
            const { api } = load();
            const answer = { from: 'main' };
            electron.ipcRenderer.invoke.mockResolvedValue(answer);
            await expect(member(api, name)(...args)).resolves.toBe(answer);
            expect(electron.ipcRenderer.invoke).toHaveBeenCalledTimes(1);
            expect(electron.ipcRenderer.invoke.mock.calls[0]).toEqual([channel, ...args]);
        });

        it('should reject when the main process refuses', async () => {
            const { api } = load();
            electron.ipcRenderer.invoke.mockRejectedValue(new Error('ENOENT'));
            await expect(api.fs.readFile(FILE)).rejects.toThrow('ENOENT');
        });

        it('should invoke every channel of its source and nothing else', () => {
            const source = fs.readFileSync(PRELOAD, 'utf8');
            const inSource = new Set([...source.matchAll(/'(rakkomik:[^']+)'/g)].map(match => match[1]));
            expect(inSource).toEqual(new Set(TABLE.map(([, , channel]) => channel)));
        });

        it('should be answered by a handler of the main process for every channel, and every handler is reachable', () => {
            const handled = new Set();
            electron.ipcMain.handle.mockImplementation(channel => handled.add(channel));
            const bridges = ['FsBridge', 'IpcBridge', 'DiscordBridge', 'SqliteBridge', 'PdfBridge', 'FetchWindowManager'];
            for (const name of bridges) {
                const Bridge = require(`../${name}`);
                new Bridge({ warn: vi.fn() }).register();
            }
            expect(handled).toEqual(new Set(TABLE.map(([, , channel]) => channel)));
            // a channel twice would make Electron throw while the application starts
            expect(electron.ipcMain.handle).toHaveBeenCalledTimes(handled.size);
        });
    });

    describe('on()', () => {
        const ALLOWED = ['on-before-send-headers', 'on-headers-received', 'on-connector-protocol-handler', 'login', 'close', 'quit'];

        it.each(ALLOWED)('should subscribe to %s', channel => {
            const { api } = load();
            expect(api.on(channel, vi.fn())).toBeUndefined();
            expect(electron.ipcRenderer.on).toHaveBeenCalledTimes(1);
            expect(electron.ipcRenderer.on.mock.calls[0][0]).toBe(channel);
        });

        it.each([
            ['an unknown channel', 'rakkomik:fs:readFile'],
            ['a channel of Electron', 'ELECTRON_BROWSER_REQUIRE'],
            ['another case', 'Close'],
            ['a padded name', 'close '],
            ['an empty name', ''],
            ['undefined', undefined],
            ['an array that holds an allowed name', ['close']],
            ['an object that prints as an allowed name', { toString: () => 'close' }]
        ])('should refuse %s', (_, channel) => {
            const { api } = load();
            expect(() => api.on(channel, vi.fn())).toThrow(`IPC channel "${String(channel)}" is not allowed!`);
            expect(electron.ipcRenderer.on).not.toHaveBeenCalled();
        });

        it('should subscribe to exactly these channels: every other channel of the bridge, and the names of its functions, is refused', () => {
            const { api } = load();
            const others = [...TABLE.map(([, , channel]) => channel), 'exec', 'fetch', 'send', 'on', 'session', 'sqlite', 'pdf', 'presence', 'closed', 'quit-now', 'message', 'ping'];
            for (const channel of others) {
                expect(() => api.on(channel, vi.fn())).toThrow(`IPC channel "${channel}" is not allowed!`);
            }
            expect(electron.ipcRenderer.on).not.toHaveBeenCalled();
        });

        it('should call the listener with the arguments of the message and without the event of Electron', () => {
            const { api } = load();
            const listener = vi.fn();
            api.on('login', listener);
            const callback = electron.ipcRenderer.on.mock.calls[0][1];
            const event = { sender: { send: vi.fn() }, senderId: 1 };
            callback(event, 'response-channel', { host: 'proxy.test', isProxy: true });
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith('response-channel', { host: 'proxy.test', isProxy: true });
        });

        it('should call the listener of a message without arguments with nothing', () => {
            const { api } = load();
            const listener = vi.fn();
            api.on('close', listener);
            electron.ipcRenderer.on.mock.calls[0][1]({ sender: {} });
            expect(listener.mock.calls).toEqual([[]]);
        });

        it('should keep every subscription, one per call', () => {
            const { api } = load();
            api.on('close', vi.fn());
            api.on('close', vi.fn());
            expect(electron.ipcRenderer.on).toHaveBeenCalledTimes(2);
        });
    });

    describe('send()', () => {
        it('should send the arguments to the channel the renderer names, e.g. the answer to a request of the main process', () => {
            const { api } = load();
            expect(api.send('17917297148660.123', { data: [1, 2] })).toBeUndefined();
            expect(api.send('quit')).toBeUndefined();
            expect(electron.ipcRenderer.send.mock.calls).toEqual([['17917297148660.123', { data: [1, 2] }], ['quit']]);
            expect(electron.ipcRenderer.invoke).not.toHaveBeenCalled();
        });

        // NOTE: unlike `on`, `send` has no whitelist, because the answer to a request of the main process goes to a
        // channel the main process makes up for each request. Every `ipcMain.on` listener is reachable this way.
        it('should send to any channel', () => {
            const { api } = load();
            api.send('anything-at-all', 1, 2, 3);
            expect(electron.ipcRenderer.send).toHaveBeenCalledWith('anything-at-all', 1, 2, 3);
        });
    });
});
