// How the manga tells which of its chapters are on the device: by the files in its directory. A novel is stored in the
// novel format, whatever the format of the chapters of comics is, so the file of a chapter may be in either of them.
let Chapter = null;
let Manga = null;

beforeAll(async () => {
    Chapter = (await import('../mjs/engine/Chapter.mjs')).default;
    Manga = (await import('../mjs/engine/Manga.mjs')).default;
});

afterEach(() => {
    delete globalThis.Engine;
    delete globalThis.document;
    delete globalThis.EventListener;
});

function setup(chapterFormat, novelFormat = '.epub') {
    globalThis.Engine = {
        Storage: { sanatizePath: title => title.replace(/[/]/g, '') },
        Settings: { chapterFormat: { value: chapterFormat }, novelFormat: { value: novelFormat } }
    };
    globalThis.document = { dispatchEvent: vi.fn() };
    globalThis.EventListener = { onChapterStatusChanged: 'chapter-status-changed', onMangaStatusChanged: 'manga-status-changed' };
}

// the manga keeps the files of its directory as a list with the names as keys
function directory(...names) {
    const list = [];
    for (const name of names) {
        list[name] = true;
    }
    return list;
}

function createManga(...files) {
    const manga = new Manga({ label: 'Site' }, '/manga/1', 'Title', 'available');
    manga.existingChapters = directory(...files);
    return manga;
}

describe('the files of a chapter', () => {
    it('should be in the chapter format, or in the novel format for a novel', () => {
        setup('.cbz');
        expect(new Chapter(createManga(), '/1', 'Chapter 1', 'en', 'available').file).toEqual({ name: 'Chapter 1', extension: '.cbz', full: 'Chapter 1.cbz', novel: 'Chapter 1.epub' });
    });

    it('should be a folder for the chapter format that stores the images in one', () => {
        setup('img');
        expect(new Chapter(createManga(), '/1', 'Chapter 1', 'en', 'available').file).toEqual({ name: 'Chapter 1', extension: '', full: 'Chapter 1', novel: 'Chapter 1.epub' });
    });

    it('should follow the novel format', () => {
        setup('.cbz', '.pdf');
        expect(new Chapter(createManga(), '/1', 'Chapter 1', 'en', 'available').file.novel).toBe('Chapter 1.pdf');
    });

    it('should be the same file for both when they share their format', () => {
        setup('.epub');
        const { full, novel } = new Chapter(createManga(), '/1', 'Chapter 1', 'en', 'available').file;
        expect(full).toBe(novel);
    });

    it('should be the file itself for a chapter that is only in the directory', () => {
        setup('.cbz');
        expect(new Chapter(createManga(), 'Chapter 1.epub', 'Chapter 1.epub', undefined, 'offline').file).toEqual({ name: 'Chapter 1.epub', extension: '', full: 'Chapter 1.epub' });
    });

    it('should leave out what a file name must not hold', () => {
        setup('.cbz');
        expect(new Chapter(createManga(), '/1', 'Vol 1/Chapter 2', 'en', 'available').file.novel).toBe('Vol 1Chapter 2.epub');
    });
});

describe('a chapter that is in the directory of its manga', () => {
    it('should be there in the format of the chapters', () => {
        setup('.cbz');
        const manga = createManga('Chapter 1.cbz');
        expect(manga.isChapterFileExisting(new Chapter(manga, '/1', 'Chapter 1', 'en', 'available'))).toBeTruthy();
    });

    it('should be there as a novel, in the novel format', () => {
        setup('.cbz');
        const manga = createManga('Chapter 1.epub');
        expect(manga.isChapterFileExisting(new Chapter(manga, '/1', 'Chapter 1', 'en', 'available'))).toBeTruthy();
        const folders = createManga('Chapter 1.epub');
        setup('img');
        expect(folders.isChapterFileExisting(new Chapter(folders, '/1', 'Chapter 1', 'en', 'available'))).toBeTruthy();
    });

    it('should not be there in another format, nor with another name', () => {
        setup('.cbz');
        const manga = createManga('Chapter 1.pdf', 'Chapter 1.zip', 'Chapter 2.epub', 'Chapter 1');
        expect(manga.isChapterFileExisting(new Chapter(manga, '/1', 'Chapter 1', 'en', 'available'))).toBeFalsy();
    });

    it('should follow the novel format', () => {
        setup('.cbz', '.pdf');
        const manga = createManga('Chapter 1.epub');
        expect(manga.isChapterFileExisting(new Chapter(manga, '/1', 'Chapter 1', 'en', 'available'))).toBeFalsy();
        manga.existingChapters = directory('Chapter 1.pdf');
        expect(manga.isChapterFileExisting(new Chapter(manga, '/1', 'Chapter 1', 'en', 'available'))).toBeTruthy();
    });

    it('should not be there for a chapter that has no novel file, because of a file that is called so', () => {
        setup('.cbz');
        const manga = createManga('undefined');
        expect(manga.isChapterFileExisting(new Chapter(manga, 'Chapter 1.zip', 'Chapter 1.zip', undefined, 'offline'))).toBeFalsy();
    });

    it('should know nothing before the directory was read', () => {
        setup('.cbz');
        const manga = createManga();
        manga.existingChapters = undefined;
        expect(manga.isChapterFileExisting(new Chapter(manga, '/1', 'Chapter 1', 'en', 'available'))).toBe(false);
    });

    it('should have the status of its file: downloaded, or available', () => {
        setup('.cbz');
        const novel = createManga('Chapter 1.epub');
        const comic = createManga('Chapter 1.cbz');
        const none = createManga();
        expect(new Chapter(novel, '/1', 'Chapter 1', 'en').status).toBe('completed');
        expect(new Chapter(comic, '/1', 'Chapter 1', 'en').status).toBe('completed');
        expect(new Chapter(none, '/1', 'Chapter 1', 'en').status).toBe('available');
    });

    it('should stay downloaded when the status is updated', () => {
        setup('.cbz');
        const manga = createManga('Chapter 1.epub');
        const chapter = new Chapter(manga, '/1', 'Chapter 1', 'en', 'completed');
        chapter.updateStatus();
        expect(chapter.status).toBe('completed');
        manga.existingChapters = directory();
        chapter.updateStatus();
        expect(chapter.status).toBe('available');
    });
});

describe('a file in the directory of a manga', () => {
    function cacheOf(...titles) {
        const manga = createManga();
        manga.chapterCache = titles.map(title => new Chapter(manga, `/${title}`, title, 'en', 'available'));
        return manga;
    }

    it('should belong to the chapter of that name, in the chapter format or the novel format', () => {
        setup('.cbz');
        const manga = cacheOf('Chapter 1');
        expect(manga.isChapterFileCached('Chapter 1.cbz')).toBe(true);
        expect(manga.isChapterFileCached('Chapter 1.epub')).toBe(true);
    });

    it('should not belong to a chapter of another name or in another format', () => {
        setup('.cbz');
        const manga = cacheOf('Chapter 1');
        expect(manga.isChapterFileCached('Chapter 1.pdf')).toBe(false);
        expect(manga.isChapterFileCached('Chapter 2.epub')).toBe(false);
        expect(manga.isChapterFileCached('Chapter 1')).toBe(false);
    });

    it('should belong to a chapter that is only in the directory, by its name', () => {
        setup('.cbz');
        const manga = createManga();
        manga.chapterCache = [new Chapter(manga, 'Old.epub', 'Old.epub', undefined, 'offline')];
        expect(manga.isChapterFileCached('Old.epub')).toBe(true);
        expect(manga.isChapterFileCached('undefined')).toBe(false);
    });
});
