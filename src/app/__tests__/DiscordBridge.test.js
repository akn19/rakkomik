// Discord rich presence transport of the main process: one RPC client that is created on first use, answers the
// renderer with plain success flags and never lets a missing or crashing Discord client escape as an error.
const { mockModule } = require('./support/mockRequire');

const electron = mockModule('electron', () => ({
    ipcMain: { handle: vi.fn() },
}));
// `mockModule` serves a single package per test file (every virtual module shares one cache entry, so a second package
// would get the exports of the first): the RPC library is put into the require cache under its real path instead
const rpc = { Client: vi.fn() };
const rpcFile = require.resolve('@xhayper/discord-rpc');
require.cache[rpcFile] = {
    id: rpcFile,
    filename: rpcFile,
    loaded: true,
    exports: rpc,
    children: [],
    paths: [],
};
const DiscordBridge = require('../DiscordBridge');
const { ConsoleLogger } = require('../Logger');

let clients = [];
let pendingLogins = [];

/**
 * Every `new Client()` of the library is a double that records what it was given. `login` answers `options.login`
 * (default: success at once, `'pending'` keeps the login open until `pendingLogins` are resolved).
 */
function fakeClients(options = {}) {
    clients = [];
    pendingLogins = [];
    rpc.Client.mockImplementation(function (clientOptions) {
        const client = {
            options: clientOptions,
            handlers: {},
            user: options.noUser
                ? undefined
                : {
                      setActivity: vi.fn(options.setActivity || (async () => undefined)),
                      clearActivity: vi.fn(options.clearActivity || (async () => undefined)),
                  },
            on: vi.fn((event, handler) => {
                client.handlers[event] = handler;
            }),
            login: vi.fn(() => {
                if (options.login === 'pending') {
                    return new Promise((resolve) => pendingLogins.push(resolve));
                }
                return options.login ? options.login() : Promise.resolve();
            }),
            destroy: vi.fn(options.destroy || (async () => undefined)),
        };
        clients.push(client);
        return client;
    });
}

