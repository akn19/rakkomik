// A novel is text. Its chapter reaches the storage as a novel page (Novel.mjs) and is stored as an EPUB or a PDF,
// whatever the format of the chapters of comics is. The files go through an in-memory file system, so a chapter
// that is saved can be read back the way the reader does.
const { unzipSync } = require('fflate');
const { expectWellFormed } = require('./support/wellFormed.js');

let Storage = null;
let Chapter = null;
let Novel = null;

beforeAll(async () => {
    Storage = (await import('../mjs/engine/Storage.mjs')).default;
    Chapter = (await import('../mjs/engine/Chapter.mjs')).default;
    Novel = await import('../mjs/engine/Novel.mjs');
});

afterEach(() => {
    delete globalThis.window;
    delete globalThis.Engine;
    delete globalThis.document;
    delete globalThis.EventListener;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const TEXT = '<p>First &amp; foremost</p>\n<p>Second</p>';
const TITLE = 'Chapter 1: A & B';
const OUTPUT = '/dl/My Novel/Chapter 1: A & B';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]);

function memoryFs() {
    const files = new Map();
    return {
        files,
        mkdir: vi.fn(async () => undefined),
        writeFile: vi.fn(async (path, data) => {
            files.set(path, typeof data === 'string' ? data : new Uint8Array(data));
        }),
        rename: vi.fn(async (from, to) => {
            files.set(to, files.get(from));
            files.delete(from);
        }),
        unlink: vi.fn(async (path) => {
            files.delete(path);
        }),
        readFile: vi.fn(async (path, encoding) => {
            if (!files.has(path)) {
                throw new Error(`ENOENT: ${path}`);
            }
            return encoding ? new TextDecoder().decode(files.get(path)) : files.get(path);
        }),
    };
}

function setup({ chapterFormat = 'img', novelFormat = '.epub', command = '' } = {}) {
    const fs = memoryFs();
    const hakuneko = {
        dialog: {},
        platform: 'linux',
        shell: { showItemInFolder: vi.fn() },
        fs,
        pdf: { render: vi.fn(async (html) => new TextEncoder().encode(`%PDF-1.7 ${html.length}`)) },
        exec: vi.fn(async () => ({})),
        app: { getPath: () => '/userdata' },
        os: { tmpdir: '/tmp' },
    };
    globalThis.window = { hakuneko };
    globalThis.document = { dispatchEvent: vi.fn() };
    globalThis.EventListener = { onChapterStatusChanged: 'chapter-status-changed' };
    const storage = new Storage();
    globalThis.Engine = {
        Storage: storage,
        Settings: {
            baseDirectory: { value: '/dl' },
            useSubdirectory: { value: false },
            chapterFormat: { value: chapterFormat },
            novelFormat: { value: novelFormat },
            postChapterDownloadCommand: { value: command },
        },
        ComicInfoGenerator: { createComicInfoXML: () => '<ComicInfo/>' },
    };
    return { storage, fs, hakuneko };
}

// `existing` lists the files of the directory of the manga; the manga keeps them as a list with the names as keys
function createChapter(status = 'available', existing = []) {
    const manga = {
        title: 'My Novel',
        existingChapters:
            existing && Object.assign([], Object.fromEntries(existing.map((name) => [name, true]))),
        connector: {
            label: 'Novel Site',
            requestOptions: { headers: { referer: 'https://novels.example' } },
        },
    };
    return new Chapter(manga, '/novel/1', TITLE, 'id', status);
}

function novelPage(xhtml = TEXT) {
    return new Blob([xhtml], { type: 'application/xhtml+xml;charset=utf-8' });
}

function imageResponse(bytes, type) {
    return new Response(new Blob([bytes], { type }), { status: 200 });
}

// the compression method of each entry, from the central directory (0: stored, 8: deflated)
function methods(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const result = {};
    let offset = view.getUint32(bytes.length - 22 + 16, true);
    for (let count = view.getUint16(bytes.length - 22 + 10, true); count > 0; count--) {
        const nameLength = view.getUint16(offset + 28, true);
        const name = new TextDecoder().decode(
            bytes.subarray(offset + 46, offset + 46 + nameLength),
        );
        result[name] = view.getUint16(offset + 10, true);
        offset +=
            46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    }
    return result;
}

