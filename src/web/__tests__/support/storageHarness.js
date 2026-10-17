// Fixtures for the tests of the storage and of the sources that read from it: the file system bridge of the preload on
// the real file system (a temp directory per test), the globals the engine reads (`window.hakuneko`, `Engine`), and
// helpers to look into the archives that the storage writes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * `window.hakuneko.fs` on the real file system: the same methods with the same answers as src/app/FsBridge.js
 * (`mkdir` is recursive, `readFile` answers bytes or text, `stat` answers plain flags).
 */
function realBridge() {
    return {
        mkdir: (target) => fs.promises.mkdir(target, { recursive: true }).then(() => undefined),
        writeFile: (target, data, encoding) =>
            fs.promises
                .writeFile(target, typeof data === 'string' ? data : Buffer.from(data), encoding)
                .then(() => undefined),
        rename: (from, to) => fs.promises.rename(from, to).then(() => undefined),
        unlink: (target) => fs.promises.unlink(target).then(() => undefined),
        readFile: (target, encoding) =>
            fs.promises
                .readFile(target, encoding || undefined)
                .then((data) => (typeof data === 'string' ? data : new Uint8Array(data))),
        stat: (target) =>
            fs.promises.stat(target).then((stats) => ({
                isDirectory: stats.isDirectory(),
                isFile: stats.isFile(),
                size: stats.size,
            })),
        readdir: (target) => fs.promises.readdir(target),
        access: (target) =>
            fs.promises
                .access(target, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK)
                .then(() => undefined),
    };
}

// counts the operations that are under way, so that a test can wait until the storage is quiet
function counted(bridge, counter) {
    return Object.fromEntries(
        Object.entries(bridge).map(([name, method]) => [
            name,
            (...args) => {
                counter.active++;
                const done = () => {
                    counter.active--;
                };
                let result;
                try {
                    result = method(...args);
                } catch (error) {
                    done();
                    throw error;
                }
                result.then(done, done);
                return result;
            },
        ]),
    );
}

/**
 * Sets up the globals of the engine around a Storage that works in a temp directory and returns what a test needs.
 * @param {Function} Storage the class under test
 * @param {object} [options]
 * @param {string} [options.platform] what the engine believes to run on; the real platform when real files are used
 * @param {object} [options.fs] replaces `window.hakuneko.fs`
 * @param {object} [options.settings] values of `Engine.Settings` by name, e.g. `{ chapterFormat: '.cbz' }`
 * @param {object} [options.env] `window.hakuneko.env`, the environment of the application
 */
function createEnvironment(Storage, options = {}) {
    // macOS keeps os.tmpdir() behind a symbolic link, Windows hands out short names
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rk-storage-')));
    const userData = path.join(root, 'userdata');
    fs.mkdirSync(userData);
    const counter = { active: 0 };
    const hakuneko = {
        platform: options.platform || process.platform,
        dialog: { showOpenDialog: vi.fn() },
        shell: { showItemInFolder: vi.fn() },
        fs: counted(options.fs || realBridge(), counter),
        pdf: { render: vi.fn(async (html) => new TextEncoder().encode(`%PDF-1.7 ${html.length}`)) },
        exec: vi.fn(async () => ({})),
        env: options.env || {},
        app: { getPath: (name) => (name === 'userData' ? userData : root) },
        os: { tmpdir: path.join(root, 'tmp') },
    };
    globalThis.window = { hakuneko };
    const settings = {
        baseDirectory: path.join(root, 'mangas'),
        bookmarkDirectory: path.join(root, 'bookmarks'),
        useSubdirectory: false,
        chapterFormat: 'img',
        novelFormat: '.epub',
        postChapterDownloadCommand: '',
        ...options.settings,
    };
    const storage = new Storage();
    globalThis.Engine = {
        Storage: storage,
        Settings: Object.fromEntries(
            Object.entries(settings).map(([name, value]) => [name, { value }]),
        ),
        ComicInfoGenerator: new (
            options.ComicInfoGenerator ||
            class {
                createComicInfoXML(series, title, count) {
                    return `<ComicInfo series="${series}" title="${title}" pages="${count}"/>`;
                }
            }
        )(),
    };
    return {
        root,
        userData,
        storage,
        hakuneko,
        settings: globalThis.Engine.Settings,
        /** the directory a test may fill with files: the base directory of the mangas */
        mangas: settings.baseDirectory,
        /** settles when no operation of the bridge is under way any more, e.g. after a save was refused while others ran on */
        async idle() {
            do {
                await new Promise((resolve) => setImmediate(resolve));
            } while (counter.active > 0);
        },
        dispose() {
            delete globalThis.window;
            delete globalThis.Engine;
            fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
        },
    };
}

/**
 * @param {string} type media type of the page
 * @param {number[]} bytes content of the page
 */
function page(type, bytes = [1, 2, 3]) {
    return new Blob([new Uint8Array(bytes)], { type });
}

/**
 * The entries of a ZIP archive in the order of its central directory, read from the container itself, so that a test
 * can tell how the archive was written (`method` 0 is stored, 8 is deflated).
 * @param {Uint8Array} bytes
 * @returns {Array<{ name: string, method: number }>}
 */
function zipEntries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entries = [];
    let offset = view.getUint32(bytes.length - 22 + 16, true);
    for (let count = view.getUint16(bytes.length - 22 + 10, true); count > 0; count--) {
        const nameLength = view.getUint16(offset + 28, true);
        entries.push({
            name: new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
            method: view.getUint16(offset + 10, true),
        });
        offset +=
            46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    }
    return entries;
}

/**
 * @param {string} root a directory
 * @returns {string[]} the paths below the directory, relative to it and with `/` as separator, sorted
 */
function listFiles(root) {
    const found = [];
    const walk = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else {
                found.push(path.relative(root, full).split(path.sep).join('/'));
            }
        }
    };
    walk(root);
    return found.sort();
}

module.exports = { createEnvironment, page, zipEntries, listFiles };
