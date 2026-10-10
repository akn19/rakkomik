// Fetch window flow: run the script on the real content, wait while a page
// completes its own check, show the window when a human is needed (or when
// the check takes too long), and fail clearly on timeouts, blocks and closed windows.
const { mockModule } = require('./support/mockRequire');
const { EventEmitter } = require('node:events');

mockModule('electron', () => ({
    ipcMain: { handle: vi.fn() },
    BrowserWindow: vi.fn()
}));
const FetchWindowManager = require('../FetchWindowManager');

const JOB = {
    url: 'https://site.test/page',
    scrapingCheckScript: 'DETECT',
    domPreparationScript: 'PREPARE',
    runtimeScript: 'RUN',
    timeout: 60000,
    interactiveAfter: 2000,
    interactiveTimeout: 5000
};

/**
 * A BrowserWindow double: every `loadURL` and `reload()` fires `did-finish-load`;
 * the detection script answers with the next entry of `detections`.
 */
function fakeWindow(detections, runtimeResult = 'RESULT') {
    const webContents = new EventEmitter();
    webContents.session = { webRequest: { onBeforeRequest: vi.fn() } };
    webContents.executeJavaScript = vi.fn(async script => {
        if (script === 'DETECT') {
            return detections.shift();
        }
        return script === 'RUN' ? runtimeResult : undefined;
    });
    const win = Object.assign(new EventEmitter(), {
        webContents,
        setSize: vi.fn(),
        center: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
        close: vi.fn(),
        isDestroyed: () => false,
        loadURL: vi.fn(() => queueMicrotask(() => {
            webContents.emit('dom-ready');
            webContents.emit('did-finish-load');
        })),
        reload: () => webContents.emit('did-finish-load')
    });
    return win;
}

// Observe a promise without timers (works under fake timers too)
function track(promise) {
    const state = { value: 'pending' };
    promise.then(() => { state.value = 'resolved'; }, () => { state.value = 'rejected'; });
    return state;
}

const tick = () => new Promise(resolve => setTimeout(resolve, 20));

describe('FetchWindowManager', () => {
    let manager = null;

    beforeEach(() => {
        manager = new FetchWindowManager({ info: vi.fn(), warn: vi.fn() });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should run the script and resolve when the page shows the content', async () => {
        const win = fakeWindow([ { redirection: 'none' } ]);
        await expect(manager._load(win, JOB)).resolves.toBe('RESULT');
        expect(win.loadURL).toHaveBeenCalledWith('https://site.test/page', {});
        expect(win.webContents.executeJavaScript).toHaveBeenCalledWith('PREPARE');
        expect(win.show).not.toHaveBeenCalled();
    });

    it('should wait while the page completes its own check and continue on the next load', async () => {
        const win = fakeWindow([ { redirection: 'automatic', detector: 'cloudflare-challenge' }, { redirection: 'none' } ]);
        const result = manager._load(win, JOB);
        const state = track(result);
        await tick();
        expect(state.value).toBe('pending');
        win.reload();
        await expect(result).resolves.toBe('RESULT');
        expect(win.show).not.toHaveBeenCalled();
    });

    it('should show the window when the page needs the user', async () => {
        const win = fakeWindow([ { redirection: 'interactive', detector: 'captcha-gate' }, { redirection: 'none' } ]);
        const result = manager._load(win, JOB);
        await vi.waitFor(() => expect(win.show).toHaveBeenCalledTimes(1));
        expect(win.focus).toHaveBeenCalled();
        win.reload();
        await expect(result).resolves.toBe('RESULT');
    });

    it('should show the window when an automatic check does not finish in time', async () => {
        vi.useFakeTimers();
        const win = fakeWindow([ { redirection: 'automatic', detector: 'ddos-guard' }, { redirection: 'none' } ]);
        const result = manager._load(win, JOB);
        await vi.advanceTimersByTimeAsync(1999);
        expect(win.show).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(win.show).toHaveBeenCalledTimes(1);
        win.reload();
        await expect(result).resolves.toBe('RESULT');
    });

    it('should give the user more time once the window is shown, then fail with the timeout', async () => {
        vi.useFakeTimers();
        const win = fakeWindow([ { redirection: 'automatic', detector: 'cloudflare-challenge' } ]);
        const result = manager._load(win, JOB);
        const state = track(result);
        await vi.advanceTimersByTimeAsync(2000);
        expect(win.show).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(4999);
        expect(state.value).toBe('pending');
        await vi.advanceTimersByTimeAsync(1);
        await expect(result).rejects.toThrow('Failed to load "https://site.test/page" within the given timeout of 5 seconds!');
    });

    it('should fail when the user closes the window', async () => {
        const win = fakeWindow([ { redirection: 'interactive', detector: 'captcha-gate' } ]);
        const result = manager._load(win, JOB);
        await vi.waitFor(() => expect(win.show).toHaveBeenCalled());
        win.emit('closed');
        await expect(result).rejects.toThrow(/closed before the page finished loading/);
    });

    it('should fail at once on pages that refuse the request', async () => {
        const win = fakeWindow([ { redirection: 'error', detector: 'cloudflare-error', message: 'Cloudflare error 1020' } ]);
        await expect(manager._load(win, JOB)).rejects.toThrow('Cloudflare error 1020');
        expect(win.show).not.toHaveBeenCalled();
    });

    it('should understand the plain string answers of older detection scripts', async () => {
        const win = fakeWindow([ 'interactive', 'automatic', undefined ]);
        const result = manager._load(win, JOB);
        const state = track(result);
        await vi.waitFor(() => expect(win.show).toHaveBeenCalledTimes(1));
        win.reload();
        await tick();
        expect(state.value).toBe('pending');
        win.reload();
        await expect(result).resolves.toBe('RESULT');
    });

    it('should fail when the main frame cannot be loaded', async () => {
        const win = fakeWindow([]);
        win.loadURL = vi.fn(() => queueMicrotask(() => win.webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://site.test/page', true)));
        await expect(manager._load(win, JOB)).rejects.toThrow('ERR_NAME_NOT_RESOLVED https://site.test/page');
    });
});
