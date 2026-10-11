// The manga: whether it is on the device, the chapters that it gets from the website and keeps, how the files of its
// directory show up between them, and the format of the titles of the chapters (a setting of the user).
const { createEngine, installPage, directoryListing } = require('./support/coreFakes.js');

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

// A website that offers the given chapters (the interface of the connectors: `_getChapters`)
function createSite(chapters = []) {
    const site = new Connector();
    site.id = 'site';
    site.label = 'Site';
    site.url = 'https://site.test';
    site.initialized = true;
    site._getChapters = vi.fn(async () => chapters);
    return site;
}

function createManga(site = createSite(), title = 'One Piece', status = 'available') {
    return new Manga(site, '/manga/one-piece', title, status);
}

function listChapters(manga) {
    return new Promise(resolve => manga.getChapters((error, chapters) => resolve({ error, chapters })));
}

function summary(chapters) {
    return chapters.map(chapter => [chapter.id, chapter.title, chapter.status]);
}

const ONE = { id: '/chapter/1', title: 'Chapter 1', language: 'en' };
const TWO = { id: '/chapter/2', title: 'Chapter 2', language: 'en' };

describe('a manga', () => {
    it('should keep what it is made of and start without chapters', () => {
        const site = createSite();
        const manga = new Manga(site, '/manga/1', 'Title', 'available');
        expect(manga).toBeInstanceOf(EventTarget);
        expect(manga.connector).toBe(site);
        expect(manga.id).toBe('/manga/1');
        expect(manga.title).toBe('Title');
        expect(manga.status).toBe('available');
        expect(manga.chapterCache).toEqual([]);
        expect(manga.existingChapters).toEqual([]);
    });

    it('should not share its cache with other mangas', () => {
        const [first, second] = [createManga(), createManga()];
        first.chapterCache.push('chapter');
        first.existingChapters['file'] = true;
        expect(second.chapterCache).toEqual([]);
        expect(second.existingChapters.file).toBeUndefined();
    });
});

describe('the status of a manga', () => {
    it.each([
        [ 'completed when a directory of that name is in the directory of the connector', 'One Piece', directoryListing('One Piece', 'Naruto'), 'completed' ],
        [ 'available when no directory has that name', 'One Piece', directoryListing('Naruto'), 'available' ],
        [ 'available when the connector has no directories at all', 'One Piece', directoryListing(), 'available' ],
        [ 'completed when the directory is named without what a path must not hold', 'AC/DC', directoryListing('ACDC'), 'completed' ],
        [ 'available when a directory differs from the title in case', 'One Piece', directoryListing('one piece'), 'available' ]
    ])('should be %s', (name, title, existingMangas, expected) => {
        const site = createSite();
        site.existingMangas = existingMangas;
        expect(new Manga(site, '/manga/1', title).status).toBe(expected);
    });

    it('should stay unknown without a connector', () => {
        expect(new Manga(undefined, '/manga/1', 'Title').status).toBeUndefined();
        expect(page.events).toEqual([]);
    });

    it('should stay unknown while the connector has not looked at its directory', () => {
        const site = createSite();
        site.existingMangas = undefined;
        expect(new Manga(site, '/manga/1', 'Title').status).toBeUndefined();
    });

    it('should be the one that the manga was made with, without a look at the directory', () => {
        const site = createSite();
        site.existingMangas = directoryListing('Title');
        const manga = new Manga(site, '/manga/1', 'Title', 'offline');
        expect(manga.status).toBe('offline');
        expect(page.events).toEqual([]);
    });

    it('should be announced to the page when the manga is made without one', () => {
        const manga = new Manga(createSite(), '/manga/1', 'Title');
        expect(page.events).toEqual([{ type: 'onMangaStatusChanged', detail: manga }]);
    });

    it('should follow the directory when it is updated', () => {
        const site = createSite();
        const manga = new Manga(site, '/manga/1', 'Title');
        expect(manga.status).toBe('available');
        site.existingMangas = directoryListing('Title');
        manga.updateStatus();
        expect(manga.status).toBe('completed');
        site.existingMangas = directoryListing();
        manga.updateStatus();
        expect(manga.status).toBe('available');
    });

    it('should be announced to the manga and the page when it changes, and only then', () => {
        const manga = createManga();
        const own = vi.fn();
        manga.addEventListener('updated', own);

        manga.setStatus('completed');
        expect(manga.status).toBe('completed');
        expect(own).toHaveBeenCalledTimes(1);
        expect(own.mock.calls[0][0].detail).toBe(manga);
        expect(page.events).toEqual([{ type: 'onMangaStatusChanged', detail: manga }]);

        manga.setStatus('completed');
        expect(own).toHaveBeenCalledTimes(1);
        expect(page.events).toHaveLength(1);

        manga.setStatus('available');
        expect(own).toHaveBeenCalledTimes(2);
        expect(page.events).toHaveLength(2);
    });
});

