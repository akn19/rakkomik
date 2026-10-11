// Storage without a file system: the atomic write (it publishes with a temp file and a rename, never with a direct write
// to the target), the commands after a download and the dialog against a recording stand-in for the bridge, and the names,
// paths and addresses that it computes for each platform. The tests on real files are in StorageFiles.test.js.
const os = require('node:os');

let Storage = null;

function fakeHakuneko(fs) {
    globalThis.window = {
        hakuneko: {
            dialog: {},
            platform: 'linux',
            shell: {},
            fs,
            app: { getPath: () => '/tmp/rakkomik-test-userdata' },
            os: { tmpdir: os.tmpdir() }
        }
    };
}

beforeAll(async () => {
    Storage = (await import('../mjs/engine/Storage.mjs')).default;
});

afterEach(() => {
    delete globalThis.window;
});

function recordingFs(behavior) {
    const calls = [];
    return {
        calls,
        mkdir: vi.fn(p => {
            calls.push(['mkdir', p]);
            return Promise.resolve();
        }),
        writeFile: vi.fn((p, data) => {
            calls.push(['writeFile', p]);
            return behavior && behavior.writeFile ? behavior.writeFile(p, data) : Promise.resolve();
        }),
        rename: vi.fn((from, to) => {
            calls.push(['rename', from, to]);
            return behavior && behavior.rename ? behavior.rename(from, to) : Promise.resolve();
        }),
        unlink: vi.fn(p => {
            calls.push(['unlink', p]);
            return Promise.resolve();
        })
    };
}

function storageWith(fs) {
    fakeHakuneko(fs);
    const storage = new Storage();
    storage.config = '/cfg/hakuneko.';
    Object.defineProperty(storage, '_bookmarkOutputPath', { get: () => '/bm/hakuneko.' });
    return storage;
}

describe('Storage atomic writes', () => {
    it('should save configs via temp file plus rename', async () => {
        const fs = recordingFs();
        const storage = storageWith(fs);
        await storage.saveConfig('settings', { a: 1 }, 2);
        expect(fs.writeFile).toHaveBeenCalledTimes(1);
        const temp = fs.writeFile.mock.calls[0][0];
        expect(temp.startsWith('/cfg/hakuneko.settings.tmp-')).toBe(true);
        expect(fs.rename).toHaveBeenCalledTimes(1);
        expect(fs.rename.mock.calls[0]).toEqual([temp, '/cfg/hakuneko.settings']);
        // the target itself is never written directly
        expect(fs.calls.some(call => call[0] === 'writeFile' && call[1] === '/cfg/hakuneko.settings')).toBe(false);
    });

    it('should save bookmarks via temp file plus rename', async () => {
        const fs = recordingFs();
        const storage = storageWith(fs);
        await storage.saveBookmarks('bookmarks', [], 2);
        const temp = fs.writeFile.mock.calls[0][0];
        expect(temp.startsWith('/bm/hakuneko.bookmarks.tmp-')).toBe(true);
        expect(fs.rename.mock.calls[0]).toEqual([temp, '/bm/hakuneko.bookmarks']);
    });

    it('should clean the temp file up when rename fails', async () => {
        const fs = recordingFs({ rename: () => Promise.reject(new Error('EXDEV')) });
        const storage = storageWith(fs);
        await expect(storage.saveConfig('settings', {}, 2)).rejects.toThrow('EXDEV');
        const temp = fs.writeFile.mock.calls[0][0];
        expect(fs.unlink).toHaveBeenCalledWith(temp);
    });

    it('should clean the temp file up when the write fails', async () => {
        const fs = recordingFs({ writeFile: () => Promise.reject(new Error('ENOSPC')) });
        const storage = storageWith(fs);
        await expect(storage.saveConfig('settings', {}, 2)).rejects.toThrow('ENOSPC');
        expect(fs.rename).not.toHaveBeenCalled();
    });

    it('should write downloads atomically and resolve with the path', async () => {
        const fs = recordingFs();
        const storage = storageWith(fs);
        await expect(storage._writeFile('/dl/page.jpg', new Uint8Array([1]))).resolves.toBe('/dl/page.jpg');
        expect(fs.rename).toHaveBeenCalledTimes(1);
    });
});

