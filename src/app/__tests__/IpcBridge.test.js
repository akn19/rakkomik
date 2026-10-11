// Main side of the preload bridge: the channels the renderer may invoke and what each one does with its arguments.
const { mockModule } = require('./support/mockRequire');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const electron = mockModule('electron', () => ({
    ipcMain: { handle: vi.fn() },
    dialog: { showMessageBox: vi.fn(), showOpenDialog: vi.fn() },
    shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
    clipboard: { readText: vi.fn() },
    BrowserWindow: { fromWebContents: vi.fn() },
    session: {
        defaultSession: {
            cookies: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
            setProxy: vi.fn()
        }
    }
}));
const IpcBridge = require('../IpcBridge');

const CHANNELS = [
    'rakkomik:dialog:showMessageBox',
    'rakkomik:dialog:showOpenDialog',
    'rakkomik:shell:openExternal',
    'rakkomik:shell:showItemInFolder',
    'rakkomik:clipboard:readText',
    'rakkomik:window:minimize',
    'rakkomik:window:maximize',
    'rakkomik:window:unmaximize',
    'rakkomik:window:isMaximized',
    'rakkomik:window:close',
    'rakkomik:exec',
    'rakkomik:session:getCookies',
    'rakkomik:session:setCookie',
    'rakkomik:session:removeCookie',
    'rakkomik:session:setProxy'
];

// the event of ipcMain.handle: `sender` is the web contents of the calling renderer
const EVENT = { sender: { id: 7 } };

function handlers() {
    return Object.fromEntries(electron.ipcMain.handle.mock.calls);
}

// runs a small script in a child process of the application's own interpreter: the same on every system and shell
function nodeCommand(script) {
    return `"${process.execPath}" -e "${script}"`;
}

