// Printing a novel chapter to a PDF document: the page is printed by Chromium in a window that can do nothing but show
// it, the window and the temp files are gone afterwards, and the printing cannot hang.
const { mockModule } = require('./support/mockRequire');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const electron = mockModule('electron', () => ({
    ipcMain: {
        handle: vi.fn(),
        on: vi.fn()
    },
    BrowserWindow: vi.fn()
}));
const PdfBridge = require('../PdfBridge');

const PAGE = '<!DOCTYPE html><html><head><title>Chapter</title></head><body><p>Text</p></body></html>';

function leftoverTempDirectories() {
    return fs.readdirSync(os.tmpdir()).filter(entry => entry.startsWith('rakkomik-pdf-'));
}

// a window that loads whatever it is given and prints `pdf`
function fakeWindow({ load, print } = {}) {
    const win = {
        destroyed: false,
        loaded: undefined,
        webContents: {
            session: { webRequest: { onBeforeRequest: vi.fn() } },
            setWindowOpenHandler: vi.fn(),
            on: vi.fn(),
            printToPDF: vi.fn(print || (async () => Buffer.from('%PDF-1.7 fake')))
        },
        loadFile: vi.fn(async file => {
            win.loaded = fs.readFileSync(file, 'utf8');
            if (load) {
                await load(file);
            }
        }),
        isDestroyed: () => win.destroyed,
        destroy: vi.fn(() => {
            win.destroyed = true;
        })
    };
    electron.BrowserWindow.mockImplementation(function() {
        return win;
    });
    return win;
}