describe('Storage temp files', () => {
    it('should create the temp directory before writing a temp file', async () => {
        const fs = recordingFs();
        const storage = storageWith(fs);
        await storage.saveTempFile('page 1.png', new Uint8Array([ 1 ]));
        // the directory first, then the atomic write (temp file + rename onto the target)
        expect(fs.calls.map(call => call[0])).toEqual([ 'mkdir', 'writeFile', 'rename' ]);
        expect(fs.calls[0][1]).toBe(storage.temp);
        expect(fs.calls[2][2]).toBe(`${storage.temp}/page 1.png`);
    });

    it('should compute its paths in the renderer', () => {
        const storage = storageWith(recordingFs());
        expect(storage.path.sep).toBe('/');
        expect(storage.temp).toBe(`${os.tmpdir()}/hakuneko`);
        expect(storage.config).toBe('/cfg/hakuneko.');
    });
});

// The paths, names and URLs are computed in the renderer for the platform that the main process reports, so the three
// flavours can be tried on any machine: no file is touched in these tests.
function simulatedStorage(platform, settings = {}, fs = recordingFs()) {
    const roots = {
        linux: { userData: '/home/me/.config/RakKomik', tmpdir: '/tmp', base: '/dl', bookmarks: '/bm' },
        darwin: { userData: '/Users/me/Library/Application Support/RakKomik', tmpdir: '/var/folders/x/T', base: '/Users/me/Mangas', bookmarks: '/Users/me/Bookmarks' },
        win32: { userData: 'C:\\Users\\me\\AppData\\Roaming\\RakKomik', tmpdir: 'C:\\Users\\me\\AppData\\Local\\Temp', base: 'C:\\Mangas', bookmarks: 'C:\\Bookmarks' }
    }[platform];
    globalThis.window = {
        hakuneko: {
            dialog: { showOpenDialog: vi.fn() },
            platform,
            shell: { showItemInFolder: vi.fn() },
            fs,
            app: { getPath: () => roots.userData },
            os: { tmpdir: roots.tmpdir },
            exec: vi.fn(async () => ({}))
        }
    };
    const values = {
        baseDirectory: roots.base,
        bookmarkDirectory: roots.bookmarks,
        useSubdirectory: false,
        chapterFormat: 'img',
        novelFormat: '.epub',
        postChapterDownloadCommand: '',
        ...settings
    };
    globalThis.Engine = {
        Settings: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value }])),
        ComicInfoGenerator: { createComicInfoXML: (series, title, count) => `<ComicInfo ${series}|${title}|${count}/>` }
    };
    return new Storage();
}

function plainChapter(title = 'Chapter 1', mangaTitle = 'My Manga', status = 'available', connector = { label: 'Site', id: 'site' }) {
    return { title, status, manga: { title: mangaTitle, connector } };
}