function entries(fs, path) {
    const archive = unzipSync(fs.files.get(path));
    return {
        archive,
        text: (name) => new TextDecoder().decode(archive[name]),
        names: Object.keys(archive),
    };
}

describe('saving a novel as EPUB', () => {
    it('should store the text as an e-book, whatever the chapter format is', async () => {
        const { storage, fs } = setup({ chapterFormat: '.cbz' });
        await storage.saveChapterPages(createChapter(), [novelPage()]);
        expect([...fs.files.keys()]).toEqual([`${OUTPUT}.epub`]);
        const { names, text } = entries(fs, `${OUTPUT}.epub`);
        expect(names).toEqual([
            'mimetype',
            'META-INF/container.xml',
            'OEBPS/css/style.css',
            'OEBPS/xhtml/chapter.xhtml',
            'OEBPS/content.opf',
            'OEBPS/toc.ncx',
        ]);
        expect(text('mimetype')).toBe('application/epub+zip');
        expect(text('OEBPS/xhtml/chapter.xhtml')).toContain(
            `<body>\n<h1>Chapter 1: A &amp; B</h1>\n${TEXT}\n</body>`,
        );
    });

    it('should store the e-book the way a reader expects it', async () => {
        const { storage, fs } = setup();
        await storage.saveChapterPages(createChapter(), [novelPage()]);
        const bytes = fs.files.get(`${OUTPUT}.epub`);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        // EPUB container rule: `mimetype` is the first entry and stored (compression method 0)
        expect(new TextDecoder().decode(bytes.subarray(30, 38))).toBe('mimetype');
        expect(view.getUint16(8, true)).toBe(0);
        const { text } = entries(fs, `${OUTPUT}.epub`);
        const opf = text('OEBPS/content.opf');
        expect(opf).toContain('<dc:title>My Novel - Chapter 1: A &amp; B</dc:title>');
        expect(opf).toContain('<dc:language>id</dc:language>');
        expect(opf).toContain('href="xhtml/chapter.xhtml"');
        expect(text('OEBPS/toc.ncx')).toContain('<content src="xhtml/chapter.xhtml"/>');
        for (const name of [
            'META-INF/container.xml',
            'OEBPS/xhtml/chapter.xhtml',
            'OEBPS/content.opf',
            'OEBPS/toc.ncx',
        ]) {
            expectWellFormed(text(name).replace(/<\?xml[^>]*>\s*|<!DOCTYPE[^>]*>\s*/g, ''));
        }
    });

    it('should compress the text, but not the pictures', async () => {
        const { storage, fs } = setup();
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => imageResponse(JPEG, 'image/jpeg')),
        );
        await storage.saveChapterPages(createChapter(), [
            novelPage(
                '<p>' +
                    'word '.repeat(2000) +
                    '</p><p><img src="https://cdn.example/a.jpg" alt=""/></p>',
            ),
        ]);
        const bytes = fs.files.get(`${OUTPUT}.epub`);
        expect(methods(bytes)).toEqual({
            mimetype: 0,
            'META-INF/container.xml': 8,
            'OEBPS/css/style.css': 8,
            'OEBPS/img/1.jpg': 0,
            'OEBPS/xhtml/chapter.xhtml': 8,
            'OEBPS/content.opf': 8,
            'OEBPS/toc.ncx': 8,
        });
        expect(bytes.length).toBeLessThan(3000);
    });

    it('should say which language it is in only when it is a language', async () => {
        for (const [language, expected] of [
            ['pt-BR', 'pt-BR'],
            ['en', 'en'],
            ['', 'und'],
            [undefined, 'und'],
            ['English!', 'und'],
            ['x"y', 'und'],
        ]) {
            const { storage, fs } = setup();
            const chapter = createChapter();
            chapter.language = language;
            await storage.saveChapterPages(chapter, [novelPage()]);
            expect(entries(fs, `${OUTPUT}.epub`).text('OEBPS/content.opf')).toContain(
                `<dc:language>${expected}</dc:language>`,
            );
        }
    });

    it('should join the text of several pages', async () => {
        const { storage, fs } = setup();
        await storage.saveChapterPages(createChapter(), [
            novelPage('<p>One</p>'),
            novelPage('<p>Two</p>'),
        ]);
        expect(entries(fs, `${OUTPUT}.epub`).text('OEBPS/xhtml/chapter.xhtml')).toContain(
            '<p>One</p>\n<p>Two</p>',
        );
    });

    it('should tell the manga about the file, because the list of its directory is a snapshot', async () => {
        const { storage } = setup({ chapterFormat: '.cbz' });
        const chapter = createChapter();
        await storage.saveChapterPages(chapter, [novelPage()]);
        expect(chapter.manga.existingChapters['Chapter 1: A & B.epub']).toBe(true);
    });

    it('should run the command that follows a download, with the path of the e-book', async () => {
        const { storage, hakuneko } = setup({ command: 'tag "%PATH%" "%M%"' });
        await storage.saveChapterPages(createChapter(), [novelPage()]);
        expect(hakuneko.exec).toHaveBeenCalledTimes(1);
        expect(hakuneko.exec.mock.calls[0][0]).toBe(`tag "${OUTPUT}.epub" "My Novel"`);
        expect(hakuneko.exec.mock.calls[0][1]).toMatchObject({ cwd: '/dl/My Novel' });
    });

    it('should create the directory of the manga first', async () => {
        const { storage, fs } = setup();
        await storage.saveChapterPages(createChapter(), [novelPage()]);
        expect(fs.mkdir).toHaveBeenCalledWith('/dl/My Novel');
    });

    it('should store a novel with the other formats of a novel too: it is text whatever else is set', async () => {
        for (const chapterFormat of ['img', '.cbz', '.epub']) {
            const { storage, fs } = setup({ chapterFormat });
            await storage.saveChapterPages(createChapter(), [novelPage()]);
            expect([...fs.files.keys()]).toEqual([`${OUTPUT}.epub`]);
        }
    });
});