describe('IpcBridge', () => {
    let handler = null;

    beforeEach(() => {
        vi.resetAllMocks();
        new IpcBridge({ warn: vi.fn() }).register();
        handler = handlers();
    });

    it('should answer exactly the channels the preload bridge invokes', () => {
        expect(electron.ipcMain.handle).toHaveBeenCalledTimes(CHANNELS.length);
        expect(Object.keys(handler).sort()).toEqual([...CHANNELS].sort());
    });

    describe('dialogs', () => {
        it('should answer the index of the button that was pressed, as the confirm() and alert() shims expect', async () => {
            const options = { type: 'question', buttons: ['Cancel', 'OK'], message: 'Close?' };
            electron.dialog.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });
            await expect(handler['rakkomik:dialog:showMessageBox'](EVENT, options)).resolves.toBe(1);
            expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(options);
        });

        it('should answer button 0, which is falsy, as a number', async () => {
            electron.dialog.showMessageBox.mockResolvedValue({ response: 0 });
            await expect(handler['rakkomik:dialog:showMessageBox'](EVENT, {})).resolves.toBe(0);
        });

        it('should fail when the dialog cannot be shown', async () => {
            electron.dialog.showMessageBox.mockRejectedValue(new Error('no display'));
            await expect(handler['rakkomik:dialog:showMessageBox'](EVENT, {})).rejects.toThrow('no display');
        });

        it('should hand the options to the open dialog and answer what the user chose', async () => {
            const options = { properties: ['openDirectory'] };
            const chosen = { canceled: false, filePaths: [os.tmpdir()] };
            electron.dialog.showOpenDialog.mockResolvedValue(chosen);
            await expect(handler['rakkomik:dialog:showOpenDialog'](EVENT, options)).resolves.toBe(chosen);
            expect(electron.dialog.showOpenDialog).toHaveBeenCalledWith(options);
        });

        it('should answer a cancelled open dialog as it is', async () => {
            electron.dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
            await expect(handler['rakkomik:dialog:showOpenDialog'](EVENT, {})).resolves.toEqual({ canceled: true, filePaths: [] });
        });
    });

    describe('shell', () => {
        it.each([
            'https://example.org/manga/1?page=2#top',
            'http://127.0.0.1:8080/',
            'https://example.org/ünïcode/%E3%83%9E'
        ])('should open %s outside of the application', async url => {
            electron.shell.openExternal.mockResolvedValue(undefined);
            await handler['rakkomik:shell:openExternal'](EVENT, url);
            expect(electron.shell.openExternal).toHaveBeenCalledTimes(1);
            expect(electron.shell.openExternal).toHaveBeenCalledWith(url);
        });

        it('should fail when the system cannot open the URL', async () => {
            electron.shell.openExternal.mockRejectedValue(new Error('Failed to open'));
            await expect(handler['rakkomik:shell:openExternal'](EVENT, 'https://example.org/')).rejects.toThrow('Failed to open');
        });

        // NOTE: there is no check on the scheme: whatever the renderer passes is handed to the operating system, which
        // opens `file:`, `smb:` and every protocol handler of the machine. Harmless only while the renderer is trusted
        // (it can `exec` anyway), a hardening gap otherwise. Characterisation, not an endorsement.
        it.each([
            'file:///etc/passwd',
            'smb://server/share',
            'javascript:alert(1)',
            'ms-msdt:/id PCWDiagnostic'
        ])('should hand %s to the system unchanged', async url => {
            await handler['rakkomik:shell:openExternal'](EVENT, url);
            expect(electron.shell.openExternal).toHaveBeenCalledWith(url);
        });

        it('should show a file in its folder and answer nothing', async () => {
            electron.shell.showItemInFolder.mockReturnValue('ignored');
            const file = path.join(os.tmpdir(), 'Chapter 1.cbz');
            // ipcMain.handle accepts a plain value as well as a promise
            expect(await handler['rakkomik:shell:showItemInFolder'](EVENT, file)).toBeUndefined();
            expect(electron.shell.showItemInFolder).toHaveBeenCalledWith(file);
        });
    });

    describe('clipboard', () => {
        it('should answer the text on the clipboard', async () => {
            electron.clipboard.readText.mockReturnValue('https://example.org/copied');
            expect(await handler['rakkomik:clipboard:readText'](EVENT)).toBe('https://example.org/copied');
        });

        it('should answer an empty clipboard with an empty text', async () => {
            electron.clipboard.readText.mockReturnValue('');
            expect(await handler['rakkomik:clipboard:readText'](EVENT)).toBe('');
        });
    });

    describe('window', () => {
        let window = null;

        beforeEach(() => {
            window = {
                minimize: vi.fn(),
                maximize: vi.fn(),
                unmaximize: vi.fn(),
                isMaximized: vi.fn(() => true),
                close: vi.fn()
            };
            electron.BrowserWindow.fromWebContents.mockReturnValue(window);
        });

        it.each([
            ['minimize', 'minimize'],
            ['maximize', 'maximize'],
            ['unmaximize', 'unmaximize'],
            ['close', 'close']
        ])('should %s the window of the renderer that asked, and nothing else', (channel, method) => {
            expect(handler[`rakkomik:window:${channel}`](EVENT)).toBeUndefined();
            expect(electron.BrowserWindow.fromWebContents).toHaveBeenCalledWith(EVENT.sender);
            expect(window[method]).toHaveBeenCalledTimes(1);
            for (const other of Object.keys(window).filter(name => name !== method && name !== 'isMaximized')) {
                expect(window[other]).not.toHaveBeenCalled();
            }
        });

        it.each([true, false])('should answer whether the window is maximized (%s)', maximized => {
            window.isMaximized.mockReturnValue(maximized);
            expect(handler['rakkomik:window:isMaximized'](EVENT)).toBe(maximized);
        });

        it.each([
            'minimize',
            'maximize',
            'unmaximize',
            'isMaximized',
            'close'
        ])('should fail the %s call (not stop the application) when the sender has no window', channel => {
            electron.BrowserWindow.fromWebContents.mockReturnValue(null);
            expect(() => handler[`rakkomik:window:${channel}`](EVENT)).toThrow(TypeError);
        });
    });

    describe('exec', () => {
        it('should answer the output of a command that succeeds', async () => {
            const result = await handler['rakkomik:exec'](EVENT, nodeCommand("process.stdout.write('out'); process.stderr.write('err')"), {});
            expect(result).toEqual({ error: undefined, stdout: 'out', stderr: 'err' });
            expect(result.error).toBeUndefined();
        });

        it('should answer the failure instead of rejecting when a command fails, with the output it had', async () => {
            const result = await handler['rakkomik:exec'](EVENT, nodeCommand("process.stdout.write('partial'); process.stderr.write('broken'); process.exit(3)"), {});
            expect(result.error).toContain('Command failed');
            expect(result.stdout).toBe('partial');
            expect(result.stderr).toBe('broken');
        });

        it('should answer the failure when the command does not exist', async () => {
            const result = await handler['rakkomik:exec'](EVENT, 'rakkomik-no-such-command-8f3a', {});
            expect(typeof result.error).toBe('string');
            expect(result.error.length).toBeGreaterThan(0);
        });

        it('should run the command in the directory and with the environment of the options', async () => {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-exec-'));
            try {
                const command = nodeCommand('process.stdout.write(process.cwd() + String.fromCharCode(10) + process.env.RK_EXEC_TEST)');
                const result = await handler['rakkomik:exec'](EVENT, command, { cwd: directory, env: { ...process.env, RK_EXEC_TEST: 'from options' } });
                expect(result.error).toBeUndefined();
                const [cwd, variable] = result.stdout.split(/\r?\n/);
                expect(fs.realpathSync.native(cwd)).toBe(fs.realpathSync.native(directory));
                expect(variable).toBe('from options');
            } finally {
                fs.rmSync(directory, { recursive: true, force: true });
            }
        });

        it('should honour the limits of the options and answer a command that exceeds them as failed', async () => {
            const result = await handler['rakkomik:exec'](EVENT, nodeCommand("process.stdout.write('x'.repeat(100))"), { maxBuffer: 10 });
            expect(result.error).toMatch(/maxBuffer/);
        });

        it('should accept a call without options', async () => {
            const result = await handler['rakkomik:exec'](EVENT, nodeCommand("process.stdout.write('plain')"));
            expect(result).toEqual({ error: undefined, stdout: 'plain', stderr: '' });
        });
    });

    describe('session', () => {
        const cookies = () => electron.session.defaultSession.cookies;

        it('should look cookies up with the filter of the renderer', async () => {
            const found = [{ name: 'cf_clearance', value: 'x', domain: 'example.org' }];
            cookies().get.mockResolvedValue(found);
            await expect(handler['rakkomik:session:getCookies'](EVENT, { url: 'https://example.org/' })).resolves.toBe(found);
            expect(cookies().get).toHaveBeenCalledWith({ url: 'https://example.org/' });
        });

        it('should set a cookie as it is described', async () => {
            const details = { url: 'https://example.org/', name: 'a', value: '1', secure: true };
            cookies().set.mockResolvedValue(undefined);
            await handler['rakkomik:session:setCookie'](EVENT, details);
            expect(cookies().set).toHaveBeenCalledWith(details);
        });

        it('should remove a cookie by URL and name', async () => {
            cookies().remove.mockResolvedValue(undefined);
            await handler['rakkomik:session:removeCookie'](EVENT, 'https://example.org/', 'mhub_access');
            expect(cookies().remove).toHaveBeenCalledWith('https://example.org/', 'mhub_access');
        });

        it('should hand the proxy configuration to the session', async () => {
            const config = { mode: 'fixed_servers', proxyRules: 'http=proxy.test:8080' };
            electron.session.defaultSession.setProxy.mockResolvedValue(undefined);
            await handler['rakkomik:session:setProxy'](EVENT, config);
            expect(electron.session.defaultSession.setProxy).toHaveBeenCalledWith(config);
        });

        it.each([
            ['getCookies', 'get'],
            ['setCookie', 'set']
        ])('should fail %s when the session refuses', async (channel, method) => {
            cookies()[method].mockRejectedValue(new Error('Failed to parse cookie'));
            await expect(handler[`rakkomik:session:${channel}`](EVENT, {})).rejects.toThrow('Failed to parse cookie');
        });
    });
});