afterEach(() => {
    delete globalThis.Engine;
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('Storage file names', () => {
    // [ platform, title, name of the file or folder ]
    const TITLES = [
        // what no platform allows in a name, or what makes the name end badly
        ['linux', 'Chapter 1', 'Chapter 1'],
        ['linux', 'Vol. 1...', 'Vol. 1'],
        ['linux', 'Title \t ', 'Title'],
        ['linux', '  Title', 'Title'],
        ['linux', 'tab\there\nnew\u0000line\u007Fdel\u0085c1\u009F', 'tabherenewlinedelc1'],
        ['linux', 'no break space\u00A0', 'no break space'],
        ['linux', '.hidden', '.hidden'],
        ['linux', 'a.b.c', 'a.b.c'],
        ['linux', '日本語 マンガ', '日本語 マンガ'],
        ['linux', '😀 smile.', '😀 smile'],
        // nothing is left: a placeholder, or the name would be the folder that it is put in
        ['linux', '...', '_'],
        ['linux', ' . . ', '_'],
        ['linux', '', '_'],
        // a slash is the only character that Linux keeps out of a name
        ['linux', 'Fate/Zero', 'FateZero'],
        ['linux', 'AC\\DC', 'AC\\DC'],
        ['linux', 'Who? "Me": <you> | *', 'Who? "Me": <you> | *'],
        // macOS: the slash and the colon
        ['darwin', 'Re:Zero/Season 2', 'ReZeroSeason 2'],
        ['darwin', 'Who? "Me" <you> | *', 'Who? "Me" <you> | *'],
        ['darwin', 'AC\\DC', 'AC\\DC'],
        // Windows: \ / : * ? " < > |
        ['win32', 'Re:Zero/Season\\2', 'ReZeroSeason2'],
        ['win32', 'Who? "Me" <you> | * :', 'Who Me you'],
        ['win32', 'Chapter 1: A & B', 'Chapter 1 A & B'],
        ['win32', 'Vol. 1.', 'Vol. 1'],
        ['win32', '日本語:マンガ', '日本語マンガ']
    ];

    it.each(TITLES)('should turn the title of a %s file into a name it can have: %j -> %j', (platform, title, name) => {
        expect(simulatedStorage(platform).sanatizePath(title)).toBe(name);
    });

    it('should remove what the platform of the main process cannot have, not what the machine it runs on cannot have', () => {
        expect(simulatedStorage('win32').sanatizePath('a:b')).toBe('ab');
        expect(simulatedStorage('linux').sanatizePath('a:b')).toBe('a:b');
    });

    it('should never hand out a name that can leave the folder it is put in', () => {
        for (const [platform, separators] of [['linux', /\//], ['darwin', /[/:]/], ['win32', /[/\\:]/]]) {
            const storage = simulatedStorage(platform);
            for (const title of ['..', '../..', '../../etc/passwd', '..\\..\\x', '/etc/passwd', 'C:\\Windows', '.. / ..', './x', '\u0000..']) {
                const name = storage.sanatizePath(title);
                // where a name is cut into the folders that it names, none of them is the one above
                expect(name.split(separators)).not.toContain('..');
                expect(name).not.toBe('.');
                expect(name).not.toMatch(/^[/\\]/);
            }
        }
    });

    it('should not name a file after a device of Windows', () => {
        const storage = simulatedStorage('win32');
        for (const title of ['CON', 'con', 'Prn', 'AUX', 'NUL', 'COM1', 'lpt9', 'NUL.txt']) {
            expect(storage.sanatizePath(title)).not.toMatch(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i);
        }
    });
});

describe('Storage names of pages', () => {
    it.each([
        [1, 'image/jpeg', 1, '1.jpg'],
        [7, 'image/png', 3, '007.png'],
        [12, 'image/webp', 2, '12.webp'],
        [3, 'image/gif', 1, '3.gif'],
        [3, 'image/bmp', 1, '3.bmp'],
        [3, 'image/jpeg; charset=binary', 1, '3.jpg'],
        // the number is never cut to the width
        [100, 'image/png', 2, '100.png'],
        // other images, and everything else
        [3, 'image/avif', 1, '3.img'],
        [3, 'image/svg+xml', 1, '3.img'],
        [3, 'image/jpg', 1, '3.img'],
        [3, 'application/octet-stream', 1, '3.bin'],
        [3, '', 1, '3.bin']
    ])('should name page %i of type "%s" (width %i) %s', (number, type, width, name) => {
        expect(simulatedStorage('linux')._pageFileName(number, type, width)).toBe(name);
    });

    it.each([
        ['1.webp', 'image/webp'],
        ['1.jpeg', 'image/jpeg'],
        ['1.jpg', 'image/jpeg'],
        ['1.png', 'image/png'],
        ['1.gif', 'image/gif'],
        ['1.bmp', 'image/bmp'],
        ['1.img', 'image/'],
        ['1.bin', 'application/octet-stream'],
        ['1', 'application/octet-stream'],
        ['archive.tar.gz', 'application/octet-stream']
    ])('should tell the type of %s: %s', (file, type) => {
        expect(simulatedStorage('linux')._pageFileMime(file)).toBe(type);
    });

    it.each([
        ['image/jpeg', 'JPEG'],
        ['image/png', 'PNG'],
        ['image/webp', undefined],
        ['image/gif', undefined],
        ['', undefined]
    ])('should tell the type of an image of %j for a document: %s', (type, kind) => {
        expect(simulatedStorage('linux')._pdfImageType({ type })).toBe(kind);
    });
});

describe('Storage output paths', () => {
    it.each([
        // [ platform, settings, manga title, chapter title, status, expected path parts after the base directory ]
        ['linux', {}, 'My Manga', 'Chapter 1', 'available', ['/dl', 'My Manga', 'Chapter 1']],
        ['linux', { chapterFormat: '.cbz' }, 'My Manga', 'Chapter 1', 'available', ['/dl', 'My Manga', 'Chapter 1.cbz']],
        ['linux', { chapterFormat: '.epub' }, 'My Manga', 'Chapter 1', 'completed', ['/dl', 'My Manga', 'Chapter 1.epub']],
        // a chapter that is only on the device is the file that is there
        ['linux', { chapterFormat: '.cbz' }, 'My Manga', 'Chapter 1.cbz', 'offline', ['/dl', 'My Manga', 'Chapter 1.cbz']],
        ['linux', { chapterFormat: '.cbz' }, 'My Manga', 'Chapter 1', 'offline', ['/dl', 'My Manga', 'Chapter 1']],
        ['linux', { chapterFormat: '.cbz' }, 'Fate/Zero', 'Chapter 1/2', 'available', ['/dl', 'FateZero', 'Chapter 12.cbz']],
        ['darwin', { chapterFormat: '.cbz' }, 'Re:Zero', 'Chapter 1: Start', 'available', ['/Users/me/Mangas', 'ReZero', 'Chapter 1 Start.cbz']],
        ['win32', {}, 'Re:Zero', 'Chapter 1: Start?', 'available', ['C:\\Mangas', 'ReZero', 'Chapter 1 Start']],
        ['win32', { chapterFormat: '.cbz' }, 'My Manga.', 'Chapter 1.', 'available', ['C:\\Mangas', 'My Manga', 'Chapter 1.cbz']]
    ])('should store a chapter of %s with %j as %s / %s (%s)', (platform, settings, mangaTitle, chapterTitle, status, expected) => {
        const storage = simulatedStorage(platform, settings);
        const separator = platform === 'win32' ? '\\' : '/';
        expect(storage._chapterOutputPath(plainChapter(chapterTitle, mangaTitle, status))).toBe(expected.join(separator));
    });

    it('should keep a chapter whose title is nothing once it is cleaned below the folder of its manga', () => {
        for (const format of ['img', '.cbz']) {
            const storage = simulatedStorage('win32', { chapterFormat: format });
            const output = storage._chapterOutputPath(plainChapter('???', 'My Manga'));
            expect(output.startsWith('C:\\Mangas\\My Manga\\')).toBe(true);
        }
    });

    it('should put the mangas of a website into a folder of its own when the user wants it', () => {
        const storage = simulatedStorage('linux', { useSubdirectory: true });
        expect(storage._connectorOutputPath({ label: 'Site/One' })).toBe('/dl/SiteOne');
        expect(storage._mangaOutputPath({ title: 'Manga', connector: { label: ' 【Folder Viewer】 ' } })).toBe('/dl/【Folder Viewer】/Manga');
    });

    it('should leave the sub-folders out when the user does not want them', () => {
        expect(simulatedStorage('linux')._connectorOutputPath({ label: 'Site' })).toBe('/dl');
    });

    it('should use the folder that a source defines itself, whatever the settings say', () => {
        const storage = simulatedStorage('linux', { useSubdirectory: true });
        expect(storage._connectorOutputPath({ label: 'Folder', config: { path: { value: '/library' } } })).toBe('/library');
        // a source with other settings but no path is a website like the others
        expect(storage._connectorOutputPath({ label: 'Site', config: { token: { value: 'x' } } })).toBe('/dl/Site');
    });

    it('should keep the bookmarks apart from the configuration', () => {
        const storage = simulatedStorage('win32');
        expect(storage._bookmarkOutputPath).toBe('C:\\Bookmarks\\hakuneko.');
        expect(storage.config).toBe('C:\\Users\\me\\AppData\\Roaming\\RakKomik\\hakuneko.');
        expect(storage.temp).toBe('C:\\Users\\me\\AppData\\Local\\Temp\\hakuneko');
    });

    it('should follow the format of novels for a novel and the format of the chapters for the rest', () => {
        const storage = simulatedStorage('linux', { chapterFormat: '.cbz', novelFormat: '.pdf' });
        expect(storage._novelOutputPath(plainChapter())).toBe('/dl/My Manga/Chapter 1.pdf');
        expect(storage._chapterOutputPath(plainChapter())).toBe('/dl/My Manga/Chapter 1.cbz');
    });
});

describe('Storage addresses of files', () => {
    it.each([
        ['linux', '/dl/My Manga/Chapter 1', '001.jpg', 'file:///dl/My%20Manga/Chapter%201/001.jpg'],
        // what encodeURI leaves alone and a page address cannot hold
        ['linux', '/dl', 'a\'b#c?d;e%f.jpg', 'file:///dl/a%27b%23c%3Fd%3Be%25f.jpg'],
        ['linux', '/dl', '日本.jpg', 'file:///dl/%E6%97%A5%E6%9C%AC.jpg'],
        ['linux', '/dl', 'a[1].jpg', 'file:///dl/a%5B1%5D.jpg'],
        ['darwin', '/Users/me/Mangas/M', '1.png', 'file:///Users/me/Mangas/M/1.png'],
        ['win32', 'C:\\Mangas\\My Manga', '1.png', 'file://C:/Mangas/My%20Manga/1.png']
    ])('should address a page of a folder on %s: %s + %s', (platform, directory, file, address) => {
        expect(simulatedStorage(platform)._makeValidFileURL(directory, file)).toBe(address);
    });

    it('should keep a backslash that belongs to a name on Linux', () => {
        expect(simulatedStorage('linux')._makeValidFileURL('/dl/AC\\DC', '1.jpg')).toBe('file:///dl/AC%5CDC/1.jpg');
    });

    it('should extract a page of an archive into the temp folder and address it there, with the time it was extracted at', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-01-02T03:04:05.006Z'));
        const fs = recordingFs();
        const storage = simulatedStorage('linux', {}, fs);
        const address = await storage._extractZipEntry({ 'OEBPS/img/001 a.png': new Uint8Array([1]) }, 'OEBPS/img/001 a.png');
        expect(address).toBe('file:///tmp/hakuneko/001%20a.png?ts=1767323045006');
        expect(fs.calls.map(call => call[0])).toEqual(['mkdir', 'writeFile']);
        expect(fs.calls[0][1]).toBe('/tmp/hakuneko');
        expect(fs.calls[1][1]).toBe('/tmp/hakuneko/001 a.png');
    });

    it('should extract into the temp folder of Windows with slashes in the address', async () => {
        const storage = simulatedStorage('win32');
        const address = await storage._extractZipEntry({ '1.png': new Uint8Array([1]) }, '1.png');
        expect(address).toMatch(/^file:\/\/C:\/Users\/me\/AppData\/Local\/Temp\/hakuneko\/1\.png\?ts=\d+$/);
    });

    it('should address an extracted page whose name holds a # or a ?', async () => {
        const storage = simulatedStorage('linux');
        for (const name of ['Page #1.jpg', 'What?.jpg']) {
            const address = new URL(await storage._extractZipEntry({ [name]: new Uint8Array([1]) }, name));
            expect(decodeURIComponent(address.pathname)).toBe(`/tmp/hakuneko/${name}`);
            expect(address.hash).toBe('');
        }
    });
});

// lets the promises of the code under test settle
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('Storage atomic writes in detail', () => {
    it('should write next to the target, so that the rename stays on one file system', async () => {
        const fs = recordingFs();
        await storageWith(fs).saveConfig('settings', {});
        const temp = fs.writeFile.mock.calls[0][0];
        expect(temp).toMatch(/^\/cfg\/hakuneko\.settings\.tmp-[0-9a-z]+-[0-9a-z]+$/);
    });

    it('should give every concurrent write a temp file of its own, so that no write sees the data of another', async () => {
        const fs = recordingFs();
        const storage = storageWith(fs);
        await Promise.all([1, 2, 3].map(n => storage.saveConfig('settings', { n })));
        const temps = fs.writeFile.mock.calls.map(call => call[0]);
        expect(new Set(temps).size).toBe(3);
        expect(fs.rename.mock.calls.map(call => call[0]).sort()).toEqual([...temps].sort());
        expect(fs.rename.mock.calls.every(call => call[1] === '/cfg/hakuneko.settings')).toBe(true);
    });

    it('should write what it is given: the JSON of the value, with the indentation', async () => {
        const fs = recordingFs();
        const storage = storageWith(fs);
        await storage.saveConfig('a', { x: [1, 'é'] }, 2);
        await storage.saveConfig('b', { x: [1, 'é'] });
        expect(fs.writeFile.mock.calls[0][1]).toBe('{\n  "x": [\n    1,\n    "é"\n  ]\n}');
        expect(fs.writeFile.mock.calls[1][1]).toBe('{"x":[1,"é"]}');
    });

    it('should report the error of the write, not the one of the clean-up after it', async () => {
        const fs = recordingFs({ rename: () => Promise.reject(new Error('EPERM: rename')) });
        fs.unlink = vi.fn(() => Promise.reject(new Error('ENOENT: unlink')));
        await expect(storageWith(fs).saveConfig('settings', {})).rejects.toThrow('EPERM: rename');
        expect(fs.unlink).toHaveBeenCalledTimes(1);
    });

    it('should not touch the target when the data cannot be written', async () => {
        const fs = recordingFs({ writeFile: () => Promise.reject(new Error('ENOSPC')) });
        await expect(storageWith(fs).saveBookmarks('bookmarks', [])).rejects.toThrow('ENOSPC');
        expect(fs.calls.filter(call => call[0] === 'rename')).toEqual([]);
        expect(fs.calls.some(call => call[1] === '/bm/hakuneko.bookmarks')).toBe(false);
    });

    it('should load a stored value back from the key it was stored under', async () => {
        const fs = recordingFs();
        fs.readFile = vi.fn(async () => '{"a":[1,2]}');
        const storage = storageWith(fs);
        await expect(storage.loadConfig('settings')).resolves.toEqual({ a: [1, 2] });
        await expect(storage.loadMangaList('site')).resolves.toEqual({ a: [1, 2] });
        await expect(storage.loadBookmarks('chaptermarks')).resolves.toEqual({ a: [1, 2] });
        expect(fs.readFile.mock.calls).toEqual([
            ['/cfg/hakuneko.settings', 'utf8'],
            ['/cfg/hakuneko.mangas.site', 'utf8'],
            ['/bm/hakuneko.chaptermarks', 'utf8']
        ]);
    });

    it('should store a manga list under the ID of its connector', async () => {
        const fs = recordingFs();
        await storageWith(fs).saveMangaList('mangadex', [{ id: '1', title: 'One' }]);
        expect(fs.rename.mock.calls[0][1]).toBe('/cfg/hakuneko.mangas.mangadex');
        expect(fs.writeFile.mock.calls[0][1]).toBe('[{"id":"1","title":"One"}]');
    });

    it.each([
        ['a file that is not there', () => Promise.reject(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })), 'ENOENT: no such file'],
        ['a file that is no JSON', () => Promise.resolve('{"a":'), /JSON/],
        ['an empty file', () => Promise.resolve(''), /JSON/]
    ])('should refuse to load %s', async (name, read, message) => {
        const fs = recordingFs();
        fs.readFile = vi.fn(read);
        await expect(storageWith(fs).loadConfig('settings')).rejects.toThrow(message);
    });
});

describe('Storage external commands', () => {
    it('should hand a command to the main process and call back without an error when it worked', async () => {
        const storage = simulatedStorage('linux');
        const callback = vi.fn();
        storage.exec('echo hi', { cwd: '/dl' }, callback);
        await settle();
        expect(window.hakuneko.exec).toHaveBeenCalledWith('echo hi', { cwd: '/dl' });
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(undefined);
    });

    it('should call back with the error that the command ended with', async () => {
        const storage = simulatedStorage('linux');
        window.hakuneko.exec = vi.fn(async () => ({ error: 'Command failed: false', stdout: '', stderr: '' }));
        const callback = vi.fn();
        storage.exec('false', {}, callback);
        await settle();
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(callback.mock.calls[0][0].message).toBe('Command failed: false');
    });

    it('should call back with the error of the bridge when the command cannot be started', async () => {
        const storage = simulatedStorage('linux');
        const failure = new Error('Error invoking remote method');
        window.hakuneko.exec = vi.fn(async () => {
            throw failure;
        });
        const callback = vi.fn();
        storage.exec('x', {}, callback);
        await settle();
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(failure);
    });
});

describe('Storage command after a download', () => {
    const output = '/dl/My Manga/Chapter 1.cbz';

    function run(command, chapter = plainChapter(), platform = 'linux', path = output) {
        const storage = simulatedStorage(platform, { postChapterDownloadCommand: command });
        const result = storage._runPostChapterDownloadCommand(chapter, path);
        return { storage, result, exec: window.hakuneko.exec };
    }

    it('should replace every placeholder, as often as it is used, and run the command in the folder of the chapter', async () => {
        const { exec, result } = run('%C%|%M%|%O%|%PATH%|%C%%C%|%M%');
        await expect(result).resolves.toBeUndefined();
        expect(exec).toHaveBeenCalledTimes(1);
        expect(exec).toHaveBeenCalledWith('Site|My Manga|Chapter 1|/dl/My Manga/Chapter 1.cbz|SiteSite|My Manga', { cwd: '/dl/My Manga', windowsHide: true });
    });

    it('should know the placeholders only the way they are written', () => {
        const { exec } = run('echo %path% %Path% %PATHS% %M %C');
        expect(exec).toHaveBeenCalledWith('echo %path% %Path% %PATHS% %M %C', expect.anything());
    });

    it('should run in the folder of the chapter on Windows too', () => {
        const { exec } = run('tag "%PATH%"', plainChapter(), 'win32', 'C:\\Mangas\\My Manga\\Chapter 1.cbz');
        expect(exec).toHaveBeenCalledWith('tag "C:\\Mangas\\My Manga\\Chapter 1.cbz"', { cwd: 'C:\\Mangas\\My Manga', windowsHide: true });
    });

    it.each(['', undefined])('should run nothing when the command is %j', async command => {
        const { exec, result } = run(command);
        await expect(result).resolves.toBeUndefined();
        expect(exec).not.toHaveBeenCalled();
    });

    it('should not wait for the command: a chapter is stored when its file is', async () => {
        const fs = recordingFs();
        const storage = simulatedStorage('linux', { chapterFormat: '.cbz', postChapterDownloadCommand: 'sleep 1000' }, fs);
        window.hakuneko.exec = vi.fn(() => new Promise(() => undefined));
        const pages = [new Blob([new Uint8Array([1])], { type: 'image/png' })];
        await expect(storage.saveChapterPages(plainChapter(), pages)).resolves.toBeUndefined();
        expect(window.hakuneko.exec).toHaveBeenCalledTimes(1);
    });

    it('should only log a command that failed, and keep the chapter', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const storage = simulatedStorage('linux', { chapterFormat: '.cbz', postChapterDownloadCommand: 'false' });
        window.hakuneko.exec = vi.fn(async () => ({ error: 'Command failed: false' }));
        await expect(storage.saveChapterPages(plainChapter(), [new Blob([new Uint8Array([1])], { type: 'image/png' })])).resolves.toBeUndefined();
        await settle();
        expect(console.error).toHaveBeenCalledTimes(1);
        expect(console.error.mock.calls[0][0].message).toBe('Command failed: false');
    });

    it('should put the path into the command as it is, whatever it holds: it is the real one of the chapter', () => {
        const { exec } = run('tag "%PATH%"', plainChapter(), 'linux', '/dl/Q$&A $$ $\' $`/Chapter 1.cbz');
        expect(exec.mock.calls[0][0]).toBe('tag "/dl/Q$&A $$ $\' $`/Chapter 1.cbz"');
    });

    // The titles come from websites and the command is run by a shell: a title that is put into the command as it is could
    // end the argument that it is in and have the shell run what follows (command injection by a website).
    describe('the titles of a website', () => {
        // what sh and cmd.exe read as more than text
        const DANGEROUS = ['"', '\'', '`', '$', '\\', ';', '&', '|', '<', '>', '(', ')', '^', '%', '\n', '\r', '\t', '\u0000', '\u001f', '\u007f'];

        it.each(DANGEROUS)('should not put the character %j into the command', character => {
            for (const [placeholder, chapter] of [
                ['%M%', plainChapter('Chapter 1', `a${character}b`)],
                ['%O%', plainChapter(`a${character}b`)],
                ['%C%', plainChapter('Chapter 1', 'My Manga', 'available', { label: `a${character}b`, id: 'site' })]
            ]) {
                const { exec } = run(`echo ${placeholder}`, chapter);
                expect(exec.mock.calls[0][0]).toBe('echo a_b');
            }
        });

        it('should keep a title from ending the quotes of the command and running what follows (sh)', () => {
            const { exec } = run('echo "%M%" >> log.txt', plainChapter('Chapter 1', 'a"; touch /tmp/pwned; echo "'));
            const command = exec.mock.calls[0][0];
            expect(command).toBe('echo "a__ touch /tmp/pwned_ echo _" >> log.txt');
            // between the quotes of the command there is nothing left that ends them or starts something
            expect(command.match(/"([^"]*)"/)[1]).not.toMatch(/["';&|`$\\<>]/);
        });

        it('should keep a title from running a command, or an expansion, in cmd.exe', () => {
            const { exec } = run('echo "%M%" & echo "%O%"', plainChapter('x" & calc & "%USERNAME%', 'y" | del * | "'), 'win32');
            expect(exec.mock.calls[0][0]).toBe('echo "y_ _ del * _ _" & echo "x_ _ calc _ __USERNAME_"');
        });

        it('should keep a title that holds a placeholder from being replaced again', () => {
            const { exec } = run('echo %M% %O%', plainChapter('%PATH%', '%O%'));
            expect(exec.mock.calls[0][0]).toBe('echo _O_ _PATH_');
        });

        it('should leave the titles that hold nothing a shell reads alone, whatever the writing system', () => {
            for (const title of ['One Piece', '日本語 マンガ', 'Re:Zero - Starting Life', 'Vol. 1: A, B + C = D!', 'Oh! #1 [Special] {x} *? ~ @', 'Ünïcode — “quoted” …', 'Tom & Jerry'.replace('&', 'and')]) {
                const { exec } = run('echo %M%', plainChapter('Chapter 1', title));
                expect(exec.mock.calls[0][0]).toBe(`echo ${title}`);
            }
        });

        it('should treat a title that is no text the way it did before: as the text that it becomes', () => {
            const { exec } = run('echo %M% %O%', { title: undefined, status: 'available', manga: { title: 12, connector: { label: 'Site', id: 'site' } } });
            expect(exec.mock.calls[0][0]).toBe('echo 12 undefined');
        });
    });
});

