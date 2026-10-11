// The chapter: the name of its file, its status (is it on the device?) and its pages, which come from the files of the
// device for a chapter that was downloaded and from the website for any other, and are kept once they are known.
// Which files of a directory belong to a chapter is covered by ChapterFiles.test.js.
const { createEngine, installPage } = require('./support/coreFakes.js');

let Connector = null;
let Manga = null;
let Chapter = null;
let Enums = null;
let Storage = null;

let engine = null;
let page = null;

beforeAll(async () => {
    Connector = (await import('../mjs/engine/Connector.mjs')).default;
    Manga = (await import('../mjs/engine/Manga.mjs')).default;
    Chapter = (await import('../mjs/engine/Chapter.mjs')).default;
    Enums = (await import('../mjs/engine/Enums.mjs')).default;
    Storage = (await import('../mjs/engine/Storage.mjs')).default;
});

beforeEach(() => {
    engine = createEngine({ Storage, chapterFormat: '.cbz' });
    page = installPage({ engine, EventListener: Enums.EventListener });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// A website that offers the given pages (the interface of the connectors: `_getPages`)
function createSite(pages = ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg']) {
    const site = new Connector();
    site.id = 'site';
    site.label = 'Site';
    site.url = 'https://site.test';
    site.initialized = true;
    site._getPages = vi.fn(async () => pages);
    return site;
}

function createChapter({ site = createSite(), title = 'Chapter 1', status = 'available' } = {}) {
    const manga = new Manga(site, '/manga/1', 'Manga', 'available');
    return new Chapter(manga, '/chapter/1', title, 'en', status);
}

function getPages(chapter) {
    return new Promise(resolve => chapter.getPages((error, pages) => resolve({ error, pages })));
}

describe('a chapter', () => {
    it('should keep what it is made of', () => {
        const manga = new Manga(createSite(), '/manga/1', 'Manga', 'available');
        const chapter = new Chapter(manga, '/chapter/1', 'Chapter 1', 'fr', 'available');
        expect(chapter).toBeInstanceOf(EventTarget);
        expect(chapter).toMatchObject({ manga, id: '/chapter/1', title: 'Chapter 1', language: 'fr', status: 'available', pageProcess: false });
        expect(chapter.pageCache).toBeUndefined();
    });

    // the file name is made like Storage makes the names of the files and the directories, for the platform of the user
    it.each([
        [ 'Vol 1/Chapter 2: Hi?', 'Vol 1Chapter 2: Hi?', 'linux' ],
        [ 'Vol 1/Chapter 2: Hi?', 'Vol 1Chapter 2 Hi?', 'darwin' ],
        [ 'Vol 1/Chapter 2: Hi?', 'Vol 1Chapter 2 Hi', 'win32' ],
        [ 'The end...  ', 'The end', 'linux' ]
    ])('should store the title "%s" in a file called "%s" on %s', (title, name, platform) => {
        engine = createEngine({ Storage, platform, chapterFormat: '.cbz' });
        vi.stubGlobal('Engine', engine);
        expect(createChapter({ title }).file).toMatchObject({ name, extension: '.cbz', full: name + '.cbz' });
    });
});

describe('the status of a chapter', () => {
    it('should stay unknown without a manga', () => {
        const chapter = new Chapter(undefined, '/chapter/1', 'Chapter 1', 'en');
        expect(chapter.status).toBeUndefined();
        expect(page.events).toEqual([]);
        chapter.updateStatus();
        expect(chapter.status).toBeUndefined();
    });

    it('should be announced to the page when the chapter is made without one', () => {
        const manga = new Manga(createSite(), '/manga/1', 'Manga', 'available');
        const chapter = new Chapter(manga, '/chapter/1', 'Chapter 1', 'en');
        expect(chapter.status).toBe('available');
        expect(page.events).toEqual([{ type: 'onChapterStatusChanged', detail: chapter }]);
    });

    it('should not be announced when the chapter is made with one', () => {
        createChapter({ status: 'completed' });
        expect(page.events).toEqual([]);
    });

    it.each(['queued', 'downloading', 'failed', 'offline'])('should stay %s when the status is updated', status => {
        const chapter = createChapter({ status });
        chapter.manga.existingChapters = Object.assign([], { 'Chapter 1.cbz': true });
        chapter.updateStatus();
        expect(chapter.status).toBe(status);
        expect(page.events).toEqual([]);
    });

    it('should be announced to the chapter and the page when it changes, and only then', () => {
        const chapter = createChapter();
        const own = vi.fn();
        chapter.addEventListener('updated', own);

        chapter.setStatus('queued');
        expect(chapter.status).toBe('queued');
        expect(own).toHaveBeenCalledTimes(1);
        expect(own.mock.calls[0][0].detail).toBe(chapter);
        expect(page.events).toEqual([{ type: 'onChapterStatusChanged', detail: chapter }]);

        chapter.setStatus('queued');
        expect(own).toHaveBeenCalledTimes(1);
        expect(page.events).toHaveLength(1);
    });
});

describe('the pages of a chapter', () => {
    it('should be asked for after the page is told that the chapter is selected', async () => {
        const site = createSite();
        const chapter = createChapter({ site });
        let events = null;
        site._getPages.mockImplementation(async () => {
            events = page.events.map(event => event.type);
            return ['https://cdn.test/1.jpg'];
        });
        await getPages(chapter);
        expect(events).toEqual(['onSelectChapter']);
        expect(page.events[0].detail).toBe(chapter);
    });

    it('should be told that the chapter is selected, whatever the status of the chapter is', async () => {
        engine.Storage.loadChapterPages.mockResolvedValue([]);
        for (const status of ['available', 'completed', 'offline']) {
            page.events.length = 0;
            await getPages(createChapter({ status }));
            expect(page.events.map(event => event.type)).toContain('onSelectChapter');
        }
    });

    describe('of a chapter on the device', () => {
        it.each(['completed', 'offline'])('should be read from its files when it is %s', async status => {
            const site = createSite();
            site.initialize = vi.fn();
            const chapter = createChapter({ site, status });
            engine.Storage.loadChapterPages.mockResolvedValue(['file:///data/1.jpg', 'file:///data/2.jpg']);
            const { error, pages } = await getPages(chapter);
            expect(error).toBeNull();
            expect(pages).toEqual(['file:///data/1.jpg', 'file:///data/2.jpg']);
            expect(engine.Storage.loadChapterPages).toHaveBeenCalledWith(chapter);
            expect(site._getPages).not.toHaveBeenCalled();
            expect(site.initialize).not.toHaveBeenCalled();
        });

        it('should be reported with the error when the files cannot be read', async () => {
            const chapter = createChapter({ status: 'completed' });
            const failure = new Error('EACCES: permission denied');
            engine.Storage.loadChapterPages.mockRejectedValue(failure);
            const { error, pages } = await getPages(chapter);
            expect(error).toBe(failure);
            expect(pages).toBeUndefined();
            expect(console.error).toHaveBeenCalledWith(failure, chapter);
        });

        it('should be read from the files, not taken from the cache, once the chapter was downloaded', async () => {
            const chapter = createChapter();
            await getPages(chapter);
            expect(chapter.pageCache).toHaveLength(2);

            chapter.setStatus('completed');
            engine.Storage.loadChapterPages.mockResolvedValue(['file:///data/1.jpg']);
            const { pages } = await getPages(chapter);
            expect(pages).toEqual(['file:///data/1.jpg']);
        });
    });

    describe('of a chapter that is on the website', () => {
        it.each([
            [ 'without a status', undefined ],
            [ 'that is available', 'available' ],
            [ 'that is queued for a download', 'queued' ],
            [ 'of which the download failed', 'failed' ]
        ])('should ask the connector for the pages of a chapter %s', async (name, status) => {
            const site = createSite(['https://cdn.test/a.jpg']);
            const chapter = createChapter({ site, status });
            const { error, pages } = await getPages(chapter);
            expect(error).toBeNull();
            expect(pages).toEqual(['https://cdn.test/a.jpg']);
            expect(site._getPages).toHaveBeenCalledWith(chapter);
            expect(engine.Storage.loadChapterPages).not.toHaveBeenCalled();
        });

        it('should be asked for after the connector is initialized', async () => {
            const site = createSite();
            const order = [];
            site.initialized = false;
            site._initializeConnector = vi.fn(async () => order.push('initialize'));
            site._getPages = vi.fn(async () => {
                order.push('pages');
                return ['https://cdn.test/1.jpg'];
            });
            await getPages(createChapter({ site }));
            expect(order).toEqual(['initialize', 'pages']);
        });

        it('should be kept, and not asked for again', async () => {
            const site = createSite();
            const chapter = createChapter({ site });
            const first = await getPages(chapter);
            const second = await getPages(chapter);
            expect(site._getPages).toHaveBeenCalledTimes(1);
            expect(second.pages).toEqual(first.pages);
            expect(chapter.pageCache).toEqual(first.pages);
        });

        // the images of the image CDN of WordPress are loaded from the site that they belong to
        it.each([
            [ 'https://i0.wp.com/cdn.test/a.jpg', 'https://cdn.test/a.jpg' ],
            [ 'https://i12.wp.com/cdn.test/a.jpg?w=500', 'https://cdn.test/a.jpg?w=500' ],
            [ 'https://cdn.test/a.jpg', 'https://cdn.test/a.jpg' ],
            [ 'https://wp.com/a.jpg', 'https://wp.com/a.jpg' ],
            [ 'https://cdn.test/imgi0.wp.com/a.jpg', 'https://cdn.test/imgi0.wp.com/a.jpg' ]
        ])('should turn the page "%s" into "%s"', async (address, expected) => {
            const { pages } = await getPages(createChapter({ site: createSite([address]) }));
            expect(pages).toEqual([expected]);
        });

        it('should hand out the pages of a connector that still hands them out through a callback', async () => {
            const site = createSite();
            site._getPageList = vi.fn((manga, chapter, callback) => callback(null, ['https://cdn.test/old.jpg']));
            const chapter = createChapter({ site });
            const { error, pages } = await getPages(chapter);
            expect(error).toBeNull();
            expect(pages).toEqual(['https://cdn.test/old.jpg']);
            expect(site._getPageList.mock.calls[0].slice(0, 2)).toEqual([chapter.manga, chapter]);
        });

        it('should hand out content that is not a list as it is', async () => {
            const { error, pages } = await getPages(createChapter({ site: createSite('https://cdn.test/video.mp4') }));
            expect(error).toBeNull();
            expect(pages).toBe('https://cdn.test/video.mp4');
        });

        it('should be reported as missing when the website has none, and be asked for again later', async () => {
            const site = createSite([]);
            const chapter = createChapter({ site, title: 'Chapter 7' });
            const first = await getPages(chapter);
            expect(first.error).toEqual(expect.objectContaining({ message: 'There was no content found for \'Chapter 7\', make sure it is accessible (login, purchase, ...)!' }));
            expect(first.pages).toEqual([]);
            expect(chapter.pageCache).toEqual([]);

            site._getPages.mockResolvedValue(['https://cdn.test/1.jpg']);
            const second = await getPages(chapter);
            expect(second.error).toBeNull();
            expect(second.pages).toEqual(['https://cdn.test/1.jpg']);
            expect(site._getPages).toHaveBeenCalledTimes(2);
        });

        it('should be reported with the error of the connector, and be asked for again later', async () => {
            const site = createSite();
            const failure = new Error('login required');
            site._getPages.mockRejectedValueOnce(failure);
            const chapter = createChapter({ site });
            const first = await getPages(chapter);
            expect(first.error).toBe(failure);
            expect(first.pages).toEqual([]);
            expect(chapter.pageCache).toEqual([]);

            const second = await getPages(chapter);
            expect(second.error).toBeNull();
            expect(second.pages).toHaveLength(2);
        });

        it('should be reported with the error when the connector cannot start', async () => {
            const site = createSite();
            const failure = new Error('no window');
            site.initialized = false;
            site._initializeConnector = vi.fn(async () => {
                throw failure;
            });
            const { error, pages } = await getPages(createChapter({ site }));
            expect(error).toBe(failure);
            expect(pages).toBeUndefined();
            expect(site._getPages).not.toHaveBeenCalled();
        });

        it('should be the same for two callers who ask at the same time', async () => {
            const chapter = createChapter();
            const [first, second] = await Promise.all([getPages(chapter), getPages(chapter)]);
            expect(first.error).toBeNull();
            expect(second.error).toBeNull();
            expect(first.pages).toEqual(['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg']);
            expect(second.pages).toEqual(first.pages);
            expect(chapter.pageCache).toEqual(first.pages);
        });
    });
});