describe('illustrations of a novel', () => {
    const picture = (source, alt = '') => `<p><img src="${source}" alt="${alt}"/></p>`;

    it('should come along in the e-book, next to the text that refers to them', async () => {
        const { storage, fs } = setup();
        const fetched = vi.fn(async (source) =>
            imageResponse(
                source.endsWith('.png') ? PNG : JPEG,
                source.endsWith('.png') ? 'image/png' : 'image/jpeg',
            ),
        );
        vi.stubGlobal('fetch', fetched);
        const chapter = createChapter();
        await storage.saveChapterPages(chapter, [
            novelPage(
                `<p>Start</p>${picture('https://cdn.example/a.jpg', 'A')}${picture('https://cdn.example/b.png')}${picture('https://cdn.example/a.jpg')}<p>End</p>`,
            ),
        ]);

        // each address is downloaded once, with the request options of the connector
        expect(fetched.mock.calls.map((call) => call[0])).toEqual([
            'https://cdn.example/a.jpg',
            'https://cdn.example/b.png',
        ]);
        expect(fetched.mock.calls[0][1].headers).toEqual({ referer: 'https://novels.example' });
        expect(fetched.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);

        const { names, text, archive } = entries(fs, `${OUTPUT}.epub`);
        expect(names).toEqual(expect.arrayContaining(['OEBPS/img/1.jpg', 'OEBPS/img/2.png']));
        expect(Array.from(archive['OEBPS/img/1.jpg'])).toEqual(Array.from(JPEG));
        expect(Array.from(archive['OEBPS/img/2.png'])).toEqual(Array.from(PNG));
        const xhtml = text('OEBPS/xhtml/chapter.xhtml');
        expect(xhtml).toContain('<img src="../img/1.jpg" alt="A"/>');
        expect(xhtml).toContain('<img src="../img/2.png" alt=""/>');
        expect(xhtml.match(/<img src="\.\.\/img\/1\.jpg"/g)).toHaveLength(2);
        expect(xhtml).not.toContain('cdn.example');
        const opf = text('OEBPS/content.opf');
        expect(opf).toContain('<item id="IMG_0" href="img/1.jpg" media-type="image/jpeg"/>');
        expect(opf).toContain('<item id="IMG_1" href="img/2.png" media-type="image/png"/>');
        expect(opf.match(/<itemref /g)).toHaveLength(1);
    });

    it('should be left out when they fail to download, without failing the chapter', async () => {
        const { storage, fs } = setup();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.stubGlobal(
            'fetch',
            vi.fn(async (source) => {
                if (source.endsWith('missing.jpg')) {
                    return new Response('nope', { status: 404 });
                }
                if (source.endsWith('page.png')) {
                    return new Response(new Blob(['<html>'], { type: 'text/html' }), {
                        status: 200,
                    });
                }
                if (source.endsWith('slow.jpg')) {
                    throw new Error('timeout');
                }
                return imageResponse(JPEG, 'image/jpeg');
            }),
        );
        await storage.saveChapterPages(createChapter(), [
            novelPage(
                `<p>Text</p>${picture('https://cdn.example/missing.jpg')}${picture('https://cdn.example/page.png')}${picture('https://cdn.example/slow.jpg')}${picture('https://cdn.example/ok.jpg')}`,
            ),
        ]);
        const { names, text } = entries(fs, `${OUTPUT}.epub`);
        expect(names.filter((name) => name.startsWith('OEBPS/img/'))).toEqual(['OEBPS/img/1.jpg']);
        const xhtml = text('OEBPS/xhtml/chapter.xhtml');
        expect(xhtml.match(/<img /g)).toHaveLength(1);
        expect(xhtml).toContain('<p>Text</p>');
        expect(console.warn).toHaveBeenCalledTimes(3);
        expectWellFormed(xhtml.replace(/<\?xml[^>]*>\s*|<!DOCTYPE[^>]*>\s*/g, ''));
    });

    it('should not be downloaded when the text has none', async () => {
        const { storage } = setup();
        const fetched = vi.fn();
        vi.stubGlobal('fetch', fetched);
        await storage.saveChapterPages(createChapter(), [novelPage()]);
        expect(fetched).not.toHaveBeenCalled();
    });

    it('should be named with leading zeroes as far as there are pictures', async () => {
        const { storage, fs } = setup();
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => imageResponse(JPEG, 'image/jpeg')),
        );
        const text = Array.from({ length: 12 }, (_, index) =>
            picture(`https://cdn.example/${index}.jpg`),
        ).join('');
        await storage.saveChapterPages(createChapter(), [novelPage(text)]);
        const { names } = entries(fs, `${OUTPUT}.epub`);
        expect(names.filter((name) => name.startsWith('OEBPS/img/')).slice(0, 2)).toEqual([
            'OEBPS/img/01.jpg',
            'OEBPS/img/02.jpg',
        ]);
    });
});