describe('the chapters of a manga', () => {
    it('should come from the website, as chapters of the manga, in the order of the website', async () => {
        const site = createSite([TWO, { ...ONE, language: 'fr' }]);
        const manga = createManga(site);
        const { error, chapters } = await listChapters(manga);
        expect(error).toBeNull();
        expect(chapters).toBe(manga.chapterCache);
        expect(summary(chapters)).toEqual([['/chapter/2', 'Chapter 2', 'available'], ['/chapter/1', 'Chapter 1', 'available']]);
        expect(chapters.map(chapter => chapter.language)).toEqual(['en', 'fr']);
        for (const chapter of chapters) {
            expect(chapter).toBeInstanceOf(Chapter);
            expect(chapter.manga).toBe(manga);
        }
        expect(site._getChapters).toHaveBeenCalledWith(manga);
    });

    it('should be asked of the website only after the connector is initialized', async () => {
        const site = createSite([ONE]);
        const order = [];
        site.initialized = false;
        site._initializeConnector = vi.fn(async () => order.push('initialize'));
        site._getChapters = vi.fn(async () => {
            order.push('chapters');
            return [ONE];
        });
        await listChapters(createManga(site));
        expect(order).toEqual(['initialize', 'chapters']);
    });

    it('should be asked of a connector that still hands them out through a callback', async () => {
        const site = createSite();
        site._getChapterList = vi.fn((manga, callback) => callback(null, [ONE]));
        const manga = createManga(site);
        const { error, chapters } = await listChapters(manga);
        expect(error).toBeNull();
        expect(summary(chapters)).toEqual([['/chapter/1', 'Chapter 1', 'available']]);
        expect(site._getChapterList.mock.calls[0][0]).toBe(manga);
    });

    it('should be completed when their file is in the directory of the manga, in the format of the chapters or of novels', async () => {
        engine.Storage.existingChapters = directoryListing('Chapter 1.cbz', 'Chapter 2.epub');
        const manga = createManga(createSite([ONE, TWO, { id: '/chapter/3', title: 'Chapter 3' }]));
        const { chapters } = await listChapters(manga);
        expect(summary(chapters)).toEqual([['/chapter/1', 'Chapter 1', 'completed'], ['/chapter/2', 'Chapter 2', 'completed'], ['/chapter/3', 'Chapter 3', 'available']]);
        expect(manga.existingChapters['Chapter 1.cbz']).toBe(true);
    });

    it('should list the other files of the directory as chapters that cannot be downloaded', async () => {
        engine.Storage.existingChapters = directoryListing('Chapter 1.cbz', 'Special.cbz', 'Old chapter');
        const manga = createManga(createSite([ONE]));
        const { error, chapters } = await listChapters(manga);
        expect(error).toBeNull();
        expect(summary(chapters)).toEqual([['/chapter/1', 'Chapter 1', 'completed'], ['Special.cbz', 'Special.cbz', 'offline'], ['Old chapter', 'Old chapter', 'offline']]);
        expect(chapters[1].language).toBeUndefined();
        expect(chapters[1].file).toEqual({ name: 'Special.cbz', extension: '', full: 'Special.cbz' });
    });

    it('should be the files of the directory alone when the website offers none', async () => {
        engine.Storage.existingChapters = directoryListing('Special.cbz');
        const { chapters } = await listChapters(createManga(createSite([])));
        expect(summary(chapters)).toEqual([['Special.cbz', 'Special.cbz', 'offline']]);
    });

    it('should be titled as the user wants them to be', async () => {
        engine.Settings.chapterTitleFormat.value = '%CH% %T%';
        const manga = createManga(createSite([{ id: '/chapter/7', title: 'Chapter 7: Rain' }]));
        const { chapters } = await listChapters(manga);
        expect(chapters[0].title).toBe('0007 Rain');
        // the file of the chapter is named after the title that the user sees
        expect(chapters[0].file.name).toBe('0007 Rain');
    });

    it('should be kept, and not asked of the website again', async () => {
        const site = createSite([ONE]);
        const manga = createManga(site);
        const first = await listChapters(manga);
        const second = await listChapters(manga);
        expect(site._getChapters).toHaveBeenCalledTimes(1);
        expect(second.chapters).toBe(first.chapters);
    });

    it('should show which of them are on the device every time they are asked for', async () => {
        const manga = createManga(createSite([ONE, TWO]));
        await listChapters(manga);
        expect(manga.chapterCache.map(chapter => chapter.status)).toEqual(['available', 'available']);

        engine.Storage.existingChapters = directoryListing('Chapter 1.cbz');
        const downloaded = await listChapters(manga);
        expect(downloaded.chapters.map(chapter => chapter.status)).toEqual(['completed', 'available']);

        engine.Storage.existingChapters = directoryListing();
        const removed = await listChapters(manga);
        expect(removed.chapters.map(chapter => chapter.status)).toEqual(['available', 'available']);
    });

    it('should not list a file of the directory twice, however often they are asked for', async () => {
        engine.Storage.existingChapters = directoryListing('Special.cbz');
        const manga = createManga(createSite([ONE]));
        for (let round = 0; round < 3; round++) {
            const { chapters } = await listChapters(manga);
            expect(chapters.filter(chapter => chapter.id === 'Special.cbz')).toHaveLength(1);
        }
        expect(manga.chapterCache).toHaveLength(2);
    });

    it('should be asked of the website again as long as the cache holds nothing to download', async () => {
        engine.Storage.existingChapters = directoryListing('Old.cbz');
        const site = createSite([ONE]);
        site._getChapters.mockRejectedValueOnce(new Error('site down'));
        const manga = createManga(site);

        const offline = await listChapters(manga);
        expect(summary(offline.chapters)).toEqual([['Old.cbz', 'Old.cbz', 'offline']]);

        const online = await listChapters(manga);
        expect(site._getChapters).toHaveBeenCalledTimes(2);
        expect(summary(online.chapters)).toEqual([['/chapter/1', 'Chapter 1', 'available'], ['Old.cbz', 'Old.cbz', 'offline']]);
    });

    it('should be the files of the directory alone when the website cannot be reached', async () => {
        engine.Storage.existingChapters = directoryListing('Chapter 1.cbz');
        const site = createSite();
        site._getChapters.mockRejectedValue(new Error('site down'));
        const { error, chapters } = await listChapters(createManga(site));
        // NOTE: the failure of the website is only logged, the caller cannot tell it from a manga without chapters
        expect(error).toBeNull();
        expect(summary(chapters)).toEqual([['Chapter 1.cbz', 'Chapter 1.cbz', 'offline']]);
        expect(console.warn).toHaveBeenCalledWith('_getUpdatedChaptersFromWebsite', expect.objectContaining({ message: 'site down' }));
    });

    it('should be empty when there is neither a website nor a directory', async () => {
        engine.Storage.existingChapters = null;
        const site = createSite();
        site._getChapters.mockRejectedValue(new Error('site down'));
        const { error, chapters } = await listChapters(createManga(site));
        expect(error).toBeNull();
        expect(chapters).toEqual([]);
    });

    it('should not need the directory of the manga to exist', async () => {
        engine.Storage.existingChapters = null;
        const manga = createManga(createSite([ONE]));
        const { error, chapters } = await listChapters(manga);
        expect(error).toBeNull();
        expect(summary(chapters)).toEqual([['/chapter/1', 'Chapter 1', 'available']]);
        expect(manga.existingChapters).toEqual([]);
    });

    it('should be the files of the directory alone when the connector cannot start', async () => {
        engine.Storage.existingChapters = directoryListing('Old.cbz');
        const site = createSite([ONE]);
        site.initialized = false;
        site._initializeConnector = vi.fn(async () => {
            throw new Error('no window');
        });
        const { error, chapters } = await listChapters(createManga(site));
        expect(error).toBeNull();
        expect(summary(chapters)).toEqual([['Old.cbz', 'Old.cbz', 'offline']]);
        expect(site._getChapters).not.toHaveBeenCalled();
    });

    it('should be reported with the error, and the cache, when the status of a cached chapter cannot be told', async () => {
        const manga = createManga(createSite([ONE]));
        await listChapters(manga);
        manga.chapterCache[0].updateStatus = () => {
            throw new Error('broken chapter');
        };
        const { error, chapters } = await listChapters(manga);
        expect(error).toEqual(expect.objectContaining({ message: 'broken chapter' }));
        expect(chapters).toBe(manga.chapterCache);
        expect(console.warn).toHaveBeenCalledWith('getChapters', error);
    });

    it('should be complete for two callers who ask at the same time', async () => {
        engine.Storage.existingChapters = directoryListing('Old.cbz');
        const site = createSite([ONE, TWO]);
        const manga = createManga(site);
        const [first, second] = await Promise.all([listChapters(manga), listChapters(manga)]);
        for (const { error, chapters } of [first, second]) {
            expect(error).toBeNull();
            expect(chapters.map(chapter => chapter.id)).toEqual(['/chapter/1', '/chapter/2', 'Old.cbz']);
        }
        expect(manga.chapterCache.map(chapter => chapter.id)).toEqual(['/chapter/1', '/chapter/2', 'Old.cbz']);
    });
});