describe('Storage folder browser', () => {
    it.each([
        ['the folder that was chosen', { canceled: false, filePaths: ['/chosen'] }, '/chosen'],
        ['the first of the folders that were chosen', { canceled: false, filePaths: ['/a', '/b'] }, '/a'],
        ['nothing, when the user cancels', { canceled: true, filePaths: [] }, null],
        ['nothing, when the user cancels after a choice', { canceled: true, filePaths: ['/a'] }, null],
        ['nothing, when nothing was chosen', { canceled: false, filePaths: [] }, null],
        ['nothing, when the platform cannot ask', undefined, null]
    ])('should answer %s', async (name, answer, folder) => {
        const storage = simulatedStorage('linux');
        window.hakuneko.dialog.showOpenDialog.mockResolvedValue(answer);
        await expect(storage.folderBrowser('/start')).resolves.toBe(folder);
        expect(window.hakuneko.dialog.showOpenDialog).toHaveBeenCalledWith({
            title: 'Download Directory for Mangas',
            defaultPath: '/start',
            properties: ['openDirectory']
        });
    });

    it('should not hide the error of the dialog', async () => {
        const storage = simulatedStorage('linux');
        window.hakuneko.dialog.showOpenDialog.mockRejectedValue(new Error('no window'));
        await expect(storage.folderBrowser('/start')).rejects.toThrow('no window');
    });
});