describe('saving a novel as PDF', () => {
    it('should have the main process print the text, and store what it prints', async () => {
        const { storage, fs, hakuneko } = setup({ chapterFormat: '.cbz', novelFormat: '.pdf' });
        await storage.saveChapterPages(createChapter(), [novelPage()]);
        expect([...fs.files.keys()]).toEqual([`${OUTPUT}.pdf`]);
        expect(hakuneko.pdf.render).toHaveBeenCalledTimes(1);
        const html = hakuneko.pdf.render.mock.calls[0][0];
        expect(html).toContain('<title>My Novel - Chapter 1: A &amp; B</title>');
        expect(html).toContain('<h1>Chapter 1: A &amp; B</h1>');
        expect(html).toContain(TEXT);
        expect(html).toContain('<html lang="id">');
        expect(new TextDecoder().decode(fs.files.get(`${OUTPUT}.pdf`))).toBe(
            `%PDF-1.7 ${html.length}`,
        );
    });

    it('should print the illustrations from the page, so the printing needs no network', async () => {
        const { storage, hakuneko } = setup({ novelFormat: '.pdf' });
        vi.stubGlobal(
            'fetch',
            vi.fn(async (source) =>
                source.endsWith('.png')
                    ? imageResponse(PNG, 'image/png')
                    : imageResponse(JPEG, 'image/jpeg'),
            ),
        );
        await storage.saveChapterPages(createChapter(), [
            novelPage(
                '<p>Text</p><p><img src="https://cdn.example/a.jpg" alt="A"/></p><p><img src="https://cdn.example/b.png" alt=""/></p>',
            ),
        ]);
        const html = hakuneko.pdf.render.mock.calls[0][0];
        expect(html).toContain(
            `<img src="data:image/jpeg;base64,${btoa(String.fromCharCode(...JPEG))}" alt="A"/>`,
        );
        expect(html).toContain(
            `<img src="data:image/png;base64,${btoa(String.fromCharCode(...PNG))}" alt=""/>`,
        );
        expect(html).not.toContain('cdn.example');
    });

    it('should not store anything when printing fails', async () => {
        const { storage, fs, hakuneko } = setup({ novelFormat: '.pdf' });
        hakuneko.pdf.render.mockRejectedValue(new Error('Printing failed'));
        const chapter = createChapter();
        await expect(storage.saveChapterPages(chapter, [novelPage()])).rejects.toThrow(
            'Printing failed',
        );
        expect(fs.files.size).toBe(0);
        expect(chapter.manga.existingChapters).toEqual([]);
    });

    it('should fall back to an e-book for a format it does not know', async () => {
        const { storage, fs } = setup({ novelFormat: '.docx' });
        await storage.saveChapterPages(createChapter(), [novelPage()]);
        expect([...fs.files.keys()]).toEqual([`${OUTPUT}.epub`]);
    });
});

