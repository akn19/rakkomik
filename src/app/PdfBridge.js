const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const electron = require('electron');

const PRINT_TIMEOUT = 120000;

/**
 * Prints a page of HTML to a PDF document, for the novels the renderer stores as portable documents. The page is
 * printed by Chromium itself: the text stays text (it can be selected and searched), long chapters are broken into
 * pages, and every writing system a font of the system covers is printed.
 *
 * The page comes from the renderer, so it is printed in a window that can do nothing but show it: no scripts, no
 * node, no network (only the page and `data:` URLs), no navigation and no new windows.
 */
module.exports = class PdfBridge {
    constructor(logger) {
        this._logger = logger;
    }

    register() {
        electron.ipcMain.handle('rakkomik:pdf:render', (event, html) => {
            return PdfBridge.render(html);
        });
    }

    /**
     * @param {string} html the page to print; its CSS sets the size and the margins of the paper (`@page`)
     * @param {number} [timeout] how long [ms] the printing may take
     * @returns {Promise<Uint8Array>} the PDF document
     */
    static async render(html, timeout = PRINT_TIMEOUT) {
        if (typeof html !== 'string' || html.length === 0) {
            throw new TypeError('The page to print must be a text!');
        }
        // the page is loaded from a private temp directory: the URL of a page is limited in size, a file is not
        let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rakkomik-pdf-'));
        let win = undefined;
        let timer = undefined;
        try {
            let file = path.join(directory, 'page.html');
            await fs.writeFile(file, html, 'utf8');
            win = new electron.BrowserWindow({
                show: false,
                webPreferences: {
                    // a session of its own that is not kept, apart from the one of the application
                    partition: 'rakkomik-pdf',
                    sandbox: true,
                    contextIsolation: true,
                    nodeIntegration: false,
                    javascript: false,
                    webSecurity: true,
                },
            });
            // the page is the only file that may be read: it is known by its path, as Chromium writes the URL of a file
            // with another escaping than Node.js does (`[`, `]` and `~` are not escaped), and paths are compared the way
            // the platform does it (the case of a path on Windows does not matter)
            const isPage = (url) => {
                try {
                    return path.relative(file, fileURLToPath(url)) === '';
                } catch {
                    return false;
                }
            };
            win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
                callback({ cancel: !details.url.startsWith('data:') && !isPage(details.url) });
            });
            win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
            win.webContents.on('will-navigate', (event) => event.preventDefault());

            let printed = (async () => {
                await win.loadFile(file);
                return win.webContents.printToPDF({
                    preferCSSPageSize: true,
                    printBackground: false,
                    generateTaggedPDF: true,
                    generateDocumentOutline: true,
                });
            })();
            // when the time is up, the window is gone before the printing ends: its failure is of no interest then
            printed.catch(() => undefined);
            let expired = new Promise((resolve, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new Error(
                                `Printing the page took longer than ${timeout / 1000} seconds!`,
                            ),
                        ),
                    timeout,
                );
            });
            return await Promise.race([printed, expired]);
        } finally {
            clearTimeout(timer);
            if (win && !win.isDestroyed()) {
                win.destroy();
            }
            // a directory that stays is no reason to throw the document away
            await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
        }
    }
};
