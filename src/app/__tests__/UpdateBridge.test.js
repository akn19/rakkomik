// Updates of the web part while the application runs (the settings of the menu): the main process answers what is
// installed, whether there is another version, installs it with its steps sent to the window, and reloads the window.
const { mockModule } = require('./support/mockRequire');

const electron = mockModule('electron', () => ({
    ipcMain: { handle: vi.fn() },
}));
const UpdateBridge = require('../UpdateBridge');

const KEY = 'the public key';

function setup({ updater = {}, cache = {} } = {}) {
    const handlers = {};
    electron.ipcMain.handle.mockReset();
    electron.ipcMain.handle.mockImplementation((channel, handler) => (handlers[channel] = handler));
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const testee = new UpdateBridge(
        {
            check: vi.fn(async () => ({
                disabled: false,
                available: true,
                current: 'OLD',
                latest: 'NEW',
            })),
            updateCache: vi.fn(async (key, report) => {
                report({ stage: 'checking' });
                report({ stage: 'updated', version: 'NEW' });
            }),
            ...updater,
        },
        { getCurrentVersion: vi.fn(async () => 'OLD'), ...cache },
        KEY,
        logger,
    );
    testee.register();
    const sender = {
        send: vi.fn(),
        isDestroyed: vi.fn(() => false),
        reloadIgnoringCache: vi.fn(),
    };
    const call = (channel) => handlers[channel]({ sender });
    return { testee, handlers, call, sender, logger };
}

describe('UpdateBridge', () => {
    it('should answer the four channels of the updates', () => {
        const { handlers } = setup();
        expect(Object.keys(handlers).sort()).toEqual([
            'rakkomik:update:apply',
            'rakkomik:update:check',
            'rakkomik:update:current',
            'rakkomik:update:restart',
        ]);
    });

    it('should tell the version in the cache, and nothing for an empty cache', async () => {
        expect(await setup().call('rakkomik:update:current')).toBe('OLD');
        const { call } = setup({ cache: { getCurrentVersion: vi.fn(async () => undefined) } });
        expect(await call('rakkomik:update:current')).toBeNull();
    });

    it('should tell what the update server has, and the reason when it cannot be asked', async () => {
        expect(await setup().call('rakkomik:update:check')).toEqual({
            disabled: false,
            available: true,
            current: 'OLD',
            latest: 'NEW',
        });
        const { call, logger } = setup({
            updater: { check: vi.fn(async () => Promise.reject(new Error('offline'))) },
        });
        expect(await call('rakkomik:update:check')).toEqual({ error: 'offline' });
        expect(logger.warn).toHaveBeenCalled();
    });

    it('should install with the key of the application, send every step to the window and answer the last', async () => {
        const { testee, call, sender } = setup();
        expect(await call('rakkomik:update:apply')).toEqual({ stage: 'updated', version: 'NEW' });
        expect(testee._updater.updateCache).toHaveBeenCalledWith(KEY, expect.any(Function));
        expect(sender.send.mock.calls).toEqual([
            ['update-progress', { stage: 'checking' }],
            ['update-progress', { stage: 'updated', version: 'NEW' }],
        ]);
    });

    it('should install once when it is asked twice meanwhile, and again after that', async () => {
        let finish;
        const { testee, call } = setup({
            updater: {
                updateCache: vi.fn(
                    (key, report) =>
                        new Promise((resolve) => {
                            finish = () => {
                                report({ stage: 'current', version: 'OLD' });
                                resolve();
                            };
                        }),
                ),
            },
        });
        const first = call('rakkomik:update:apply');
        const second = call('rakkomik:update:apply');
        finish();
        expect(await first).toEqual({ stage: 'current', version: 'OLD' });
        expect(await second).toEqual({ stage: 'current', version: 'OLD' });
        expect(testee._updater.updateCache).toHaveBeenCalledTimes(1);
        const third = call('rakkomik:update:apply');
        finish();
        await third;
        expect(testee._updater.updateCache).toHaveBeenCalledTimes(2);
    });

    it('should not send steps to a window that is gone', async () => {
        const { call, sender } = setup();
        sender.isDestroyed.mockReturnValue(true);
        expect(await call('rakkomik:update:apply')).toEqual({ stage: 'updated', version: 'NEW' });
        expect(sender.send).not.toHaveBeenCalled();
    });

    it('should reload the window onto the installed web part, past the cache of the browser', async () => {
        const { call, sender } = setup();
        await call('rakkomik:update:restart');
        expect(sender.reloadIgnoringCache).toHaveBeenCalledTimes(1);
    });
});