describe('saving the pages of a comic', () => {
    it('should still follow the chapter format', async () => {
        const { storage, fs, hakuneko } = setup({ chapterFormat: '.cbz', novelFormat: '.pdf' });
        const chapter = createChapter();
        await storage.saveChapterPages(chapter, [new Blob([PNG], { type: 'image/png' })]);
        expect([...fs.files.keys()]).toEqual([`${OUTPUT}.cbz`]);
        expect(Object.keys(unzipSync(fs.files.get(`${OUTPUT}.cbz`))).sort()).toEqual([
            '1.png',
            'ComicInfo.xml',
        ]);
        expect(hakuneko.pdf.render).not.toHaveBeenCalled();
    });

    it('should not be taken for a novel by the pages around it', async () => {
        const { storage, fs } = setup({ chapterFormat: 'img' });
        await storage.saveChapterPages(createChapter(), [
            new Blob([PNG], { type: 'image/png' }),
            new Blob([JPEG], { type: 'image/jpeg' }),
        ]);
        expect([...fs.files.keys()].sort()).toEqual([`${OUTPUT}/1.png`, `${OUTPUT}/2.jpg`]);
    });

    it('should keep only the text of a list that mixes text and pictures', async () => {
        const { storage, fs } = setup({ chapterFormat: '.cbz' });
        await storage.saveChapterPages(createChapter(), [
            new Blob([PNG], { type: 'image/png' }),
            novelPage(),
        ]);
        expect([...fs.files.keys()]).toEqual([`${OUTPUT}.epub`]);
        expect(
            entries(fs, `${OUTPUT}.epub`).names.some((name) => name.startsWith('OEBPS/img/')),
        ).toBe(false);
    });
});