describe('DiscordBridge', () => {
    let logger = null;
    let bridge = null;

    afterAll(() => {
        delete require.cache[rpcFile];
    });

    beforeEach(() => {
        vi.clearAllMocks();
        logger = { warn: vi.fn() };
        fakeClients();
        bridge = new DiscordBridge(logger);
    });

    describe('register()', () => {
        it('should answer the three presence channels of the preload bridge, and only those', () => {
            bridge.register();
            expect(electron.ipcMain.handle.mock.calls.map(([channel]) => channel)).toEqual([
                'rakkomik:presence:ensureStarted',
                'rakkomik:presence:setActivity',
                'rakkomik:presence:clearAndDestroy',
            ]);
        });

        it('should not touch the RPC library before the first use', () => {
            bridge.register();
            expect(rpc.Client).not.toHaveBeenCalled();
        });

        it('should run the whole flow when the renderer calls the channels', async () => {
            bridge.register();
            const handlers = Object.fromEntries(electron.ipcMain.handle.mock.calls);
            const status = { details: 'Browsing MangaDex', state: 'Looking at Berserk' };
            await expect(handlers['rakkomik:presence:setActivity']({}, status)).resolves.toBe(
                false,
            );
            await expect(handlers['rakkomik:presence:ensureStarted']({})).resolves.toBe(true);
            await expect(handlers['rakkomik:presence:setActivity']({}, status)).resolves.toBe(true);
            expect(clients[0].user.setActivity).toHaveBeenCalledWith(status);
            await expect(handlers['rakkomik:presence:clearAndDestroy']({})).resolves.toBe(true);
            expect(clients[0].destroy).toHaveBeenCalledTimes(1);
        });

        it('should log through a console logger of its own when it is given none', () => {
            expect(new DiscordBridge()._logger).toBeInstanceOf(ConsoleLogger);
        });
    });

    describe('_ensureStarted()', () => {
        it('should log in to the local Discord client over IPC', async () => {
            await expect(bridge._ensureStarted()).resolves.toBe(true);
            expect(clients).toHaveLength(1);
            expect(clients[0].options.transport).toEqual({ type: 'ipc' });
            // a Discord application id
            expect(clients[0].options.clientId).toMatch(/^\d{17,20}$/);
            expect(clients[0].login).toHaveBeenCalledTimes(1);
        });

        it('should keep the client it has and answer true without logging in again', async () => {
            await bridge._ensureStarted();
            await expect(bridge._ensureStarted()).resolves.toBe(true);
            await expect(bridge._ensureStarted()).resolves.toBe(true);
            expect(clients).toHaveLength(1);
            expect(clients[0].login).toHaveBeenCalledTimes(1);
        });

        it('should answer false and say why when Discord is not running', async () => {
            fakeClients({ login: () => Promise.reject(new Error('Could not connect')) });
            await expect(bridge._ensureStarted()).resolves.toBe(false);
            expect(logger.warn).toHaveBeenCalledTimes(1);
            expect(logger.warn.mock.calls[0][0]).toContain('Could not connect');
            expect(bridge._client).toBeNull();
        });

        it('should try again later and succeed once Discord is there', async () => {
            let running = false;
            fakeClients({
                login: () =>
                    running ? Promise.resolve() : Promise.reject(new Error('Could not connect')),
            });
            await expect(bridge._ensureStarted()).resolves.toBe(false);
            running = true;
            await expect(bridge._ensureStarted()).resolves.toBe(true);
            await expect(bridge._setActivity({ details: 'x' })).resolves.toBe(true);
            expect(clients).toHaveLength(2);
        });

        it.each([
            ['nothing', undefined],
            ['a text', 'refused'],
            ['null', null],
        ])(
            'should answer false when the login fails with %s instead of an error',
            async (_, reason) => {
                fakeClients({ login: () => Promise.reject(reason) });
                await expect(bridge._ensureStarted()).resolves.toBe(false);
                expect(logger.warn).toHaveBeenCalledTimes(1);
            },
        );

        it('should answer false when the client cannot even be created', async () => {
            rpc.Client.mockImplementation(function () {
                throw new Error('library broken');
            });
            await expect(bridge._ensureStarted()).resolves.toBe(false);
            expect(logger.warn.mock.calls[0][0]).toContain('library broken');
        });

        it('should forget the client when Discord goes away and start a new one on the next call', async () => {
            await bridge._ensureStarted();
            clients[0].handlers.disconnected();
            await expect(bridge._setActivity({ details: 'x' })).resolves.toBe(false);
            await expect(bridge._ensureStarted()).resolves.toBe(true);
            expect(clients).toHaveLength(2);
        });

        it('should log in once when it is asked again while the login is pending', async () => {
            fakeClients({ login: 'pending' });
            const first = bridge._ensureStarted();
            const second = bridge._ensureStarted();
            pendingLogins.forEach((resolve) => resolve());
            await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
            expect(clients).toHaveLength(1);
        });
    });

    describe('_setActivity()', () => {
        const status = {
            details: 'Browsing MangaDex',
            state: 'Looking at Berserk',
            startTimestamp: 1760000000000,
        };

        it('should answer false without a client and not complain', async () => {
            await expect(bridge._setActivity(status)).resolves.toBe(false);
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it('should answer false while the client has not got its user yet', async () => {
            fakeClients({ noUser: true });
            await bridge._ensureStarted();
            await expect(bridge._setActivity(status)).resolves.toBe(false);
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it('should hand the status over unchanged and answer true', async () => {
            await bridge._ensureStarted();
            await expect(bridge._setActivity(status)).resolves.toBe(true);
            expect(clients[0].user.setActivity).toHaveBeenCalledTimes(1);
            expect(clients[0].user.setActivity.mock.calls[0][0]).toBe(status);
        });

        it('should answer false and say why when Discord refuses, and keep the client for the next try', async () => {
            let refuse = true;
            fakeClients({
                setActivity: async () => {
                    if (refuse) {
                        throw new Error('RATE_LIMITED');
                    }
                },
            });
            await bridge._ensureStarted();
            await expect(bridge._setActivity(status)).resolves.toBe(false);
            expect(logger.warn.mock.calls[0][0]).toContain('RATE_LIMITED');
            refuse = false;
            await expect(bridge._setActivity(status)).resolves.toBe(true);
            expect(clients).toHaveLength(1);
        });

        it('should answer false when Discord refuses with something that is no error', async () => {
            fakeClients({ setActivity: () => Promise.reject(undefined) });
            await bridge._ensureStarted();
            await expect(bridge._setActivity(status)).resolves.toBe(false);
            expect(logger.warn).toHaveBeenCalledTimes(1);
        });
    });

    describe('_clearAndDestroy()', () => {
        it('should answer false when there is nothing to destroy', async () => {
            await expect(bridge._clearAndDestroy()).resolves.toBe(false);
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it('should clear the activity, then destroy the client and forget it', async () => {
            await bridge._ensureStarted();
            const order = [];
            clients[0].user.clearActivity.mockImplementation(async () => order.push('clear'));
            clients[0].destroy.mockImplementation(async () => order.push('destroy'));
            await expect(bridge._clearAndDestroy()).resolves.toBe(true);
            expect(order).toEqual(['clear', 'destroy']);
            await expect(bridge._setActivity({ details: 'x' })).resolves.toBe(false);
            await expect(bridge._clearAndDestroy()).resolves.toBe(false);
        });

        it('should be able to start again afterwards with a new client', async () => {
            await bridge._ensureStarted();
            await bridge._clearAndDestroy();
            await expect(bridge._ensureStarted()).resolves.toBe(true);
            expect(clients).toHaveLength(2);
            expect(clients[1].destroy).not.toHaveBeenCalled();
        });

        it('should destroy a client that has no user without clearing anything', async () => {
            fakeClients({ noUser: true });
            await bridge._ensureStarted();
            await expect(bridge._clearAndDestroy()).resolves.toBe(true);
            expect(clients[0].destroy).toHaveBeenCalledTimes(1);
        });

        it('should answer true and forget the client even when the destroy fails', async () => {
            fakeClients({ destroy: () => Promise.reject(new Error('pipe closed')) });
            await bridge._ensureStarted();
            await expect(bridge._clearAndDestroy()).resolves.toBe(true);
            expect(logger.warn.mock.calls[0][0]).toContain('pipe closed');
            expect(bridge._client).toBeNull();
        });

        it('should answer true and forget the client even when the activity cannot be cleared', async () => {
            fakeClients({ clearActivity: () => Promise.reject(new Error('pipe closed')) });
            await bridge._ensureStarted();
            await expect(bridge._clearAndDestroy()).resolves.toBe(true);
            expect(logger.warn.mock.calls[0][0]).toContain('pipe closed');
            expect(bridge._client).toBeNull();
        });

        it('should destroy the client even when the activity cannot be cleared', async () => {
            fakeClients({ clearActivity: () => Promise.reject(new Error('pipe closed')) });
            await bridge._ensureStarted();
            await bridge._clearAndDestroy();
            expect(clients[0].destroy).toHaveBeenCalledTimes(1);
        });
    });
});
