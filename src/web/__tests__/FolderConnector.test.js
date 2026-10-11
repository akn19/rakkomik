// The built-in source that shows a folder of the device as a website: every folder in it is a manga, every entry of
// that folder is a chapter, and the pictures of a chapter are read by the storage. The folders are real (a temp
// directory), the manga, the chapter and the storage are the real ones too (see support/storageHarness.js).
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { zipSync, strToU8 } = require('fflate');
const { createEnvironment, page } = require('./support/storageHarness.js');

let FolderConnector = null;
let Storage = null;
let Manga = null;
let Chapter = null;
let env = null;

beforeAll(async () => {
    FolderConnector = (await import('../mjs/connectors/system/FolderConnector.mjs')).default;
    Storage = (await import('../mjs/engine/Storage.mjs')).default;
    Manga = (await import('../mjs/engine/Manga.mjs')).default;
    Chapter = (await import('../mjs/engine/Chapter.mjs')).default;
});

afterEach(() => {
    if (env) {
        env.dispose();
        env = null;
    }
    vi.restoreAllMocks();
});

const PNG = [0x89, 0x50, 0x4e, 0x47, 1, 2, 3];

/** a device with a library, and the connector that shows it; `entries` are paths in the library, a folder ends with a slash */
function start(entries = []) {
    env = createEnvironment(Storage);
    const library = path.join(env.root, 'library');
    fs.mkdirSync(library);
    for (const entry of entries) {
        const target = path.join(library, ...entry.split('/'));
        if (entry.endsWith('/')) {
            fs.mkdirSync(target, { recursive: true });
        } else {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, 'x');
        }
    }
    const connector = new FolderConnector();
    connector.config.path.value = library;
    return { connector, library };
}

const ask = (subject, method, ...args) => new Promise(resolve => subject[method](...args, (...answer) => resolve(answer)));
const titles = list => list.map(entry => entry.title.normalize('NFC')).sort();
const addressed = address => decodeURIComponent(new URL(address).pathname);
const addressOf = file => decodeURIComponent(pathToFileURL(file).pathname);
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

async function mangaOf(connector, title) {
    const [, mangas] = await ask(connector, 'getMangas');
    return mangas.find(manga => manga.title === title);
}