describe('reading a novel back', () => {
    async function savedNovel(options = {}) {
        const environment = setup(options);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => imageResponse(JPEG, 'image/jpeg')),
        );
        const text = `<p>Start &amp; end</p>\n<p><img src="https://cdn.example/a.jpg" alt="A"/></p>`;
        await environment.storage.saveChapterPages(createChapter(), [novelPage(text)]);
        return environment;
    }

    it('should give the text of the e-book as a novel page, the illustrations as files', async () => {
        const { storage, fs } = await savedNovel({ chapterFormat: '.cbz' });
        const pages = await storage.loadChapterPages(`${OUTPUT}.epub`);
        expect(pages).toHaveLength(1);
        expect(Novel.isNovelPage(pages[0])).toBe(true);
        const text = Novel.readNovelPage(pages[0]);
        expect(text).toContain('<h1>Chapter 1: A &amp; B</h1>');
        expect(text).toContain('<p>Start &amp; end</p>');
        const [source] = Novel.listNovelImages(text);
        expect(source).toMatch(/^file:\/\/\/tmp\/hakuneko\/1\.jpg\?ts=\d+$/);
        expect(Array.from(fs.files.get('/tmp/hakuneko/1.jpg'))).toEqual(Array.from(JPEG));
    });

    it('should leave out an illustration the e-book does not hold', async () => {
        const { storage, fs } = await savedNovel();
        const archive = unzipSync(fs.files.get(`${OUTPUT}.epub`));
        delete archive['OEBPS/img/1.jpg'];
        fs.files.set('/broken.epub', require('fflate').zipSync(archive));
        const text = Novel.readNovelPage((await storage.loadChapterPages('/broken.epub'))[0]);
        expect(text).not.toContain('<img');
        expect(text).toContain('<p>Start &amp; end</p>');
    });

    it('should still give the pictures of an e-book of a comic', async () => {
        const { storage, fs } = setup();
        await storage._saveChapterPagesEPUB('/dl/Comic/Chapter 1.epub', [
            { name: '001.png', type: 'image/png', data: new Blob([PNG], { type: 'image/png' }) },
            { name: '002.png', type: 'image/png', data: new Blob([PNG], { type: 'image/png' }) },
        ]);
        const pages = await storage.loadChapterPages('/dl/Comic/Chapter 1.epub');
        expect(pages).toHaveLength(2);
        expect(
            pages.every((page) => /^file:\/\/\/tmp\/hakuneko\/00[12]\.png\?ts=\d+$/.test(page)),
        ).toBe(true);
        expect(fs.files.has('/tmp/hakuneko/001.png')).toBe(true);
    });

    it('should find the novel of a chapter that is stored in another format than the chapters of comics', async () => {
        const { storage } = await savedNovel({ chapterFormat: '.cbz' });
        const chapter = createChapter('completed', ['Chapter 1: A & B.epub']);
        const pages = await storage.loadChapterPages(chapter);
        expect(Novel.isNovelPage(pages[0])).toBe(true);
    });

    it('should not read a portable document back', async () => {
        const { storage } = setup();
        await expect(storage.loadChapterPages('/dl/My Novel/Chapter 1.pdf')).rejects.toThrow(
            'PDF preview not yet supported!',
        );
    });
});

describe('where a chapter that is on the device is', () => {
    function pathOf(settings, existing, status) {
        const { storage } = setup(settings);
        return storage._downloadedChapterPath(createChapter(status, existing));
    }

    it('should be the file of the chapter format, when the directory holds it', () => {
        expect(pathOf({ chapterFormat: '.cbz' }, ['Chapter 1: A & B.cbz'])).toBe(`${OUTPUT}.cbz`);
        expect(
            pathOf({ chapterFormat: '.cbz' }, ['Chapter 1: A & B.cbz', 'Chapter 1: A & B.epub']),
        ).toBe(`${OUTPUT}.cbz`);
        expect(pathOf({ chapterFormat: 'img' }, ['Chapter 1: A & B'])).toBe(OUTPUT);
    });

    it('should be the novel, when the directory holds only that', () => {
        expect(pathOf({ chapterFormat: '.cbz' }, ['Chapter 1: A & B.epub'])).toBe(`${OUTPUT}.epub`);
        expect(
            pathOf({ chapterFormat: 'img', novelFormat: '.pdf' }, ['Chapter 1: A & B.pdf']),
        ).toBe(`${OUTPUT}.pdf`);
    });

    it('should be the file of the chapter format, when the directory holds neither or nothing is known', () => {
        expect(pathOf({ chapterFormat: '.cbz' }, [])).toBe(`${OUTPUT}.cbz`);
        expect(pathOf({ chapterFormat: '.cbz' }, ['Chapter 1: A & B.pdf'])).toBe(`${OUTPUT}.cbz`);
        expect(pathOf({ chapterFormat: '.cbz' }, null)).toBe(`${OUTPUT}.cbz`);
    });

    it('should be the file itself for a chapter that is only in the directory', () => {
        expect(pathOf({ chapterFormat: '.cbz' }, ['Chapter 1: A & B.epub'], 'offline')).toBe(
            '/dl/My Novel/Chapter 1: A & B',
        );
    });

    it('should be what is shown when the chapter is shown in its folder', async () => {
        const { storage, hakuneko } = setup({ chapterFormat: '.cbz' });
        storage.showFolderContent(createChapter('completed', ['Chapter 1: A & B.epub']));
        expect(hakuneko.shell.showItemInFolder).toHaveBeenCalledWith(`${OUTPUT}.epub`);
    });
});