describe('PdfBridge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should be called by the renderer on one channel', async () => {
        const win = fakeWindow();
        new PdfBridge({ warn: vi.fn() }).register();
        expect(electron.ipcMain.handle).toHaveBeenCalledTimes(1);
        const [channel, handler] = electron.ipcMain.handle.mock.calls[0];
        expect(channel).toBe('rakkomik:pdf:render');
        expect(electron.ipcMain.on).not.toHaveBeenCalled();
        await expect(handler({}, PAGE)).resolves.toEqual(Buffer.from('%PDF-1.7 fake'));
        expect(win.loaded).toBe(PAGE);
    });

    it('should print the page and give back the document', async () => {
        const win = fakeWindow();
        const pdf = await PdfBridge.render(PAGE);
        expect(Buffer.from(pdf).toString()).toBe('%PDF-1.7 fake');
        // the page was in a file while it was loaded, in a directory of its own
        expect(win.loaded).toBe(PAGE);
        expect(win.loadFile).toHaveBeenCalledTimes(1);
        expect(path.basename(win.loadFile.mock.calls[0][0])).toBe('page.html');
        expect(path.dirname(win.loadFile.mock.calls[0][0]).startsWith(path.join(os.tmpdir(), 'rakkomik-pdf-'))).toBe(true);
    });

    it('should print the way the page says: its own paper size, a document outline and tagged text', async () => {
        const win = fakeWindow();
        await PdfBridge.render(PAGE);
        expect(win.webContents.printToPDF).toHaveBeenCalledWith({
            preferCSSPageSize: true,
            printBackground: false,
            generateTaggedPDF: true,
            generateDocumentOutline: true
        });
    });

    it('should do nothing in a window but show the page', async () => {
        const win = fakeWindow();
        await PdfBridge.render(PAGE);
        expect(electron.BrowserWindow).toHaveBeenCalledTimes(1);
        expect(electron.BrowserWindow.mock.calls[0][0]).toEqual({
            show: false,
            webPreferences: {
                partition: 'rakkomik-pdf',
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
                javascript: false,
                webSecurity: true
            }
        });
        // no window of its own, no navigation
        expect(win.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
        const [event, listener] = win.webContents.on.mock.calls[0];
        expect(event).toBe('will-navigate');
        const navigation = { preventDefault: vi.fn() };
        listener(navigation);
        expect(navigation.preventDefault).toHaveBeenCalled();
    });

    it('should block every request that is neither the page nor a data URL', async () => {
        const win = fakeWindow();
        await PdfBridge.render(PAGE);
        const filter = win.webContents.session.webRequest.onBeforeRequest.mock.calls[0][0];
        const cancelled = url => {
            const callback = vi.fn();
            filter({ url }, callback);
            return callback.mock.calls[0][0].cancel;
        };
        expect(cancelled('file:///tmp/rakkomik-pdf-x/page.html')).toBe(false);
        expect(cancelled('data:image/png;base64,AAAA')).toBe(false);
        expect(cancelled('https://tracker.example/pixel.gif')).toBe(true);
        expect(cancelled('http://127.0.0.1:8080/')).toBe(true);
        expect(cancelled('ftp://x.example/y')).toBe(true);
    });

    it('should close the window and remove the page afterwards', async () => {
        const before = leftoverTempDirectories();
        const win = fakeWindow();
        await PdfBridge.render(PAGE);
        expect(win.destroy).toHaveBeenCalledTimes(1);
        expect(leftoverTempDirectories()).toEqual(before);
    });

    it('should close the window and remove the page when the page does not load', async () => {
        const before = leftoverTempDirectories();
        const win = fakeWindow({ load: async () => {
            throw new Error('ERR_FILE_NOT_FOUND');
        } });
        await expect(PdfBridge.render(PAGE)).rejects.toThrow('ERR_FILE_NOT_FOUND');
        expect(win.webContents.printToPDF).not.toHaveBeenCalled();
        expect(win.destroy).toHaveBeenCalledTimes(1);
        expect(leftoverTempDirectories()).toEqual(before);
    });

    it('should close the window and remove the page when printing fails', async () => {
        const before = leftoverTempDirectories();
        const win = fakeWindow({ print: async () => {
            throw new Error('Failed to print');
        } });
        await expect(PdfBridge.render(PAGE)).rejects.toThrow('Failed to print');
        expect(win.destroy).toHaveBeenCalledTimes(1);
        expect(leftoverTempDirectories()).toEqual(before);
    });

    it('should not destroy a window twice', async () => {
        const win = fakeWindow();
        win.destroyed = true;
        await PdfBridge.render(PAGE);
        expect(win.destroy).not.toHaveBeenCalled();
    });

    it('should give up when the printing never ends', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const before = leftoverTempDirectories();
        const win = fakeWindow({ print: () => new Promise(() => undefined) });
        const result = expect(PdfBridge.render(PAGE, 5000)).rejects.toThrow('Printing the page took longer than 5 seconds!');
        // the page is written to the disk first: let the real file system answer
        await vi.waitFor(() => expect(win.webContents.printToPDF).toHaveBeenCalled());
        await vi.advanceTimersByTimeAsync(5000);
        await result;
        expect(win.destroy).toHaveBeenCalledTimes(1);
        expect(leftoverTempDirectories()).toEqual(before);
    });

    it('should not fail later when a printing that was given up on fails', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        let fail = null;
        const win = fakeWindow({ print: () => new Promise((resolve, reject) => {
            fail = reject;
        }) });
        const result = expect(PdfBridge.render(PAGE, 1000)).rejects.toThrow('longer than 1 seconds');
        await vi.waitFor(() => expect(win.webContents.printToPDF).toHaveBeenCalled());
        await vi.advanceTimersByTimeAsync(1000);
        await result;
        fail(new Error('Window was destroyed'));
        await new Promise(resolve => setImmediate(resolve));
    });

    it('should refuse what is no page', async () => {
        const before = leftoverTempDirectories();
        fakeWindow();
        for (const page of [undefined, null, 12, {}, '', new Uint8Array([60])]) {
            await expect(PdfBridge.render(page)).rejects.toThrow(TypeError);
        }
        expect(electron.BrowserWindow).not.toHaveBeenCalled();
        expect(leftoverTempDirectories()).toEqual(before);
    });

    it('should print a page that is too large for a URL', async () => {
        const win = fakeWindow();
        const large = PAGE.replace('<p>Text</p>', `<p><img src="data:image/png;base64,${'A'.repeat(5 * 1024 * 1024)}"/></p>`);
        await PdfBridge.render(large);
        expect(win.loaded).toBe(large);
    });
});