describe('FolderConnector', () => {
    it('should present itself as the source of a folder of the device, which the user has to choose', () => {
        const connector = new FolderConnector();
        expect(connector.id).toBe('folder');
        expect(connector.label).toBe(' 【Folder Viewer】');
        expect(connector.icon).toBe('/img/connectors/folder');
        expect(connector.tags).toEqual([]);
        expect(connector.url).toBeUndefined();
        expect(connector.config.path).toMatchObject({ label: 'Manga Folder', input: 'directory', value: '' });
        expect(connector.config.path.description).toContain(connector.label);
    });

    it('should not share its settings with another one', () => {
        const first = new FolderConnector();
        const second = new FolderConnector();
        first.config.path.value = '/library';
        expect(second.config.path.value).toBe('');
    });

    describe('the mangas', () => {
        it('should be the folders of the library, the way the engine knows a manga that is on the device', async () => {
            const { connector, library } = start(['Alpha/', 'Beta/', '日本語 マンガ/', 'With #hash and \'quotes\'/']);
            const [error, mangas] = await ask(connector, 'getMangas');
            expect(error).toBeNull();
            expect(titles(mangas)).toEqual(['Alpha', 'Beta', 'With #hash and \'quotes\'', '日本語 マンガ'].sort());
            for (const manga of mangas) {
                expect(manga).toBeInstanceOf(Manga);
                expect(manga.connector).toBe(connector);
                expect(manga.status).toBe('completed');
                expect(manga.id).toBe(path.join(library, manga.title));
            }
        });

        it('should be listed in the order that the folder lists them in, without a sort of its own', async () => {
            const { connector, library } = start(['b/', 'a/', 'C/', '10/', '2/']);
            const [, mangas] = await ask(connector, 'getMangas');
            expect(mangas.map(manga => manga.title)).toEqual(fs.readdirSync(library));
        });

        it('should be the same when the list is updated, and show what was added since', async () => {
            const { connector, library } = start(['Alpha/']);
            expect(titles((await ask(connector, 'updateMangas'))[1])).toEqual(['Alpha']);
            fs.mkdirSync(path.join(library, 'Beta'));
            expect(titles((await ask(connector, 'updateMangas'))[1])).toEqual(['Alpha', 'Beta']);
            fs.rmdirSync(path.join(library, 'Alpha'));
            expect(titles((await ask(connector, 'getMangas'))[1])).toEqual(['Beta']);
        });

        it('should be none for an empty library, without an error', async () => {
            const { connector } = start();
            await expect(ask(connector, 'getMangas')).resolves.toEqual([null, []]);
        });

        it('should come with their own way to read the chapters, and nothing else changed', async () => {
            const { connector } = start(['Alpha/']);
            const [, [manga]] = await ask(connector, 'getMangas');
            expect(Object.hasOwn(manga, 'getChapters')).toBe(true);
            expect(manga.getChapters).not.toBe(Manga.prototype.getChapters);
            expect(manga.chapterCache).toEqual([]);
            expect(manga.existingChapters).toEqual([]);
        });

        it('should be addressed by the path of the folder, with the separators of the platform', async () => {
            const { connector, library } = start(['Alpha/']);
            connector.config.path.value = library + path.sep;
            const [, [manga]] = await ask(connector, 'getMangas');
            expect(manga.id).toBe(path.join(library, 'Alpha'));
        });

        it('should be refused, with the error, for a library that is not set', async () => {
            const error = quiet();
            const connector = new FolderConnector();
            env = createEnvironment(Storage);
            const [failure, mangas] = await ask(connector, 'getMangas');
            expect(failure).toBeInstanceOf(Error);
            expect(mangas).toEqual([]);
            expect(error).toHaveBeenCalledTimes(1);
            expect(error.mock.calls[0][0]).toBe(failure);
            expect(error.mock.calls[0][1]).toBe(connector);
        });

        it.each([
            ['a folder that is not there', library => path.join(library, 'nothing'), ['ENOENT']],
            ['a file', library => path.join(library, 'a file.txt'), ['ENOTDIR', 'ENOENT']]
        ])('should be refused, with the error, for %s as the library', async (name, locate, codes) => {
            quiet();
            const { connector, library } = start(['a file.txt']);
            connector.config.path.value = locate(library);
            const [failure, mangas] = await ask(connector, 'updateMangas');
            expect(codes).toContain(failure.code);
            expect(mangas).toEqual([]);
        });

        it('should only be the folders of the library', async () => {
            const { connector } = start(['Alpha/', 'readme.txt', 'cover.jpg']);
            expect(titles((await ask(connector, 'getMangas'))[1])).toEqual(['Alpha']);
        });

        it('should not be the hidden folders of the library', async () => {
            const { connector } = start(['Alpha/', '.git/', '.thumbnails/']);
            expect(titles((await ask(connector, 'getMangas'))[1])).toEqual(['Alpha']);
        });
    });

    describe('the chapters', () => {
        it('should be the folders and the archives of the folder of the manga, as they are called', async () => {
            const { connector, library } = start(['Alpha/Chapter 1/001.png', 'Alpha/Chapter 2.cbz', 'Alpha/Vol 3.epub', 'Alpha/Extra/']);
            const manga = await mangaOf(connector, 'Alpha');
            const [error, chapters] = await ask(manga, 'getChapters');
            expect(error).toBeNull();
            expect(titles(chapters)).toEqual(['Chapter 1', 'Chapter 2.cbz', 'Extra', 'Vol 3.epub']);
            for (const chapter of chapters) {
                expect(chapter).toBeInstanceOf(Chapter);
                expect(chapter.manga).toBe(manga);
                expect(chapter.id).toBe(path.join(library, 'Alpha', chapter.title));
                // it is on the device, and nowhere else
                expect(chapter.status).toBe('offline');
                expect(chapter.language).toBeUndefined();
                expect(chapter.file).toEqual({ name: chapter.title, extension: '', full: chapter.title });
                expect(Object.hasOwn(chapter, 'getPages')).toBe(true);
            }
        });

        // NOTE: there is no natural sort: "Chapter 10" comes before "Chapter 2" as the folder lists them, and the chapter
        // panel of the interface sorts on demand
        it('should be listed in the order that the folder lists them in, without a sort of its own', async () => {
            const { connector, library } = start(['Alpha/Chapter 10/', 'Alpha/Chapter 2/', 'Alpha/Chapter 1/']);
            const [, chapters] = await ask(await mangaOf(connector, 'Alpha'), 'getChapters');
            expect(chapters.map(chapter => chapter.title)).toEqual(fs.readdirSync(path.join(library, 'Alpha')));
        });

        it('should only be the folders and the archives of the folder of the manga', async () => {
            const { connector } = start(['Alpha/Chapter 1/001.png', 'Alpha/Chapter 2.cbz', 'Alpha/Vol 3.epub', 'Alpha/.DS_Store', 'Alpha/Thumbs.db', 'Alpha/desktop.ini', 'Alpha/cover.jpg', 'Alpha/notes.txt']);
            const [, chapters] = await ask(await mangaOf(connector, 'Alpha'), 'getChapters');
            expect(titles(chapters)).toEqual(['Chapter 1', 'Chapter 2.cbz', 'Vol 3.epub']);
        });

        it('should be the chapters of that manga only', async () => {
            const { connector } = start(['Alpha/One/', 'Beta/Two/', 'Beta/Three/']);
            expect(titles((await ask(await mangaOf(connector, 'Alpha'), 'getChapters'))[1])).toEqual(['One']);
            expect(titles((await ask(await mangaOf(connector, 'Beta'), 'getChapters'))[1])).toEqual(['Three', 'Two']);
        });

        it('should keep the names of any script and any shape', async () => {
            const names = ['第1話 はじまり 😀', 'Chapter #1 (final); \'x\' 100%', 'été.cbz'];
            const { connector } = start(names.map(name => `Alpha/${name}${name.endsWith('.cbz') ? '' : '/'}`));
            const [, chapters] = await ask(await mangaOf(connector, 'Alpha'), 'getChapters');
            expect(titles(chapters)).toEqual(names.map(name => name.normalize('NFC')).sort());
        });

        it('should be none for an empty folder, without an error', async () => {
            const { connector } = start(['Alpha/']);
            await expect(ask(await mangaOf(connector, 'Alpha'), 'getChapters')).resolves.toEqual([null, []]);
        });

        it('should be refused, with the error, when the folder of the manga is gone', async () => {
            const error = quiet();
            const { connector, library } = start(['Alpha/Chapter 1/']);
            const manga = await mangaOf(connector, 'Alpha');
            fs.rmSync(path.join(library, 'Alpha'), { recursive: true });
            const [failure, chapters] = await ask(manga, 'getChapters');
            expect(failure).toMatchObject({ code: 'ENOENT' });
            expect(chapters).toEqual([]);
            expect(error).toHaveBeenCalledWith(failure, manga);
        });

        it('should be refused, with the error, for a manga that is a file (a folder that was replaced since the list was made)', async () => {
            quiet();
            const { connector, library } = start(['readme.txt']);
            // the list has no files: the manga is made by hand
            const manga = new Manga(connector, path.join(library, 'readme.txt'), 'readme.txt', 'completed');
            manga.getChapters = connector.getChapters.bind(manga);
            const [failure, chapters] = await ask(manga, 'getChapters');
            expect(failure).toBeInstanceOf(Error);
            expect(chapters).toEqual([]);
        });

        it.each([
            ['an object that is none', () => ({})],
            ['the connector itself', connector => connector],
            ['nothing', () => undefined]
        ])('should only be read for a manga, not for %s', async (name, pick) => {
            const { connector } = start();
            const callback = vi.fn();
            connector.getChapters.call(pick(connector), callback);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
            expect(callback.mock.calls[0][0].message).toBe('This method must be used from a <Manga> object\'s context!');
            expect(callback.mock.calls[0][1]).toEqual([]);
        });

        it('should not be read the way a website does it', () => {
            const { connector } = start();
            const callback = vi.fn();
            connector._getChapterList({}, callback);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback.mock.calls[0][0].message).toBe('This method cannot be called from any connector other then <Folder>!');
            expect(callback.mock.calls[0][1]).toEqual([]);
        });
    });

    describe('the pages', () => {
        async function chapterOf(connector, mangaTitle, chapterTitle) {
            const manga = await mangaOf(connector, mangaTitle);
            const [, chapters] = await ask(manga, 'getChapters');
            return chapters.find(chapter => chapter.title === chapterTitle);
        }

        it('should be the pictures of a folder', async () => {
            const { connector, library } = start(['Alpha/Chapter 1/001.png', 'Alpha/Chapter 1/002.jpg', 'Alpha/Chapter 1/p #3.webp']);
            const chapter = await chapterOf(connector, 'Alpha', 'Chapter 1');
            const [error, pages] = await ask(chapter, 'getPages');
            expect(error).toBeNull();
            expect(pages.map(addressed)).toEqual(['001.png', '002.jpg', 'p #3.webp'].map(name => addressOf(path.join(library, 'Alpha', 'Chapter 1', name))));
        });

        it('should be the pictures of an archive, taken out to the temp folder of the engine', async () => {
            const { connector, library } = start(['Alpha/']);
            fs.writeFileSync(path.join(library, 'Alpha', 'Chapter 2.cbz'), zipSync({ '001.png': new Uint8Array(PNG), '002.png': new Uint8Array(PNG), 'ComicInfo.xml': strToU8('<ComicInfo/>') }, { level: 0 }));
            const chapter = await chapterOf(connector, 'Alpha', 'Chapter 2.cbz');
            const [error, pages] = await ask(chapter, 'getPages');
            expect(error).toBeNull();
            expect(pages.map(addressed)).toEqual(['001.png', '002.png'].map(name => addressOf(path.join(env.storage.temp, name))));
            expect([...fs.readFileSync(path.join(env.storage.temp, '001.png'))]).toEqual(PNG);
        });

        it('should be the pictures of an e-book', async () => {
            const { connector, library } = start(['Alpha/']);
            fs.writeFileSync(path.join(library, 'Alpha', 'Vol 3.epub'), zipSync({ 'mimetype': strToU8('application/epub+zip'), 'OEBPS/img/001.png': new Uint8Array(PNG) }, { level: 0 }));
            const chapter = await chapterOf(connector, 'Alpha', 'Vol 3.epub');
            const [error, pages] = await ask(chapter, 'getPages');
            expect(error).toBeNull();
            expect(pages.map(addressed)).toEqual([addressOf(path.join(env.storage.temp, '001.png'))]);
        });

        it('should be none for an empty folder, without an error', async () => {
            const { connector } = start(['Alpha/Chapter 1/']);
            await expect(ask(await chapterOf(connector, 'Alpha', 'Chapter 1'), 'getPages')).resolves.toEqual([null, []]);
        });

        it('should be read from where the entry is, also when the engine would not give it that name', async () => {
            // the engine does not start a name with a blank, so it would look for the folder "Chapter 1"
            const { connector, library } = start(['Alpha/ Chapter 1/001.png']);
            const chapter = await chapterOf(connector, 'Alpha', ' Chapter 1');
            const [error, pages] = await ask(chapter, 'getPages');
            expect(error).toBeNull();
            expect(pages.map(addressed)).toEqual([addressOf(path.join(library, 'Alpha', ' Chapter 1', '001.png'))]);
        });

        it('should be refused, with the error, for a portable document, which cannot be shown', async () => {
            const error = quiet();
            const { connector } = start(['Alpha/Vol 1.pdf']);
            const chapter = await chapterOf(connector, 'Alpha', 'Vol 1.pdf');
            const [failure, pages] = await ask(chapter, 'getPages');
            expect(failure.message).toBe('PDF preview not yet supported!');
            expect(pages).toEqual([]);
            expect(error).toHaveBeenCalledWith(failure, chapter);
        });

        it('should be refused, with the error, for an archive that is damaged', async () => {
            quiet();
            // the file that the test makes of the entry holds no archive
            const { connector } = start(['Alpha/Chapter 1.cbz']);
            const chapter = await chapterOf(connector, 'Alpha', 'Chapter 1.cbz');
            const [failure, pages] = await ask(chapter, 'getPages');
            expect(failure).toBeInstanceOf(Error);
            expect(pages).toEqual([]);
        });

        it('should be refused, with the error, for a folder that is gone', async () => {
            quiet();
            const { connector, library } = start(['Alpha/Chapter 1/001.png']);
            const chapter = await chapterOf(connector, 'Alpha', 'Chapter 1');
            fs.rmSync(path.join(library, 'Alpha', 'Chapter 1'), { recursive: true });
            const [failure, pages] = await ask(chapter, 'getPages');
            expect(failure).toMatchObject({ code: 'ENOENT' });
            expect(pages).toEqual([]);
        });

        it.each([
            ['an object that is none', () => ({})],
            ['the connector itself', connector => connector],
            ['nothing', () => undefined]
        ])('should only be read for a chapter, not for %s', (name, pick) => {
            const { connector } = start();
            const callback = vi.fn();
            connector.getPages.call(pick(connector), callback);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback.mock.calls[0][0].message).toBe('This method must be used from a <Chapter> object\'s context!');
            expect(callback.mock.calls[0][1]).toEqual([]);
        });

        it('should not be read the way a website does it', () => {
            const { connector } = start();
            const callback = vi.fn();
            connector._getPageList({}, {}, callback);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback.mock.calls[0][0].message).toBe('This method cannot be called from any connector other then <Folder>!');
            expect(callback.mock.calls[0][1]).toEqual([]);
        });

        it('should only be the pictures of a folder that holds more', async () => {
            const { connector } = start(['Alpha/Chapter 1/001.png', 'Alpha/Chapter 1/Thumbs.db', 'Alpha/Chapter 1/.DS_Store', 'Alpha/Chapter 1/desktop.ini']);
            const [, pages] = await ask(await chapterOf(connector, 'Alpha', 'Chapter 1'), 'getPages');
            expect(pages).toHaveLength(1);
        });
    });

    describe('what the engine stored itself', () => {
        it.each([
            ['img', 'Chapter 1'],
            ['.cbz', 'Chapter 1.cbz'],
            ['.epub', 'Chapter 1.epub']
        ])('should be shown from the downloads of the format %s, as the mangas, chapters and pages that they were', async (format, stored) => {
            env = createEnvironment(Storage, { settings: { chapterFormat: format } });
            const manga = { title: 'My Manga', connector: { label: 'Site', id: 'site' }, existingChapters: [] };
            await env.storage.saveChapterPages(new Chapter(manga, '/1', 'Chapter 1', 'en', 'available'), [page('image/png', PNG), page('image/jpeg', [9, 9])]);
            const connector = new FolderConnector();
            connector.config.path.value = env.mangas;
            const [, mangas] = await ask(connector, 'getMangas');
            expect(mangas.map(entry => entry.title)).toEqual(['My Manga']);
            const [, chapters] = await ask(mangas[0], 'getChapters');
            expect(chapters.map(chapter => chapter.title)).toEqual([stored]);
            const [error, pages] = await ask(chapters[0], 'getPages');
            expect(error).toBeNull();
            expect(pages.map(address => addressed(address).split('/').pop())).toEqual(['1.png', '2.jpg']);
        });
    });
});
