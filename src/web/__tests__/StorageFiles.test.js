// Storage on the real file system: what it writes, lists and reads back in a temp directory, through the same bridge
// contract as the main process (see support/storageHarness.js). The paths that are compared are the ones that Node
// itself builds, so a path that Storage gets wrong cannot be wrong the same way in the expectation.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { unzipSync, zipSync, strToU8 } = require('fflate');
const { createEnvironment, page, zipEntries, listFiles } = require('./support/storageHarness.js');
const { expectWellFormed } = require('./support/wellFormed.js');

let Storage = null;
let Chapter = null;
let ComicInfoGenerator = null;
let env = null;

beforeAll(async () => {
    Storage = (await import('../mjs/engine/Storage.mjs')).default;
    Chapter = (await import('../mjs/engine/Chapter.mjs')).default;
    ComicInfoGenerator = (await import('../mjs/engine/ComicInfoGenerator.mjs')).default;
});

afterEach(() => {
    if (env) {
        env.dispose();
        env = null;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function setup(options) {
    env = createEnvironment(Storage, options);
    return env;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 1, 2, 3];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 4, 5, 6];

function createChapter(title = 'Chapter 1', status = 'available', mangaTitle = 'My Manga') {
    const manga = {
        title: mangaTitle,
        connector: { label: 'Site', id: 'site' },
        existingChapters: [],
    };
    return new Chapter(manga, '/chapter/1', title, 'en', status);
}

// the file that an address of a page points at, and the address that Node would make for a file
const addressed = (address) => decodeURIComponent(new URL(address).pathname);
const addressOf = (file) => decodeURIComponent(pathToFileURL(file).pathname);
const nameOf = (address) => addressed(address).split('/').pop();
const temporaryFiles = (directory) =>
    fs.readdirSync(directory).filter((name) => name.includes('.tmp-'));
const bytesOf = (file) => [...fs.readFileSync(file)];

function mangaFolder(...parts) {
    const folder = path.join(env.mangas, ...parts);
    fs.mkdirSync(folder, { recursive: true });
    return folder;
}

function writeZip(file, entries) {
    const files = {};
    for (const [name, content] of Object.entries(entries)) {
        files[name] = typeof content === 'string' ? strToU8(content) : new Uint8Array(content);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, zipSync(files, { level: 0 }));
    return file;
}

describe('configuration and lists on disk', () => {
    it('should store a value as JSON in the user data folder, under its key, and read it back', async () => {
        setup();
        const value = { name: 'é 日本 😀', list: [1, null, true], nested: { empty: {} } };
        await env.storage.saveConfig('settings', value, 2);
        expect(fs.readFileSync(path.join(env.userData, 'hakuneko.settings'), 'utf8')).toBe(
            '{\n  "name": "é 日本 😀",\n  "list": [\n    1,\n    null,\n    true\n  ],\n  "nested": {\n    "empty": {}\n  }\n}',
        );
        await expect(env.storage.loadConfig('settings')).resolves.toEqual(value);
    });

    it('should replace what was stored before, and leave nothing but the file', async () => {
        setup();
        await env.storage.saveConfig('settings', { first: 'x'.repeat(5000) });
        await env.storage.saveConfig('settings', { second: 1 });
        await expect(env.storage.loadConfig('settings')).resolves.toEqual({ second: 1 });
        expect(fs.readdirSync(env.userData)).toEqual(['hakuneko.settings']);
    });

    it('should keep what was stored before when the new data cannot be published, and clean up after itself', async () => {
        setup();
        await env.storage.saveConfig('settings', { kept: true });
        env.hakuneko.fs.rename = vi.fn(() =>
            Promise.reject(new Error('EXDEV: cross-device link not permitted')),
        );
        await expect(env.storage.saveConfig('settings', { lost: true })).rejects.toThrow('EXDEV');
        expect(env.hakuneko.fs.rename).toHaveBeenCalledTimes(1);
        env.hakuneko.fs.rename = undefined;
        expect(fs.readdirSync(env.userData)).toEqual(['hakuneko.settings']);
        await expect(env.storage.loadConfig('settings')).resolves.toEqual({ kept: true });
    });

    it('should keep what was stored before when the data cannot be written, and not leave a partial file', async () => {
        setup();
        await env.storage.saveConfig('settings', { kept: true });
        const write = env.hakuneko.fs.writeFile;
        env.hakuneko.fs.writeFile = vi.fn(async (target, data) => {
            await write(target, data.slice(0, 3));
            throw new Error('ENOSPC: no space left on device');
        });
        await expect(env.storage.saveConfig('settings', { lost: true })).rejects.toThrow('ENOSPC');
        env.hakuneko.fs.writeFile = write;
        expect(fs.readdirSync(env.userData)).toEqual(['hakuneko.settings']);
        await expect(env.storage.loadConfig('settings')).resolves.toEqual({ kept: true });
    });

    it('should refuse to load a value that is not there or not JSON, and not change the file', async () => {
        setup();
        await expect(env.storage.loadConfig('settings')).rejects.toMatchObject({ code: 'ENOENT' });
        const file = path.join(env.userData, 'hakuneko.settings');
        fs.writeFileSync(file, '{"a":');
        await expect(env.storage.loadConfig('settings')).rejects.toBeInstanceOf(SyntaxError);
        fs.writeFileSync(file, '');
        await expect(env.storage.loadConfig('settings')).rejects.toBeInstanceOf(SyntaxError);
        expect(fs.readFileSync(file, 'utf8')).toBe('');
    });

    it('should store the manga list of a connector under its ID, next to the configuration', async () => {
        setup();
        const mangas = [
            { id: '/m/1', title: 'Ein Mädchen' },
            { id: '/m/2', title: '日本語' },
        ];
        await env.storage.saveMangaList('site', mangas);
        await env.storage.saveMangaList('other', []);
        expect(fs.readdirSync(env.userData).sort()).toEqual([
            'hakuneko.mangas.other',
            'hakuneko.mangas.site',
        ]);
        await expect(env.storage.loadMangaList('site')).resolves.toEqual(mangas);
        await expect(env.storage.loadMangaList('other')).resolves.toEqual([]);
        await expect(env.storage.loadMangaList('unknown')).rejects.toMatchObject({
            code: 'ENOENT',
        });
    });

    it('should store bookmarks and chaptermarks in the bookmark directory, not in the user data folder', async () => {
        setup();
        fs.mkdirSync(env.settings.bookmarkDirectory.value);
        await env.storage.saveBookmarks('bookmarks', [{ key: { manga: 'm' } }], 2);
        await env.storage.saveBookmarks('chaptermarks', { m: ['c'] }, 2);
        expect(fs.readdirSync(env.settings.bookmarkDirectory.value).sort()).toEqual([
            'hakuneko.bookmarks',
            'hakuneko.chaptermarks',
        ]);
        expect(fs.readdirSync(env.userData)).toEqual([]);
        await expect(env.storage.loadBookmarks('bookmarks')).resolves.toEqual([
            { key: { manga: 'm' } },
        ]);
        await expect(env.storage.loadBookmarks('chaptermarks')).resolves.toEqual({ m: ['c'] });
    });

    it('should follow the bookmark directory when the user changes it', async () => {
        setup();
        const moved = path.join(env.root, 'elsewhere');
        fs.mkdirSync(env.settings.bookmarkDirectory.value);
        fs.mkdirSync(moved);
        await env.storage.saveBookmarks('bookmarks', ['old']);
        env.settings.bookmarkDirectory.value = moved;
        await expect(env.storage.loadBookmarks('bookmarks')).rejects.toMatchObject({
            code: 'ENOENT',
        });
        await env.storage.saveBookmarks('bookmarks', ['new']);
        expect(JSON.parse(fs.readFileSync(path.join(moved, 'hakuneko.bookmarks'), 'utf8'))).toEqual(
            ['new'],
        );
    });

    it('should create the bookmark directory when it does not exist yet', async () => {
        setup();
        const missing = path.join(env.root, 'new', 'bookmarks');
        env.settings.bookmarkDirectory.value = missing;
        await env.storage.saveBookmarks('bookmarks', ['one'], 2);
        expect(
            JSON.parse(fs.readFileSync(path.join(missing, 'hakuneko.bookmarks'), 'utf8')),
        ).toEqual(['one']);
    });

    // Windows cannot rename two files onto the same target at the same moment (EPERM), which write-file-atomic works
    // around with a queue; it was not tried there
    it.skipIf(process.platform === 'win32')(
        'should end with one of the values, never a mix, when saves overlap',
        async () => {
            setup();
            const values = Array.from({ length: 20 }, (_, n) => ({
                n,
                text: String(n).repeat(20000),
            }));
            await Promise.all(values.map((value) => env.storage.saveConfig('settings', value, 2)));
            const stored = await env.storage.loadConfig('settings');
            expect(values).toContainEqual(stored);
            expect(temporaryFiles(env.userData)).toEqual([]);
        },
    );

    it('should save different keys at the same time without one disturbing another', async () => {
        setup();
        const keys = Array.from({ length: 15 }, (_, n) => `mangas.site${n}`);
        await Promise.all(keys.map((key, n) => env.storage.saveConfig(key, { n })));
        for (const [n, key] of keys.entries()) {
            await expect(env.storage.loadConfig(key)).resolves.toEqual({ n });
        }
        expect(fs.readdirSync(env.userData)).toHaveLength(15);
    });
});

describe('folders', () => {
    it('should accept a folder, and refuse a file or a path that is not there', async () => {
        setup();
        const folder = mangaFolder('Manga');
        fs.writeFileSync(path.join(env.mangas, 'file.txt'), 'x');
        await expect(env.storage.directoryExist(folder)).resolves.toBeUndefined();
        await expect(env.storage.directoryExist(path.join(env.mangas, 'file.txt'))).rejects.toThrow(
            `The given path "${path.join(env.mangas, 'file.txt')}" is not a directory!`,
        );
        await expect(
            env.storage.directoryExist(path.join(env.mangas, 'nothing')),
        ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('should tell that the folder of a manga is there by its name on the device', async () => {
        setup();
        mangaFolder('FateZero');
        const connector = { label: 'Site' };
        await expect(
            env.storage.mangaDirectoryExist({ title: 'Fate/Zero', connector }),
        ).resolves.toBeUndefined();
        await expect(
            env.storage.mangaDirectoryExist({ title: 'Fate Zero', connector }),
        ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('should list what the base folder holds, by the names on the device', async () => {
        setup();
        mangaFolder('Alpha');
        mangaFolder('日本語 マンガ');
        fs.writeFileSync(path.join(env.mangas, 'notes.txt'), 'x');
        const titles = await env.storage.getExistingMangaTitles({ label: 'Site' });
        expect(
            Object.keys(titles)
                .map((name) => name.normalize('NFC'))
                .sort(),
        ).toEqual(['Alpha', 'notes.txt', '日本語 マンガ']);
        expect(titles['Alpha']).toBe(true);
        expect(titles['Gamma']).toBeUndefined();
    });

    it('should list an empty folder as no titles', async () => {
        setup();
        mangaFolder();
        expect(Object.keys(await env.storage.getExistingMangaTitles({ label: 'Site' }))).toEqual(
            [],
        );
    });

    it('should list the folder of the website, when the user wants a folder per website', async () => {
        setup({ settings: { useSubdirectory: true } });
        mangaFolder('Alpha');
        mangaFolder('SiteOne', 'Beta');
        const titles = await env.storage.getExistingMangaTitles({ label: 'Site/One' });
        expect(Object.keys(titles)).toEqual(['Beta']);
    });

    it('should list the folder that a source brings along, instead of the base folder', async () => {
        setup({ settings: { useSubdirectory: true } });
        mangaFolder('Alpha');
        const library = path.join(env.root, 'library');
        fs.mkdirSync(path.join(library, 'Zeta'), { recursive: true });
        const titles = await env.storage.getExistingMangaTitles({
            label: 'Folder',
            config: { path: { value: library } },
        });
        expect(Object.keys(titles)).toEqual(['Zeta']);
    });

    it('should refuse to list a folder that is not there', async () => {
        setup();
        await expect(env.storage.getExistingMangaTitles({ label: 'Site' })).rejects.toMatchObject({
            code: 'ENOENT',
        });
        await expect(
            env.storage.getExistingChapterTitles({ title: 'Manga', connector: { label: 'Site' } }),
        ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('should list everything in the folder of a manga as a chapter on the device: archives, folders, and the rest', async () => {
        setup();
        const folder = mangaFolder('My Manga');
        fs.mkdirSync(path.join(folder, 'Chapter 2'));
        fs.writeFileSync(path.join(folder, 'Chapter 1.cbz'), 'x');
        fs.writeFileSync(path.join(folder, 'cover.jpg'), 'x');
        const titles = await env.storage.getExistingChapterTitles({
            title: 'My Manga',
            connector: { label: 'Site' },
        });
        expect(Object.keys(titles).sort()).toEqual(['Chapter 1.cbz', 'Chapter 2', 'cover.jpg']);
        expect(titles['Chapter 1.cbz']).toBe(true);
        expect(titles['Chapter 3']).toBeUndefined();
    });
});

describe('saving a chapter of images', () => {
    it('should store a file per page in a folder of the chapter, with the bytes it was given', async () => {
        setup();
        await env.storage.saveChapterPages(createChapter(), [
            page('image/png', PNG),
            page('image/jpeg', JPEG),
            page('image/webp', [9]),
            page('image/gif', [8]),
        ]);
        const folder = path.join(env.mangas, 'My Manga', 'Chapter 1');
        expect(listFiles(env.mangas)).toEqual([
            'My Manga/Chapter 1/1.png',
            'My Manga/Chapter 1/2.jpg',
            'My Manga/Chapter 1/3.webp',
            'My Manga/Chapter 1/4.gif',
        ]);
        expect(bytesOf(path.join(folder, '1.png'))).toEqual(PNG);
        expect(bytesOf(path.join(folder, '2.jpg'))).toEqual(JPEG);
        expect(bytesOf(path.join(folder, '3.webp'))).toEqual([9]);
        expect(bytesOf(path.join(folder, '4.gif'))).toEqual([8]);
    });

    it.each([
        [1, '1'],
        [9, '1'],
        [10, '01'],
        [99, '01'],
        [100, '001'],
    ])(
        'should name the pages of a chapter of %i pages with as many digits as the last number has',
        async (count, first) => {
            setup();
            await env.storage.saveChapterPages(
                createChapter(),
                Array.from({ length: count }, (_, index) => page('image/png', [index])),
            );
            const names = fs.readdirSync(path.join(env.mangas, 'My Manga', 'Chapter 1')).sort();
            expect(names).toHaveLength(count);
            expect(names[0]).toBe(`${first}.png`);
            expect(names[count - 1]).toBe(`${String(count).padStart(first.length, '0')}.png`);
            // each page got its own file: page number n holds the byte n - 1
            const last = names.length - 1;
            expect(bytesOf(path.join(env.mangas, 'My Manga', 'Chapter 1', names[last]))).toEqual([
                last,
            ]);
        },
    );

    it('should name the pages by what they are: other images and the rest get a name of their own', async () => {
        setup();
        await env.storage.saveChapterPages(createChapter(), [
            page('image/avif'),
            page('image/jpg'),
            page('application/octet-stream'),
            page(''),
        ]);
        expect(fs.readdirSync(path.join(env.mangas, 'My Manga', 'Chapter 1')).sort()).toEqual([
            '1.img',
            '2.img',
            '3.bin',
            '4.bin',
        ]);
    });

    it('should keep the folder of a manga apart from the one of another connector, when the user wants it', async () => {
        setup({ settings: { useSubdirectory: true } });
        await env.storage.saveChapterPages(createChapter(), [page('image/png')]);
        expect(listFiles(env.mangas)).toEqual(['Site/My Manga/Chapter 1/1.png']);
    });

    it('should write below the names that the title of the manga and of the chapter make', async () => {
        setup();
        await env.storage.saveChapterPages(
            createChapter('Chapter 1/2 ... ', 'available', '  Fate/Zero. '),
            [page('image/png')],
        );
        expect(listFiles(env.mangas)).toEqual(['FateZero/Chapter 12/1.png']);
    });

    it('should store a chapter with a title in any script', async () => {
        setup();
        await env.storage.saveChapterPages(
            createChapter('第1話 はじまり 😀', 'available', '日本語 マンガ'),
            [page('image/png', PNG)],
        );
        const [file] = listFiles(env.mangas);
        expect(file.normalize('NFC')).toBe('日本語 マンガ/第1話 はじまり 😀/1.png');
        expect(bytesOf(path.join(env.mangas, file))).toEqual(PNG);
    });

    // NOTE: the storage stores what it is given, also nothing; it is the download job that has to keep an empty
    // chapter away (see DownloadJob.test.js)
    it('should store a chapter without pages as an empty folder', async () => {
        setup();
        await env.storage.saveChapterPages(createChapter(), []);
        expect(fs.readdirSync(path.join(env.mangas, 'My Manga', 'Chapter 1'))).toEqual([]);
    });

    it('should leave no temp file behind', async () => {
        setup();
        await env.storage.saveChapterPages(
            createChapter(),
            Array.from({ length: 12 }, () => page('image/png')),
        );
        expect(temporaryFiles(path.join(env.mangas, 'My Manga', 'Chapter 1'))).toEqual([]);
    });

    it('should refuse a chapter when a page cannot be written, and not run the command of the user', async () => {
        setup({ settings: { postChapterDownloadCommand: 'echo %PATH%' } });
        const write = env.hakuneko.fs.writeFile;
        env.hakuneko.fs.writeFile = vi.fn((target, data) =>
            target.includes(`${path.sep}2.png.tmp-`)
                ? Promise.reject(new Error('EIO: i/o error'))
                : write(target, data),
        );
        await expect(
            env.storage.saveChapterPages(createChapter(), [
                page('image/png'),
                page('image/png'),
                page('image/png'),
            ]),
        ).rejects.toThrow('EIO');
        // the other pages go on while the chapter is refused
        await env.idle();
        expect(env.hakuneko.exec).not.toHaveBeenCalled();
        expect(temporaryFiles(path.join(env.mangas, 'My Manga', 'Chapter 1'))).toEqual([]);
    });

    it('should refuse a chapter whose folder cannot be created', async () => {
        setup();
        // a file where the folder of the manga has to be
        fs.mkdirSync(env.mangas);
        fs.writeFileSync(path.join(env.mangas, 'My Manga'), 'a file');
        await expect(
            env.storage.saveChapterPages(createChapter(), [page('image/png')]),
        ).rejects.toThrow();
        expect(fs.readFileSync(path.join(env.mangas, 'My Manga'), 'utf8')).toBe('a file');
    });

    it('should run the command of the user once, after the pages are stored', async () => {
        setup({ settings: { postChapterDownloadCommand: 'tag "%PATH%" "%C%" "%M%" "%O%"' } });
        const output = path.join(env.mangas, 'My Manga', 'Chapter 1');
        let stored = [];
        env.hakuneko.exec.mockImplementation(async () => {
            stored = fs.readdirSync(output);
            return {};
        });
        await env.storage.saveChapterPages(createChapter(), [page('image/png'), page('image/png')]);
        expect(env.hakuneko.exec).toHaveBeenCalledTimes(1);
        expect(env.hakuneko.exec).toHaveBeenCalledWith(
            `tag "${output}" "Site" "My Manga" "Chapter 1"`,
            { cwd: path.dirname(output), windowsHide: true },
        );
        expect(stored.sort()).toEqual(['1.png', '2.png']);
    });
});

describe('saving a chapter as an archive', () => {
    it('should store a chapter as one comic book archive in the folder of the manga', async () => {
        setup({ settings: { chapterFormat: '.cbz' } });
        await env.storage.saveChapterPages(createChapter(), [
            page('image/png', PNG),
            page('image/jpeg', JPEG),
        ]);
        expect(listFiles(env.mangas)).toEqual(['My Manga/Chapter 1.cbz']);
        const bytes = new Uint8Array(
            fs.readFileSync(path.join(env.mangas, 'My Manga', 'Chapter 1.cbz')),
        );
        // the pictures are compressed already: everything is stored
        expect(zipEntries(bytes)).toEqual([
            { name: 'ComicInfo.xml', method: 0 },
            { name: '1.png', method: 0 },
            { name: '2.jpg', method: 0 },
        ]);
        const archive = unzipSync(bytes);
        expect([...archive['1.png']]).toEqual(PNG);
        expect([...archive['2.jpg']]).toEqual(JPEG);
        // the series is the manga, the title is the chapter
        expect(new TextDecoder().decode(archive['ComicInfo.xml'])).toBe(
            '<ComicInfo series="My Manga" title="Chapter 1" pages="2"/>',
        );
    });

    it('should describe the chapter with the generator of the engine', async () => {
        setup({ settings: { chapterFormat: '.cbz' }, ComicInfoGenerator });
        await env.storage.saveChapterPages(createChapter('Ch & 1', 'available', 'A & B'), [
            page('image/png'),
            page('image/png'),
            page('image/png'),
        ]);
        const info = new TextDecoder().decode(
            unzipSync(
                new Uint8Array(fs.readFileSync(path.join(env.mangas, 'A & B', 'Ch & 1.cbz'))),
            )['ComicInfo.xml'],
        );
        expect(info).toContain('<Series>A &amp; B</Series>');
        expect(info).toContain('<Title>Ch &amp; 1</Title>');
        expect(info).toContain('<PageCount>3</PageCount>');
    });

    it('should replace the archive of an earlier download', async () => {
        setup({ settings: { chapterFormat: '.cbz' } });
        const file = path.join(env.mangas, 'My Manga', 'Chapter 1.cbz');
        await env.storage.saveChapterPages(createChapter(), [
            page('image/png', [1]),
            page('image/png', [2]),
        ]);
        await env.storage.saveChapterPages(createChapter(), [page('image/jpeg', [3])]);
        expect(Object.keys(unzipSync(new Uint8Array(fs.readFileSync(file)))).sort()).toEqual([
            '1.jpg',
            'ComicInfo.xml',
        ]);
        expect(fs.readdirSync(path.dirname(file))).toEqual(['Chapter 1.cbz']);
    });

    it('should not leave a temp file when the archive cannot be published', async () => {
        setup({ settings: { chapterFormat: '.cbz' } });
        // a folder where the archive has to be
        mangaFolder('My Manga', 'Chapter 1.cbz', 'inside');
        await expect(
            env.storage.saveChapterPages(createChapter(), [page('image/png')]),
        ).rejects.toThrow();
        expect(fs.readdirSync(path.join(env.mangas, 'My Manga'))).toEqual(['Chapter 1.cbz']);
        expect(fs.statSync(path.join(env.mangas, 'My Manga', 'Chapter 1.cbz')).isDirectory()).toBe(
            true,
        );
    });

    it('should run the command of the user with the archive', async () => {
        setup({ settings: { chapterFormat: '.cbz', postChapterDownloadCommand: 'tag "%PATH%"' } });
        await env.storage.saveChapterPages(createChapter(), [page('image/png')]);
        const output = path.join(env.mangas, 'My Manga', 'Chapter 1.cbz');
        expect(env.hakuneko.exec).toHaveBeenCalledWith(`tag "${output}"`, {
            cwd: path.dirname(output),
            windowsHide: true,
        });
    });
});

describe('saving a chapter as an e-book', () => {
    async function saveEpub(
        types = ['image/png', 'image/jpeg'],
        title = 'Chapter 1',
        mangaTitle = 'My Manga',
    ) {
        setup({ settings: { chapterFormat: '.epub' } });
        await env.storage.saveChapterPages(
            createChapter(title, 'available', mangaTitle),
            types.map((type, index) => page(type, [index, index])),
        );
        const bytes = new Uint8Array(
            fs.readFileSync(path.join(env.mangas, mangaTitle, `${title}.epub`)),
        );
        const archive = unzipSync(bytes);
        return { bytes, archive, text: (name) => new TextDecoder().decode(archive[name]) };
    }

    it('should store the container the way a reader expects it: mimetype first and stored', async () => {
        const { bytes, text } = await saveEpub();
        const entries = zipEntries(bytes);
        expect(entries[0]).toEqual({ name: 'mimetype', method: 0 });
        expect(text('mimetype')).toBe('application/epub+zip');
        expect(entries.map((entry) => entry.name).sort()).toEqual([
            'META-INF/container.xml',
            'OEBPS/content.opf',
            'OEBPS/css/style.css',
            'OEBPS/img/1.png',
            'OEBPS/img/2.jpg',
            'OEBPS/toc.ncx',
            'OEBPS/xhtml/0.xhtml',
            'OEBPS/xhtml/1.xhtml',
            'mimetype',
        ]);
        // the pictures are compressed already: everything is stored
        expect(entries.every((entry) => entry.method === 0)).toBe(true);
        expect(text('META-INF/container.xml')).toContain('full-path="OEBPS/content.opf"');
    });

    it('should store a picture and a page for it, in the order of the chapter', async () => {
        const { archive, text } = await saveEpub(['image/png', 'image/jpeg', 'image/webp']);
        expect([...archive['OEBPS/img/1.png']]).toEqual([0, 0]);
        expect([...archive['OEBPS/img/2.jpg']]).toEqual([1, 1]);
        expect([...archive['OEBPS/img/3.webp']]).toEqual([2, 2]);
        expect(text('OEBPS/xhtml/0.xhtml')).toContain('src="../img/1.png"');
        expect(text('OEBPS/xhtml/1.xhtml')).toContain('src="../img/2.jpg"');
        expect(text('OEBPS/xhtml/2.xhtml')).toContain('src="../img/3.webp"');
        const opf = text('OEBPS/content.opf');
        expect(opf).toContain('<item id="IMG_0" href="img/1.png" media-type="image/png"/>');
        expect(opf).toContain('<item id="IMG_1" href="img/2.jpg" media-type="image/jpeg"/>');
        expect(opf).toContain('<item id="IMG_2" href="img/3.webp" media-type="image/webp"/>');
        expect(opf.indexOf('idref="XHTML_0"')).toBeLessThan(opf.indexOf('idref="XHTML_1"'));
        expect(opf.indexOf('idref="XHTML_1"')).toBeLessThan(opf.indexOf('idref="XHTML_2"'));
        expect(text('OEBPS/toc.ncx')).toContain('<content src="xhtml/2.xhtml"/>');
    });

    it('should write the media type of a picture without the parameters that the server added', async () => {
        const { text } = await saveEpub(['image/png; charset=binary']);
        expect(text('OEBPS/content.opf')).toContain(
            '<item id="IMG_0" href="img/1.png" media-type="image/png"/>',
        );
    });

    it('should name the book after the manga and the chapter, and write XML a reader can parse', async () => {
        const { text } = await saveEpub(['image/png'], 'Chapter 1 & 2', "Tom & Jerry's");
        expect(text('OEBPS/content.opf')).toContain(
            `<dc:title>Tom &amp; Jerry's ${path.sep} Chapter 1 &amp; 2</dc:title>`,
        );
        for (const name of [
            'META-INF/container.xml',
            'OEBPS/xhtml/0.xhtml',
            'OEBPS/content.opf',
            'OEBPS/toc.ncx',
        ]) {
            expectWellFormed(text(name).replace(/<\?xml[^>]*>\s*|<!DOCTYPE[^>]*>\s*/g, ''));
        }
    });

    it('should identify the book by letters only, as an XML ID has to start with one', async () => {
        const { text } = await saveEpub();
        const uid = /unique-identifier="([^"]*)"/.exec(text('OEBPS/content.opf'))[1];
        expect(uid).toMatch(/^[a-zA-Z]+$/);
        expect(text('OEBPS/toc.ncx')).toContain(`<meta name="dtb:uid" content="${uid}"/>`);
    });

    it('should run the command of the user with the e-book', async () => {
        setup({ settings: { chapterFormat: '.epub', postChapterDownloadCommand: 'tag "%PATH%"' } });
        await env.storage.saveChapterPages(createChapter(), [page('image/png')]);
        expect(env.hakuneko.exec.mock.calls[0][0]).toBe(
            `tag "${path.join(env.mangas, 'My Manga', 'Chapter 1.epub')}"`,
        );
    });
});

describe('temp files', () => {
    it('should store a file in the temp folder of the engine and tell where it is', async () => {
        setup();
        const file = await env.storage.saveTempFile('page 1.png', new Uint8Array(PNG));
        expect(file).toBe(path.join(env.root, 'tmp', 'hakuneko', 'page 1.png'));
        expect(bytesOf(file)).toEqual(PNG);
    });

    it('should keep the file in the temp folder, whatever the name says', async () => {
        setup();
        const folder = path.join(env.root, 'tmp', 'hakuneko');
        for (const name of [
            '../../outside.png',
            '..\\..\\outside.png',
            '/etc/outside.png',
            'a/b.png',
        ]) {
            const file = await env.storage.saveTempFile(name, new Uint8Array([1]));
            expect(path.dirname(file)).toBe(folder);
        }
        expect(fs.existsSync(path.join(env.root, 'outside.png'))).toBe(false);
        expect(fs.existsSync(path.join(env.root, 'tmp', 'outside.png'))).toBe(false);
    });

    it('should give a name that is nothing once it is cleaned a placeholder, and not write into the folder itself', async () => {
        setup();
        await env.storage.saveTempFile('...', new Uint8Array([1]));
        expect(bytesOf(path.join(env.root, 'tmp', 'hakuneko', '_'))).toEqual([1]);
    });

    it('should replace a file that is there', async () => {
        setup();
        await env.storage.saveTempFile('a.png', new Uint8Array([1]));
        await env.storage.saveTempFile('a.png', new Uint8Array([2, 2]));
        expect(bytesOf(path.join(env.root, 'tmp', 'hakuneko', 'a.png'))).toEqual([2, 2]);
    });
});

describe('reading the pages of a chapter', () => {
    describe('of a folder', () => {
        it('should give the address of each file in the folder', async () => {
            setup();
            const folder = mangaFolder('My Manga', 'Chapter 1');
            for (const name of ['001.png', '002.jpg', '003 copy.webp']) {
                fs.writeFileSync(path.join(folder, name), 'x');
            }
            const pages = await env.storage.loadChapterPages(folder);
            expect(pages.map(addressed)).toEqual(
                ['001.png', '002.jpg', '003 copy.webp'].map((name) =>
                    addressOf(path.join(folder, name)),
                ),
            );
            expect(
                pages.every((address) => address.startsWith('file://') && !address.includes('?')),
            ).toBe(true);
        });

        it.each([
            ['spaces', 'a b.png'],
            ['a hash', 'Page #1.png'],
            ['semicolons and quotes', "a;b'c.png"],
            ['a percent sign', '100%.png'],
            ['brackets', 'a[1].png'],
            ['accents', 'été.png'],
            ['japanese', '日本語.png'],
            ['an emoji', '😀.png'],
        ])('should address a file with %s so that the address is the file', async (name, file) => {
            setup();
            const folder = mangaFolder('My Manga', 'Chapter 1');
            fs.writeFileSync(path.join(folder, file), 'x');
            const [address] = await env.storage.loadChapterPages(folder);
            const url = new URL(address);
            expect(url.hash).toBe('');
            expect(url.search).toBe('');
            expect(addressed(address).normalize('NFC')).toBe(
                addressOf(path.join(folder, file)).normalize('NFC'),
            );
        });

        it.skipIf(process.platform === 'win32')(
            'should address a file with a question mark so that the address is the file',
            async () => {
                setup();
                const folder = mangaFolder('My Manga', 'Chapter 1');
                fs.writeFileSync(path.join(folder, 'What?.png'), 'x');
                const [address] = await env.storage.loadChapterPages(folder);
                expect(new URL(address).search).toBe('');
                expect(addressed(address)).toBe(addressOf(path.join(folder, 'What?.png')));
            },
        );

        it('should give nothing for an empty folder', async () => {
            setup();
            await expect(
                env.storage.loadChapterPages(mangaFolder('My Manga', 'Chapter 1')),
            ).resolves.toEqual([]);
        });

        it('should refuse a folder that is not there, and a file that is none of the archives', async () => {
            setup();
            await expect(
                env.storage.loadChapterPages(path.join(env.mangas, 'nothing')),
            ).rejects.toMatchObject({ code: 'ENOENT' });
            fs.mkdirSync(env.mangas);
            fs.writeFileSync(path.join(env.mangas, 'notes.txt'), 'x');
            await expect(
                env.storage.loadChapterPages(path.join(env.mangas, 'notes.txt')),
            ).rejects.toThrow();
        });

        it('should only give the pictures of a folder', async () => {
            setup();
            const folder = mangaFolder('My Manga', 'Chapter 1');
            for (const name of ['001.png', '002.jpg', 'Thumbs.db', '.DS_Store', 'desktop.ini']) {
                fs.writeFileSync(path.join(folder, name), 'x');
            }
            fs.mkdirSync(path.join(folder, 'extras'));
            const pages = await env.storage.loadChapterPages(folder);
            expect(pages.map(nameOf)).toEqual(['001.png', '002.jpg']);
        });

        it('should give the pages of a folder in the order of their numbers', async () => {
            setup();
            const folder = mangaFolder('My Manga', 'Chapter 1');
            for (const name of ['10.png', '2.png', '1.png']) {
                fs.writeFileSync(path.join(folder, name), 'x');
            }
            expect((await env.storage.loadChapterPages(folder)).map(nameOf)).toEqual([
                '1.png',
                '2.png',
                '10.png',
            ]);
        });
    });

    describe('of a comic book archive', () => {
        it('should extract the pictures to the temp folder and give their addresses, with the time of the extraction', async () => {
            setup();
            vi.useFakeTimers({ toFake: ['Date'] });
            const now = Date.UTC(2026, 4, 6, 7, 8, 9, 10);
            vi.setSystemTime(now);
            const file = writeZip(path.join(env.mangas, 'My Manga', 'Chapter 1.cbz'), {
                '001.png': PNG,
                '002.jpg': JPEG,
            });
            const pages = await env.storage.loadChapterPages(file);
            expect(pages).toHaveLength(2);
            expect(pages.map((address) => new URL(address).search)).toEqual([
                `?ts=${now}`,
                `?ts=${now}`,
            ]);
            expect(pages.map(addressed)).toEqual(
                ['001.png', '002.jpg'].map((name) => addressOf(path.join(env.storage.temp, name))),
            );
            expect(bytesOf(path.join(env.storage.temp, '001.png'))).toEqual(PNG);
            expect(bytesOf(path.join(env.storage.temp, '002.jpg'))).toEqual(JPEG);
        });

        it('should only give the pictures at the top of the archive, by their extension in any case', async () => {
            setup();
            const file = writeZip(path.join(env.mangas, 'My Manga', 'Chapter 1.cbz'), {
                'ComicInfo.xml': '<ComicInfo/>',
                '001.PNG': PNG,
                '002.jpeg': JPEG,
                '003.webp': [3],
                '004.avif': [4],
                '005.gif': [5],
                '006.bmp': [6],
                'Thumbs.db': [7],
                'readme.txt': 'x',
                '007.png.bak': [8],
                'extras/008.png': [9],
                '__MACOSX/._001.png': [10],
            });
            const pages = await env.storage.loadChapterPages(file);
            expect(pages.map(nameOf)).toEqual([
                '001.PNG',
                '002.jpeg',
                '003.webp',
                '004.avif',
                '005.gif',
                '006.bmp',
            ]);
        });

        // NOTE: an archive whose pictures are in a folder of their own, as an archive of a folder is made by most tools,
        // has no pages here: the loader only looks at the top level (Storage.mjs:285). A limitation, as far as can be told.
        it('should find no pictures in an archive that keeps them in a folder', async () => {
            setup();
            const file = writeZip(path.join(env.mangas, 'My Manga', 'Chapter 1.cbz'), {
                'Chapter 1/001.png': PNG,
                'Chapter 1/002.png': PNG,
            });
            await expect(env.storage.loadChapterPages(file)).resolves.toEqual([]);
        });

        it('should give the pictures in the order of their names, whatever order the archive holds them in', async () => {
            setup();
            const file = writeZip(path.join(env.mangas, 'My Manga', 'Chapter 1.cbz'), {
                '003.png': [3],
                '001.png': [1],
                '002.png': [2],
            });
            expect((await env.storage.loadChapterPages(file)).map(nameOf)).toEqual([
                '001.png',
                '002.png',
                '003.png',
            ]);
        });

        it('should give nothing for an archive without pictures', async () => {
            setup();
            const file = writeZip(path.join(env.mangas, 'My Manga', 'Chapter 1.cbz'), {
                'ComicInfo.xml': '<ComicInfo/>',
            });
            await expect(env.storage.loadChapterPages(file)).resolves.toEqual([]);
        });

        it.each([
            ['spaces', 'Page 1.png'],
            ['semicolons and quotes', "a;b'c.png"],
            ['accents', 'été.png'],
            ['japanese', '日本語.png'],
        ])('should address an extracted picture with %s', async (name, entry) => {
            setup();
            const file = writeZip(path.join(env.mangas, 'My Manga', 'Chapter 1.cbz'), {
                [entry]: PNG,
            });
            const [address] = await env.storage.loadChapterPages(file);
            expect(addressed(address).normalize('NFC')).toBe(
                addressOf(path.join(env.storage.temp, entry)).normalize('NFC'),
            );
            expect(new URL(address).hash).toBe('');
            expect(bytesOf(path.join(env.storage.temp, entry))).toEqual(PNG);
        });

        it('should address an extracted picture with a hash in its name', async () => {
            setup();
            const file = writeZip(path.join(env.mangas, 'My Manga', 'Chapter 1.cbz'), {
                'Page #1.png': PNG,
            });
            const [address] = await env.storage.loadChapterPages(file);
            expect(new URL(address).hash).toBe('');
            expect(addressed(address)).toBe(addressOf(path.join(env.storage.temp, 'Page #1.png')));
        });

        it('should give the pictures of an archive in the order of their numbers', async () => {
            setup();
            const file = writeZip(path.join(env.mangas, 'My Manga', 'Chapter 1.cbz'), {
                '10.png': [10],
                '2.png': [2],
                '1.png': [1],
            });
            expect((await env.storage.loadChapterPages(file)).map(nameOf)).toEqual([
                '1.png',
                '2.png',
                '10.png',
            ]);
        });

        it('should read an archive whose extension is in capitals', async () => {
            setup();
            const file = writeZip(path.join(env.mangas, 'My Manga', 'Vol 1.CBZ'), {
                '001.png': PNG,
            });
            expect((await env.storage.loadChapterPages(file)).map(nameOf)).toEqual(['001.png']);
        });

        // NOTE: the pictures are extracted to files that are named like the entries, so that the archives of two chapters
        // that call their pictures alike share the files: the address of a picture of the first leads to the picture of the
        // second as soon as that one is read (the time in the address only makes the page reload what it is told to show)
        it('should share the extracted pictures of two archives that name them alike', async () => {
            setup();
            const first = writeZip(path.join(env.mangas, 'My Manga', 'Chapter 1.cbz'), {
                '001.png': [1, 1],
            });
            const second = writeZip(path.join(env.mangas, 'My Manga', 'Chapter 2.cbz'), {
                '001.png': [2, 2],
            });
            const [one] = await env.storage.loadChapterPages(first);
            expect(bytesOf(path.join(env.storage.temp, nameOf(one)))).toEqual([1, 1]);
            const [two] = await env.storage.loadChapterPages(second);
            expect(nameOf(two)).toBe(nameOf(one));
            expect(bytesOf(path.join(env.storage.temp, nameOf(one)))).toEqual([2, 2]);
        });

        it.each([
            ['bytes that are no archive', () => Buffer.from('this is not a zip file at all')],
            ['an empty file', () => Buffer.alloc(0)],
            [
                'an archive that was cut off',
                () => Buffer.from(zipSync({ '001.png': new Uint8Array(PNG) })).subarray(0, 20),
            ],
        ])('should refuse %s', async (name, content) => {
            setup();
            const file = path.join(env.mangas, 'Chapter 1.cbz');
            fs.mkdirSync(env.mangas);
            fs.writeFileSync(file, content());
            await expect(env.storage.loadChapterPages(file)).rejects.toThrow();
        });

        it('should refuse an archive that is not there', async () => {
            setup();
            await expect(
                env.storage.loadChapterPages(path.join(env.mangas, 'nothing.cbz')),
            ).rejects.toMatchObject({ code: 'ENOENT' });
        });
    });

    describe('of an e-book', () => {
        it('should give the pictures from the folder of the pictures only, and extract them', async () => {
            setup();
            const file = writeZip(path.join(env.mangas, 'My Manga', 'Chapter 1.epub'), {
                mimetype: 'application/epub+zip',
                'OEBPS/img/001.png': PNG,
                'OEBPS/img/002.jpg': JPEG,
                'OEBPS/img/deep/003.png': [3],
                'OEBPS/xhtml/0.xhtml': '<html/>',
                'OEBPS/001.png': [4],
                'img/005.png': [5],
            });
            const pages = await env.storage.loadChapterPages(file);
            expect(pages.map(nameOf)).toEqual(['001.png', '002.jpg']);
            expect(bytesOf(path.join(env.storage.temp, '002.jpg'))).toEqual(JPEG);
        });

        it('should give the pictures in the order of their names, whatever order the e-book holds them in', async () => {
            setup();
            const file = writeZip(path.join(env.mangas, 'My Manga', 'Chapter 1.epub'), {
                'OEBPS/img/003.png': [3],
                'OEBPS/img/001.png': [1],
                'OEBPS/img/002.png': [2],
            });
            expect((await env.storage.loadChapterPages(file)).map(nameOf)).toEqual([
                '001.png',
                '002.png',
                '003.png',
            ]);
        });

        it('should give the pictures of an e-book in the order of their numbers', async () => {
            setup();
            const file = writeZip(path.join(env.mangas, 'My Manga', 'Chapter 1.epub'), {
                'OEBPS/img/10.png': [10],
                'OEBPS/img/2.png': [2],
                'OEBPS/img/1.png': [1],
            });
            expect((await env.storage.loadChapterPages(file)).map(nameOf)).toEqual([
                '1.png',
                '2.png',
                '10.png',
            ]);
        });
    });

    describe('of anything else', () => {
        it('should not read a portable document', async () => {
            setup();
            await expect(
                env.storage.loadChapterPages(path.join(env.mangas, 'Chapter 1.pdf')),
            ).rejects.toThrow('PDF preview not yet supported!');
        });

        it.each([undefined, null, 5, {}, ['a']])(
            'should refuse %j as the chapter to read',
            async (chapter) => {
                setup();
                await expect(env.storage.loadChapterPages(chapter)).rejects.toThrow(
                    'Invalid parameter "chapter", must be <String> or <Chapter> type!',
                );
            },
        );
    });
});

describe('a chapter that is stored and read back', () => {
    it.each([
        ['img', 'Chapter 1'],
        ['.cbz', 'Chapter 1.cbz'],
        ['.epub', 'Chapter 1.epub'],
    ])('should give back the pages that were saved in the format %s', async (format, stored) => {
        setup({ settings: { chapterFormat: format } });
        const chapter = createChapter();
        await env.storage.saveChapterPages(chapter, [
            page('image/png', PNG),
            page('image/jpeg', JPEG),
            page('image/webp', [3, 3]),
        ]);
        // the directory of the manga is read when its chapters are listed, so the chapter is found by its file
        chapter.manga.existingChapters = await env.storage.getExistingChapterTitles(chapter.manga);
        expect(Object.keys(chapter.manga.existingChapters)).toEqual([stored]);
        const pages = await env.storage.loadChapterPages(chapter);
        expect(pages.map(nameOf)).toEqual(['1.png', '2.jpg', '3.webp']);
        const folder =
            format === 'img' ? path.join(env.mangas, 'My Manga', 'Chapter 1') : env.storage.temp;
        expect(bytesOf(path.join(folder, '1.png'))).toEqual(PNG);
        expect(bytesOf(path.join(folder, '2.jpg'))).toEqual(JPEG);
        expect(bytesOf(path.join(folder, '3.webp'))).toEqual([3, 3]);
    });

    it('should give back every page of an archive, whatever the type that the server sent', async () => {
        setup({ settings: { chapterFormat: '.cbz' } });
        const chapter = createChapter();
        await env.storage.saveChapterPages(chapter, [
            page('image/png'),
            page('image/avif'),
            page('image/jpg'),
            page('application/octet-stream'),
        ]);
        expect(await env.storage.loadChapterPages(chapter)).toHaveLength(4);
    });
});