describe('Storage saving the pages of a chapter, without files', () => {
    const png = () => new Blob([new Uint8Array([1])], { type: 'image/png' });

    it.each(['.pdf', '.docx', '', undefined])('should refuse the chapter format %j without creating anything', async format => {
        const fs = recordingFs();
        const storage = simulatedStorage('linux', { chapterFormat: format }, fs);
        await expect(storage.saveChapterPages(plainChapter(), [png()])).rejects.toThrow(`Unsupported output format: ${format}`);
        expect(fs.calls).toEqual([]);
        expect(window.hakuneko.exec).not.toHaveBeenCalled();
    });

    it.each([undefined, null, 'page', 5])('should answer a promise that rejects when the pages are %j', async content => {
        const storage = simulatedStorage('linux', { chapterFormat: '.cbz' });
        const promise = storage.saveChapterPages(plainChapter(), content);
        await expect(promise).rejects.toBeInstanceOf(TypeError);
    });

    it('should answer a promise that rejects for a page without a type', async () => {
        const storage = simulatedStorage('linux', { chapterFormat: '.cbz' });
        await expect(storage.saveChapterPages(plainChapter(), [{ arrayBuffer: async () => new ArrayBuffer(1) }])).rejects.toBeInstanceOf(TypeError);
    });

    it('should create the folder of the chapter for images, and the folder of the manga for an archive', async () => {
        for (const [format, directory] of [['img', '/dl/My Manga/Chapter 1'], ['.cbz', '/dl/My Manga'], ['.epub', '/dl/My Manga']]) {
            const fs = recordingFs();
            await simulatedStorage('linux', { chapterFormat: format }, fs).saveChapterPages(plainChapter(), [png()]);
            expect(fs.calls[0]).toEqual(['mkdir', directory]);
        }
    });

    it('should not run the command of the user when a page could not be written', async () => {
        const fs = recordingFs({ writeFile: () => Promise.reject(new Error('ENOSPC')) });
        const storage = simulatedStorage('linux', { chapterFormat: 'img', postChapterDownloadCommand: 'echo %PATH%' }, fs);
        await expect(storage.saveChapterPages(plainChapter(), [png(), png()])).rejects.toThrow('ENOSPC');
        expect(window.hakuneko.exec).not.toHaveBeenCalled();
    });

    it('should write the pages of a folder with the name of the page, next to each other', async () => {
        const fs = recordingFs();
        await simulatedStorage('linux', { chapterFormat: 'img' }, fs).saveChapterPages(plainChapter(), [png(), png(), png()]);
        const targets = fs.calls.filter(call => call[0] === 'rename').map(call => call[2]).sort();
        expect(targets).toEqual(['/dl/My Manga/Chapter 1/1.png', '/dl/My Manga/Chapter 1/2.png', '/dl/My Manga/Chapter 1/3.png']);
    });
});