describe('the title of a chapter', () => {
    // the patterns of the connectors are what the formats are meant for
    function format(title, pattern, { manga = 'One Piece', connector = 'Site' } = {}) {
        const site = createSite();
        site.label = connector;
        return createManga(site, manga).formatChapterTitle(title, pattern, site.getFormatRegex());
    }

    // [format, title, what the format makes of it]
    it.each([
        // the number of the chapter, filled up with zeros to four digits
        [ '%CH%', 'Chapter 12', '0012' ],
        [ '%CH%', 'Chapter 7', '0007' ],
        [ '%CH%', 'Chapter 1234567', '1234567' ],
        [ '%CH%', 'Chapter 12.5', '0012.5' ],
        [ '%CH%', '12', '0012' ],
        [ '%CH% %T%', '#12 Title', '0012 Title' ],
        [ '%CH%', 'Episode 3.5', '0003.5' ],
        [ '%CH% %T%', 'Capítulo 7: Hola', '0007 Hola' ],
        // the number of the volume, filled up with zeros to three digits
        [ '%VOL%-%CH%', 'Vol.2 Chapter 15', '002-0015' ],
        [ '%VOL% %CH% %T%', 'Volume 3 Ch. 7.5: Rain', '003 0007.5 Rain' ],
        // the title without the numbers, and the title as it is
        [ '%T%', 'Volume 3 Ch. 7: Rain', 'Rain' ],
        [ '%T%', 'Chapter 7: Rain   ', 'Rain' ],
        [ '%O%', 'Volume 3 Ch. 7: Rain', 'Volume 3 Ch. 7: Rain' ],
        // the name of the manga and of the website
        [ '%M% / %C%', 'Chapter 5', 'One Piece / Site' ],
        // numbers that are not there
        [ '%VOL%/%CH%/%T%', 'The end', '000/0000/The end' ],
        [ '%CH%', '', '0000' ],
        // the shape of the format
        [ '%ch% %t%', 'Chapter 12: Rain', '0012 Rain' ],
        [ '[%M%] c%CH% (%T%)', 'Chapter 12: Rain', '[One Piece] c0012 (Rain)' ],
        [ '%CH% %X% 100%', 'Chapter 12', '0012 %X% 100%' ],
        [ 'fixed', 'Chapter 12', 'fixed' ]
    ])('should turn the format "%s" and the title "%s" into "%s"', (pattern, title, expected) => {
        expect(format(title, pattern)).toBe(expected);
    });

    // a connector may bring patterns of its own (see getFormatRegex), which are not bound to have a group for the number
    it.each([
        [ 'a pattern without a group', 'Vol 2 Ch 7', { volumeRegex: /vol \d+/i, chapterRegex: /ch \d+/i } ],
        [ 'a pattern with a group that does not take part', 'tome part', { volumeRegex: /(?:vol (\d+))|tome/i, chapterRegex: /(?:ch (\d+))|part/i } ]
    ])('should use zeros for the numbers, and drop what matches, when the connector has %s', (name, title, formatRegex) => {
        const manga = createManga(createSite(), 'One Piece');
        expect(manga.formatChapterTitle(title, '%VOL%/%CH%/%T%', formatRegex)).toBe('000/0000/');
    });

    it('should stay as it came when the user did not ask for a format', () => {
        expect(format('Volume 3 Ch. 7: Rain', '')).toBe('Volume 3 Ch. 7: Rain');
    });

    it('should keep unicode and long titles', () => {
        const long = 'x'.repeat(5000);
        expect(format(`Chapter 9: 漫画 ${long} 🙂`, '%CH% %T%')).toBe(`0009 漫画 ${long} 🙂`);
    });

    // NOTE: only the first of equal placeholders is replaced, which may or may not be wanted
    it('should replace a placeholder that is used twice only once', () => {
        expect(format('Chapter 12', '%CH% %CH%')).toBe('0012 %CH%');
    });

    it.each([
        [ 'a double dollar sign in the title', 'Chapter 5: Pay $$ now', '%T%', {}, 'Pay $$ now' ],
        [ 'a dollar sign and an ampersand in the title', 'Chapter 5: Pay $& now', '%T%', {}, 'Pay $& now' ],
        [ 'a dollar sign and an apostrophe in the title', 'Chapter 5: Pay $\' now', '%T%', {}, 'Pay $\' now' ],
        [ 'a dollar sign and a backtick in the title', 'Chapter 5: Pay $` now', '%T%', {}, 'Pay $` now' ],
        [ 'a double dollar sign in the original title', 'Chapter 5: Pay $$ now', '%O%', {}, 'Chapter 5: Pay $$ now' ],
        [ 'a double dollar sign in the name of the manga', 'Chapter 5', '%M%', { manga: 'Ca$$h' }, 'Ca$$h' ],
        [ 'a double dollar sign in the name of the website', 'Chapter 5', '%C%', { connector: 'Site$$' }, 'Site$$' ]
    ])('should keep %s', (name, title, pattern, names, expected) => {
        expect(format(title, pattern, names)).toBe(expected);
    });
});
