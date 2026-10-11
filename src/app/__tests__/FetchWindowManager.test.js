// Fetch window flow: run the script on the real content, wait while a page
// completes its own check, show the window when a human is needed (or when
// the check takes too long), and fail clearly on timeouts, blocks and closed windows.
const { mockModule } = require('./support/mockRequire');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const electron = mockModule('electron', () => ({
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
    describe('_load() when things go differently', () => {
        it('should keep the outcome of the first event: later events change nothing', async () => {
            const win = fakeWindow([ { redirection: 'none' } ]);
            const result = manager._load(win, JOB);
            await expect(result).resolves.toBe('RESULT');
            win.emit('closed');
            win.webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', JOB.url, true);
            win.reload();
            await tick();
            await expect(result).resolves.toBe('RESULT');
        });

        it.each([
            ['an aborted load, which is what a redirect looks like', -3, 'https://site.test/page', true, false],
            ['no error code', 0, 'https://site.test/page', true, false],
            ['a failing image of the page', -105, 'https://site.test/image.png', false, false],
            ['a failing frame of the page', -105, 'https://ads.test/frame', false, false],
            ['the failing page of the job, loaded in a frame', -105, 'https://site.test/page', false, true],
            ['the failing main frame', -105, 'https://site.test/redirected', true, true],
            ['a refused connection', -102, 'https://site.test/page', true, true]
        ])('should treat %s accordingly', async (_, code, uri, isMain, rejects) => {
            const win = fakeWindow([]);
            win.loadURL = vi.fn(() => queueMicrotask(() => win.webContents.emit('did-fail-load', {}, code, 'ERR_SOMETHING', uri, isMain)));
            const result = manager._load(win, JOB);
            const state = track(result);
            await tick();
            expect(state.value).toBe(rejects ? 'rejected' : 'pending');
            if (rejects) {
                await expect(result).rejects.toThrow(`ERR_SOMETHING ${uri}`);
            } else {
                win.webContents.emit('did-finish-load');
                await expect(result).resolves.toBe('RESULT');
            }
        });

        it('should give a page that is refused a message of its own, or say which check refused it', async () => {
            await expect(manager._load(fakeWindow([ { redirection: 'error', detector: 'captcha-wall' } ]), JOB)).rejects.toThrow('The request to "https://site.test/page" was refused (captcha-wall)');
        });

        it('should fail when the script of the page fails', async () => {
            const win = fakeWindow([ { redirection: 'none' } ]);
            win.webContents.executeJavaScript.mockImplementation(async script => {
                if (script === 'DETECT') {
                    return { redirection: 'none' };
                }
                throw new Error('Script failed to execute');
            });
            await expect(manager._load(win, JOB)).rejects.toThrow('Script failed to execute');
        });

        it('should fail when the check of the page cannot be run', async () => {
            const win = fakeWindow([]);
            win.webContents.executeJavaScript.mockImplementation(async script => {
                if (script === 'DETECT') {
                    throw new Error('Object has been destroyed');
                }
            });
            await expect(manager._load(win, JOB)).rejects.toThrow('Object has been destroyed');
        });

        it('should go on, and say so, when the preparation of the page fails', async () => {
            const win = fakeWindow([ { redirection: 'none' } ]);
            const failure = new Error('Script failed to execute');
            win.webContents.executeJavaScript.mockImplementation(async script => {
                if (script === 'PREPARE') {
                    throw failure;
                }
                return script === 'DETECT' ? { redirection: 'none' } : 'RESULT';
            });
            await expect(manager._load(win, JOB)).resolves.toBe('RESULT');
            expect(manager._logger.warn).toHaveBeenCalledWith(failure);
        });

        it('should run no preparation when the job has none, and no check when the job has none', async () => {
            const win = fakeWindow([]);
            const job = { url: JOB.url, runtimeScript: JOB.runtimeScript };
            await expect(manager._load(win, job)).resolves.toBe('RESULT');
            expect(win.webContents.executeJavaScript.mock.calls).toEqual([[ 'RUN' ]]);
        });

        it('should pass the load options of the job to the window', async () => {
            const win = fakeWindow([ { redirection: 'none' } ]);
            const loadOptions = { httpReferrer: 'https://site.test/', userAgent: 'Custom/1.0', extraHeaders: 'x-test: 1' };
            await manager._load(win, { ...JOB, loadOptions });
            expect(win.loadURL).toHaveBeenCalledWith(JOB.url, loadOptions);
        });

        it('should show the window once, whatever the number of times the page asks for the user', async () => {
            const win = fakeWindow([ { redirection: 'interactive', detector: 'captcha-gate' }, { redirection: 'interactive', detector: 'captcha-gate' }, { redirection: 'none' } ]);
            const result = manager._load(win, JOB);
            await vi.waitFor(() => expect(win.show).toHaveBeenCalledTimes(1));
            win.reload();
            await tick();
            expect(win.show).toHaveBeenCalledTimes(1);
            win.reload();
            await expect(result).resolves.toBe('RESULT');
            expect(win.show).toHaveBeenCalledTimes(1);
            expect(win.setSize).toHaveBeenCalledWith(1280, 720);
            expect(win.center).toHaveBeenCalledTimes(1);
            expect(win.focus).toHaveBeenCalledTimes(1);
        });

        it('should say in the log that the window is shown and for which check', async () => {
            const win = fakeWindow([ { redirection: 'interactive', detector: 'captcha-gate' }, { redirection: 'none' } ]);
            const result = manager._load(win, JOB);
            await vi.waitFor(() => expect(win.show).toHaveBeenCalled());
            expect(manager._logger.info).toHaveBeenCalledWith('Showing the window for "https://site.test/page" to the user (captcha-gate)');
            win.reload();
            await result;
        });

        it('should show the window at once when an automatic check turns into one that needs the user', async () => {
            vi.useFakeTimers();
            const win = fakeWindow([ { redirection: 'automatic', detector: 'ddos-guard' }, { redirection: 'interactive', detector: 'captcha-gate' }, { redirection: 'none' } ]);
            const result = manager._load(win, JOB);
            await vi.advanceTimersByTimeAsync(100);
            expect(win.show).not.toHaveBeenCalled();
            win.reload();
            await vi.advanceTimersByTimeAsync(0);
            expect(win.show).toHaveBeenCalledTimes(1);
            // the countdown of the automatic check is gone: it does not show the window a second time
            await vi.advanceTimersByTimeAsync(JOB.interactiveAfter * 2);
            expect(win.show).toHaveBeenCalledTimes(1);
            win.reload();
            await expect(result).resolves.toBe('RESULT');
        });

        it('should not show the window when the automatic check is done before the countdown is', async () => {
            vi.useFakeTimers();
            const win = fakeWindow([ { redirection: 'automatic', detector: 'cloudflare-challenge' }, { redirection: 'none' } ]);
            const result = manager._load(win, JOB);
            await vi.advanceTimersByTimeAsync(JOB.interactiveAfter - 1);
            win.reload();
            await expect(result).resolves.toBe('RESULT');
            await vi.advanceTimersByTimeAsync(JOB.interactiveAfter * 10);
            expect(win.show).not.toHaveBeenCalled();
        });

        it('should start the countdown of an automatic check once, not at every load of the check', async () => {
            vi.useFakeTimers();
            const win = fakeWindow([ { redirection: 'automatic', detector: 'cloudflare-challenge' }, { redirection: 'automatic', detector: 'cloudflare-challenge' }, { redirection: 'none' } ]);
            const result = manager._load(win, JOB);
            await vi.advanceTimersByTimeAsync(JOB.interactiveAfter - 500);
            win.reload();
            // a second countdown would show the window 500 ms later than the first one
            await vi.advanceTimersByTimeAsync(500);
            expect(win.show).toHaveBeenCalledTimes(1);
            win.reload();
            await expect(result).resolves.toBe('RESULT');
        });

        it('should not show the window while the script of the job runs on a page that was let through', async () => {
            vi.useFakeTimers();
            const win = fakeWindow([ { redirection: 'automatic', detector: 'cloudflare-challenge' }, { redirection: 'none' } ]);
            let finish = null;
            const detect = win.webContents.executeJavaScript.getMockImplementation();
            win.webContents.executeJavaScript.mockImplementation(script => {
                if (script === 'RUN') {
                    return new Promise(resolve => {
                        finish = () => resolve('RESULT');
                    });
                }
                return detect(script);
            });
            const result = manager._load(win, JOB);
            await vi.advanceTimersByTimeAsync(100);
            win.reload();
            await vi.advanceTimersByTimeAsync(JOB.interactiveAfter * 5);
            expect(finish).not.toBeNull();
            expect(win.show).not.toHaveBeenCalled();
            finish();
            await expect(result).resolves.toBe('RESULT');
        });

        it('should not show the window after the page is done, however often the check has reloaded the page', async () => {
            vi.useFakeTimers();
            const win = fakeWindow([ { redirection: 'automatic', detector: 'cloudflare-challenge' }, { redirection: 'automatic', detector: 'cloudflare-challenge' }, { redirection: 'none' } ]);
            const result = manager._load(win, JOB);
            await vi.advanceTimersByTimeAsync(JOB.interactiveAfter - 500);
            win.reload();
            await vi.advanceTimersByTimeAsync(100);
            win.reload();
            await expect(result).resolves.toBe('RESULT');
            // no countdown of the check is left to show the window of a job that is over
            await vi.advanceTimersByTimeAsync(JOB.interactiveAfter * 10);
            expect(win.show).not.toHaveBeenCalled();
        });

        it('should wait 15 seconds for an automatic check, give the user 180 seconds, and the page 60 seconds, unless the job says otherwise', async () => {
            vi.useFakeTimers();
            const job = { url: 'https://site.test/page', scrapingCheckScript: 'DETECT', runtimeScript: 'RUN' };
            const win = fakeWindow([ { redirection: 'automatic', detector: 'cloudflare-challenge' } ]);
            const result = manager._load(win, job);
            const state = track(result);
            await vi.advanceTimersByTimeAsync(14999);
            expect(win.show).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(win.show).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(179999);
            expect(state.value).toBe('pending');
            await vi.advanceTimersByTimeAsync(1);
            await expect(result).rejects.toThrow('within the given timeout of 180 seconds!');
        });

        it('should fail a page that never answers with the timeout of the job, 60 seconds by default', async () => {
            vi.useFakeTimers();
            const job = { url: 'https://site.test/page', runtimeScript: 'RUN' };
            const win = fakeWindow([]);
            win.loadURL = vi.fn();
            const result = expect(manager._load(win, job)).rejects.toThrow('within the given timeout of 60 seconds!');
            await vi.advanceTimersByTimeAsync(60000);
            await result;
            const custom = fakeWindow([]);
            custom.loadURL = vi.fn();
            const slow = expect(manager._load(custom, { ...job, timeout: 1500 })).rejects.toThrow('within the given timeout of 1 seconds!');
            await vi.advanceTimersByTimeAsync(1500);
            await slow;
        });

        it('should not fail after the page has delivered, whatever the timers do', async () => {
            vi.useFakeTimers();
            const win = fakeWindow([ { redirection: 'none' } ]);
            const result = manager._load(win, JOB);
            await expect(result).resolves.toBe('RESULT');
            await vi.advanceTimersByTimeAsync(JOB.timeout * 10);
            await expect(result).resolves.toBe('RESULT');
        });
    });

    describe('_detect()', () => {
        it('should find nothing to wait for without a script of the job', async () => {
            const win = fakeWindow([]);
            await expect(manager._detect(win, undefined)).resolves.toEqual({ redirection: 'none' });
            expect(win.webContents.executeJavaScript).not.toHaveBeenCalled();
        });

        it.each([
            ['an answer that names its redirection', { redirection: 'interactive', detector: 'captcha-gate', message: 'Solve it' }, { redirection: 'interactive', detector: 'captcha-gate', message: 'Solve it' }],
            ['an answer without a redirection', { detector: 'none-found' }, { redirection: 'none', detector: 'none-found' }],
            ['an answer with an empty redirection', { redirection: '', detector: 'x' }, { redirection: 'none', detector: 'x' }],
            ['the plain text of an older check', 'automatic', { redirection: 'automatic', detector: 'legacy' }],
            ['an empty text of an older check', '', { redirection: '', detector: 'legacy' }],
            ['no answer', undefined, { redirection: 'none', detector: 'legacy' }],
            ['null', null, { redirection: 'none', detector: 'legacy' }],
            ['a number', 7, { redirection: 'none', detector: 'legacy' }]
        ])('should understand %s', async (_, answer, expected) => {
            const win = fakeWindow([]);
            win.webContents.executeJavaScript.mockResolvedValue(answer);
            await expect(manager._detect(win, 'DETECT')).resolves.toEqual(expected);
        });

        it('should not change the answer of the page', async () => {
            const win = fakeWindow([]);
            const answer = { detector: 'x' };
            win.webContents.executeJavaScript.mockResolvedValue(answer);
            await manager._detect(win, 'DETECT');
            expect(answer).toEqual({ detector: 'x' });
        });
    });

    describe('_log()', () => {
        it.each([
            ['without a logger', undefined],
            ['with a logger that has no such method', {}],
            ['with a logger whose method is no function', { info: 'no' }]
        ])('should say nothing, and fail not, %s', (_, logger) => {
            expect(() => new FetchWindowManager(logger)._log('info', 'x')).not.toThrow();
        });

        it('should hand the message to the method of the level', () => {
            const logger = { info: vi.fn(), warn: vi.fn() };
            new FetchWindowManager(logger)._log('warn', 'careful');
            expect(logger.warn).toHaveBeenCalledWith('careful');
            expect(logger.info).not.toHaveBeenCalled();
        });
    });

    describe('_cleanup()', () => {
        it('should unsubscribe the session and close the window', () => {
            const win = fakeWindow([]);
            manager._cleanup(win);
            expect(win.webContents.session.webRequest.onBeforeRequest).toHaveBeenCalledWith(null);
            expect(win.close).toHaveBeenCalledTimes(1);
        });

        it('should leave a window alone that is gone already, and a window that was never there', () => {
            const win = fakeWindow([]);
            win.isDestroyed = () => true;
            manager._cleanup(win);
            expect(win.close).not.toHaveBeenCalled();
            expect(win.webContents.session.webRequest.onBeforeRequest).not.toHaveBeenCalled();
            expect(() => manager._cleanup(null)).not.toThrow();
            expect(() => manager._cleanup(undefined)).not.toThrow();
        });

        it('should close the window, and say so, when the session cannot be unsubscribed', () => {
            const win = fakeWindow([]);
            const failure = new Error('session destroyed');
            win.webContents.session.webRequest.onBeforeRequest.mockImplementation(() => {
                throw failure;
            });
            manager._cleanup(win);
            expect(manager._logger.warn).toHaveBeenCalledWith(failure);
            expect(win.close).toHaveBeenCalledTimes(1);
        });
    });

    describe('register() and _run()', () => {
        let created = null;
        let files = null;

        const leftovers = () => fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('rakkomik-fetch-'));

        // every window the application makes is a double that answers with the next detection
        function windows(detections = [ { redirection: 'none' } ], runtimeResult = 'RESULT') {
            electron.BrowserWindow.mockImplementation(function(options) {
                const win = fakeWindow([ ...detections ], runtimeResult);
                // the preload script has to be there while the window is being made
                if (options.webPreferences.preload) {
                    files.push({ file: options.webPreferences.preload, content: fs.readFileSync(options.webPreferences.preload, 'utf8') });
                }
                created.push({ options, win });
                return win;
            });
        }

        beforeEach(() => {
            created = [];
            files = [];
            electron.ipcMain.handle.mockClear();
            windows();
        });

        afterEach(() => {
            electron.BrowserWindow.mockReset();
        });

        it('should answer the channel of the renderer with the result of the job', async () => {
            manager.register();
            expect(electron.ipcMain.handle).toHaveBeenCalledTimes(1);
            const [ channel, handler ] = electron.ipcMain.handle.mock.calls[0];
            expect(channel).toBe('rakkomik:fetch');
            await expect(handler({}, JOB)).resolves.toBe('RESULT');
        });

        it('should fail the channel with the failure of the job', async () => {
            windows([ { redirection: 'error', message: 'Cloudflare error 1020' } ]);
            manager.register();
            const [ , handler ] = electron.ipcMain.handle.mock.calls[0];
            await expect(handler({}, JOB)).rejects.toThrow('Cloudflare error 1020');
        });

        it('should open a hidden window and load the page in it', async () => {
            await manager._run(JOB);
            expect(created).toHaveLength(1);
            expect(created[0].options.show).toBe(false);
            expect(created[0].win.loadURL).toHaveBeenCalledWith(JOB.url, {});
        });

        // NOTE: web security is off for the pages of the sites unless the job turns it on (the scripts of the connectors
        // read across origins), a security-relevant default that is kept as it is. Characterisation.
        it('should give the page of a site only what the job asks for: no Node.js, no images, no web security', async () => {
            await manager._run(JOB);
            const { preload, ...preferences } = created[0].options.webPreferences;
            expect(preload).toBeUndefined();
            expect(preferences).toEqual({ nodeIntegration: false, webSecurity: false, images: false });
        });

        it.each([
            ['nodeIntegration'],
            ['webSecurity'],
            ['images']
        ])('should pass on %s when the job asks for it, and only then', async name => {
            await manager._run({ ...JOB, preferences: { [name]: true } });
            expect(created[0].options.webPreferences[name]).toBe(true);
            await manager._run({ ...JOB, preferences: { [name]: false } });
            expect(created[1].options.webPreferences[name]).toBe(false);
            await manager._run({ ...JOB, preferences: {} });
            expect(created[2].options.webPreferences[name]).toBe(false);
        });

        it('should leave the isolation of the page of a site to the defaults of Electron: isolated and sandboxed', async () => {
            await manager._run({ ...JOB, preferences: { nodeIntegration: false } });
            const preferences = created[0].options.webPreferences;
            expect(preferences.contextIsolation).not.toBe(false);
            expect(preferences.sandbox).not.toBe(false);
            expect(preferences.nodeIntegrationInSubFrames).not.toBe(true);
            expect(preferences.nodeIntegrationInWorker).not.toBe(true);
        });

        it('should write the preload script of the job to a file for the window and remove the file afterwards', async () => {
            const before = leftovers();
            await manager._run({ ...JOB, preloadScript: 'window.__rakkomik = 1;' });
            expect(files).toHaveLength(1);
            expect(path.dirname(files[0].file)).toBe(os.tmpdir());
            expect(path.basename(files[0].file)).toMatch(/^rakkomik-fetch-[0-9a-f-]{36}\.js$/);
            expect(files[0].content).toBe('window.__rakkomik = 1;');
            expect(fs.existsSync(files[0].file)).toBe(false);
            expect(leftovers()).toEqual(before);
        });

        it('should deliver the result even when the preload file cannot be removed', async () => {
            const before = leftovers();
            vi.spyOn(fs.promises, 'unlink').mockRejectedValueOnce(Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }));
            try {
                await expect(manager._run({ ...JOB, preloadScript: 'x' })).resolves.toBe('RESULT');
                expect(created[0].win.close).toHaveBeenCalledTimes(1);
            } finally {
                vi.restoreAllMocks();
                // the removal that failed in the test is made here
                for (const name of leftovers().filter(entry => !before.includes(entry))) {
                    fs.rmSync(path.join(os.tmpdir(), name), { force: true });
                }
            }
        });

        it('should use a file of its own for every job, also when they run at the same time', async () => {
            await Promise.all([ 'one', 'two', 'three' ].map(script => manager._run({ ...JOB, preloadScript: script })));
            expect(new Set(files.map(entry => entry.file)).size).toBe(3);
            expect(files.map(entry => entry.content).sort()).toEqual([ 'one', 'three', 'two' ]);
        });

        it('should write no file when the job has no preload script', async () => {
            const before = leftovers();
            await manager._run(JOB);
            expect(files).toHaveLength(0);
            expect(leftovers()).toEqual(before);
        });

        it('should remove the preload file and close the window when the job fails', async () => {
            windows([ { redirection: 'error', message: 'refused' } ]);
            const before = leftovers();
            await expect(manager._run({ ...JOB, preloadScript: 'x' })).rejects.toThrow('refused');
            expect(leftovers()).toEqual(before);
            expect(created[0].win.close).toHaveBeenCalledTimes(1);
            expect(created[0].win.webContents.session.webRequest.onBeforeRequest).toHaveBeenLastCalledWith(null);
        });

        it('should close the window when the job succeeds', async () => {
            await manager._run(JOB);
            expect(created[0].win.close).toHaveBeenCalledTimes(1);
        });

        it('should block the requests of the blacklist, and only those', async () => {
            await manager._run({ ...JOB, blacklist: [ 'https://ads.test/*', '*://*.tracker.test/*' ] });
            const calls = created[0].win.webContents.session.webRequest.onBeforeRequest.mock.calls;
            expect(calls[0][0]).toEqual({ urls: [ 'https://ads.test/*', '*://*.tracker.test/*' ] });
            const callback = vi.fn();
            calls[0][1]({ url: 'https://ads.test/banner' }, callback);
            expect(callback).toHaveBeenCalledWith({ cancel: true });
        });

        it.each([
            ['no blacklist', undefined],
            ['an empty blacklist', []]
        ])('should subscribe the session only to unsubscribe it again when there is %s', async (_, blacklist) => {
            await manager._run({ ...JOB, blacklist });
            expect(created[0].win.webContents.session.webRequest.onBeforeRequest.mock.calls).toEqual([[ null ]]);
        });

        it('should keep the blacklist in force for a job that is still running when another one is done', async () => {
            // like Electron: one listener per event and session, the last one wins, `null` removes it
            const session = { active: null };
            session.webRequest = {
                onBeforeRequest: vi.fn((...args) => {
                    session.active = args[0] === null ? null : args;
                })
            };
            const detections = [ [ { redirection: 'automatic', detector: 'cloudflare-challenge' }, { redirection: 'none' } ], [ { redirection: 'none' } ] ];
            electron.BrowserWindow.mockImplementation(function() {
                const win = fakeWindow(detections.shift());
                win.webContents.session = session;
                created.push({ win });
                return win;
            });
            const blacklist = [ 'https://ads.test/*' ];
            const slow = manager._run({ ...JOB, blacklist });
            const quick = manager._run({ ...JOB, blacklist });
            await expect(quick).resolves.toBe('RESULT');
            // the slow job is still waiting for its check to finish
            expect(session.active).not.toBeNull();
            created[0].win.reload();
            await expect(slow).resolves.toBe('RESULT');
            expect(session.active).toBeNull();
        });

        it('should keep the blacklist in force for a job that is still running when one without a blacklist is done', async () => {
            const session = { active: null };
            session.webRequest = {
                onBeforeRequest: vi.fn((...args) => {
                    session.active = args[0] === null ? null : args;
                })
            };
            const detections = [ [ { redirection: 'automatic', detector: 'cloudflare-challenge' }, { redirection: 'none' } ], [ { redirection: 'none' } ] ];
            electron.BrowserWindow.mockImplementation(function() {
                const win = fakeWindow(detections.shift());
                win.webContents.session = session;
                created.push({ win });
                return win;
            });
            const slow = manager._run({ ...JOB, blacklist: [ 'https://ads.test/*' ] });
            await expect(manager._run({ ...JOB, blacklist: [] })).resolves.toBe('RESULT');
            expect(session.active).not.toBeNull();
            created[0].win.reload();
            await expect(slow).resolves.toBe('RESULT');
            expect(session.active).toBeNull();
        });

        it('should remove the preload file when the window cannot be made', async () => {
            electron.BrowserWindow.mockImplementation(function() {
                throw new Error('GPU process crashed');
            });
            const before = leftovers();
            try {
                await expect(manager._run({ ...JOB, preloadScript: 'x' })).rejects.toThrow('GPU process crashed');
                expect(leftovers()).toEqual(before);
            } finally {
                // the file that a failing test leaves is removed here
                for (const name of leftovers().filter(entry => !before.includes(entry))) {
                    fs.rmSync(path.join(os.tmpdir(), name), { force: true });
                }
            }
        });
    });
});