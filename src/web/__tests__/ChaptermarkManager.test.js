// The chapter that the user stopped reading at: one mark for each manga of each connector, saved in the bookmark
// storage under 'chaptermarks'. The UI shows the mark of the manga and asks whether a chapter is the marked one.
let ChaptermarkManager = null;

beforeAll(async () => {
    ChaptermarkManager = (await import('../mjs/engine/ChaptermarkManager.mjs')).default;
});

afterEach(() => {
    delete globalThis.Engine;
    vi.restoreAllMocks();
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function once(target, type) {
    return new Promise(resolve => target.addEventListener(type, resolve, { once: true }));
}

// the bookmark storage keeps JSON files: whatever is saved or loaded is a copy
function storage(files = {}) {
    const stored = new Map(Object.entries(files));
    return {
        stored,
        saveBookmarks: vi.fn(async (key, value) => {
            stored.set(key, JSON.parse(JSON.stringify(value)));
        }),
        loadBookmarks: vi.fn(async key => {
            if (!stored.has(key)) {
                throw new Error(`ENOENT: no such file or directory, open '${key}'`);
            }
            return JSON.parse(JSON.stringify(stored.get(key)));
        })
    };
}

function setup(files) {
    const engineStorage = storage(files);
    globalThis.Engine = { Storage: engineStorage };
    const settings = new EventTarget();
    return { storage: engineStorage, settings, manager: new ChaptermarkManager(settings) };
}

function chapter(id = '/c/1', title = 'Chapter 1', mangaId = '/m/1', connectorId = 'site') {
    return { id, title, file: { full: `${title}.cbz` }, manga: { id: mangaId, title: 'Manga', connector: { id: connectorId } } };
}

function mark(overrides = {}) {
    return { connectorID: 'site', mangaID: '/m/1', chapterID: '/c/1', chapterTitle: 'Chapter 1', ...overrides };
}

describe('addChaptermark', () => {
    it('should mark the chapter for its manga and connector', async () => {
        const { manager, storage: files } = setup();
        const saved = once(manager, 'changed');
        manager.addChaptermark(chapter());
        expect(manager.chaptermarks).toEqual([mark()]);
        // the save starts at once, the change is announced when it is done
        expect(files.saveBookmarks).toHaveBeenCalledWith('chaptermarks', [mark()], 2);
        const event = await saved;
        expect(event.detail).toBe(manager.chaptermarks);
        expect(files.stored.get('chaptermarks')).toEqual([mark()]);
    });

    it('should identify a chapter with an object as its id by the hash of it', () => {
        const { manager } = setup();
        manager.addChaptermark(chapter({ hash: 'abc123', url: 'https://site.test/c/1' }));
        expect(manager.chaptermarks[0].chapterID).toBe('abc123');
    });

    it('should keep one mark for each manga, the newest chapter replaces the older one in place', async () => {
        const { manager } = setup();
        manager.addChaptermark(chapter('/c/1', 'Chapter 1', '/m/1'));
        manager.addChaptermark(chapter('/c/9', 'Chapter 9', '/m/2'));
        manager.addChaptermark(chapter('/c/2', 'Chapter 2', '/m/1'));
        await flush();
        expect(manager.chaptermarks).toEqual([
            mark({ chapterID: '/c/2', chapterTitle: 'Chapter 2' }),
            mark({ mangaID: '/m/2', chapterID: '/c/9', chapterTitle: 'Chapter 9' })
        ]);
    });

    it('should mark the same manga of two connectors separately', () => {
        const { manager } = setup();
        manager.addChaptermark(chapter('/c/1', 'Chapter 1', '/m/1', 'site-a'));
        manager.addChaptermark(chapter('/c/1', 'Chapter 1', '/m/1', 'site-b'));
        expect(manager.chaptermarks.map(entry => entry.connectorID)).toEqual(['site-a', 'site-b']);
    });

    it.each([
        ['nothing', undefined],
        ['null', null],
        ['a chapter without a manga', { id: '/c/1', title: 'Chapter 1' }],
        ['a manga without a connector', { id: '/c/1', title: 'Chapter 1', manga: { id: '/m/1' } }]
    ])('should ignore %s', async (name, value) => {
        const { manager, storage: files } = setup();
        const changed = vi.fn();
        manager.addEventListener('changed', changed);
        manager.addChaptermark(value);
        await flush();
        expect(manager.chaptermarks).toEqual([]);
        expect(files.saveBookmarks).not.toHaveBeenCalled();
        expect(changed).not.toHaveBeenCalled();
    });

    it('should write marks that a reader of the old files understands', async () => {
        const { manager, storage: files } = setup();
        manager.addChaptermark(chapter('/c/1', 'Chapter 1: 日本語'));
        await flush();
        expect(JSON.stringify(files.stored.get('chaptermarks'))).toBe('[{"connectorID":"site","mangaID":"/m/1","chapterID":"/c/1","chapterTitle":"Chapter 1: 日本語"}]');
    });
});

describe('getChaptermark', () => {
    it('should find the mark of a manga for its connector', () => {
        const { manager } = setup();
        manager.chaptermarks = [mark(), mark({ mangaID: '/m/2', chapterID: '/c/5' }), mark({ connectorID: 'other', chapterID: '/c/7' })];
        expect(manager.getChaptermark({ id: '/m/2', connector: { id: 'site' } }).chapterID).toBe('/c/5');
        expect(manager.getChaptermark({ id: '/m/1', connector: { id: 'other' } }).chapterID).toBe('/c/7');
    });

    it.each([
        ['nothing', undefined],
        ['a manga that has no mark', { id: '/m/404', connector: { id: 'site' } }],
        ['the manga of another connector', { id: '/m/1', connector: { id: 'elsewhere' } }]
    ])('should find no mark for %s', (name, manga) => {
        const { manager } = setup();
        manager.chaptermarks = [mark()];
        expect(manager.getChaptermark(manga)).toBeUndefined();
    });

    it('should give a mark of the old files, which have no title, a title to show', () => {
        const { manager } = setup();
        manager.chaptermarks = [{ connectorID: 'site', mangaID: '/m/1', chapterID: '/c/1' }];
        expect(manager.getChaptermark({ id: '/m/1', connector: { id: 'site' } }).chapterTitle).toBe('Chapter Title Unavailable');
    });

    it('should leave the title of a mark that has one', () => {
        const { manager } = setup();
        manager.chaptermarks = [mark()];
        expect(manager.getChaptermark({ id: '/m/1', connector: { id: 'site' } }).chapterTitle).toBe('Chapter 1');
    });
});

describe('isChapterMarked', () => {
    it.each([
        ['has the id of the mark', chapter('/c/1', 'Other title'), true],
        ['has the hash of its id in the mark', chapter({ hash: '/c/1' }, 'Other title'), true],
        ['has the file name of the mark as the id, like a chapter that is only on the device', { ...chapter('/c/77', 'Other title'), file: { full: '/c/1' } }, true],
        // NOTE: the title is a way to recognise a mark when a site renumbered its chapters, so chapters that share a title are all marked
        ['has the title of the mark, whatever its id', chapter('/c/99', 'Chapter 1'), true],
        ['has nothing of the mark but the manga', chapter('/c/99', 'Chapter 99'), false],
        ['is the same chapter of another manga', chapter('/c/1', 'Chapter 1', '/m/2'), false],
        ['is the same chapter of the manga of another connector', chapter('/c/1', 'Chapter 1', '/m/1', 'other'), false]
    ])('should tell whether a chapter that %s is the marked one', (name, candidate, marked) => {
        const { manager } = setup();
        expect(Boolean(manager.isChapterMarked(candidate, mark()))).toBe(marked);
    });

    it.each([
        ['no mark', chapter(), undefined],
        ['a null mark', chapter(), null],
        ['no chapter', undefined, mark()],
        ['a null chapter', null, mark()]
    ])('should not call anything marked for %s', (name, candidate, markedChapter) => {
        const { manager } = setup();
        expect(manager.isChapterMarked(candidate, markedChapter)).toBeFalsy();
    });

    it('should agree with the mark that addChaptermark made of the same chapter', () => {
        const { manager } = setup();
        const hashed = chapter({ hash: 'h-1', url: 'https://site.test/1' });
        manager.addChaptermark(hashed);
        expect(manager.isChapterMarked(hashed, manager.getChaptermark(hashed.manga))).toBeTruthy();
        expect(manager.isChapterMarked(chapter({ hash: 'h-2' }, 'Chapter 2'), manager.chaptermarks[0])).toBeFalsy();
    });
});

describe('deleteChaptermark', () => {
    it('should remove the mark of the manga and tell about it', async () => {
        const { manager, storage: files } = setup();
        manager.chaptermarks = [mark(), mark({ mangaID: '/m/2' })];
        const saved = once(manager, 'changed');
        manager.deleteChaptermark(mark({ chapterID: '/c/other', chapterTitle: 'Another' }));
        expect(manager.chaptermarks).toEqual([mark({ mangaID: '/m/2' })]);
        expect(files.saveBookmarks).toHaveBeenCalledWith('chaptermarks', [mark({ mangaID: '/m/2' })], 2);
        expect((await saved).detail).toBe(manager.chaptermarks);
    });

    it('should do nothing for a manga that has no mark', async () => {
        const { manager, storage: files } = setup();
        manager.chaptermarks = [mark()];
        const changed = vi.fn();
        manager.addEventListener('changed', changed);
        manager.deleteChaptermark(mark({ mangaID: '/m/404' }));
        manager.deleteChaptermark(mark({ connectorID: 'elsewhere' }));
        await flush();
        expect(manager.chaptermarks).toEqual([mark()]);
        expect(files.saveBookmarks).not.toHaveBeenCalled();
        expect(changed).not.toHaveBeenCalled();
    });
});

describe('mergeChaptermarks', () => {
    it('should add the marks of mangas that have none and keep the mark that a manga already has', async () => {
        const { manager, storage: files } = setup();
        manager.chaptermarks = [mark({ chapterID: '/c/mine' })];
        const saved = once(manager, 'changed');
        manager.mergeChaptermarks([mark({ chapterID: '/c/theirs' }), mark({ mangaID: '/m/2', chapterID: '/c/2' })]);
        await saved;
        expect(manager.chaptermarks).toEqual([mark({ chapterID: '/c/mine' }), mark({ mangaID: '/m/2', chapterID: '/c/2' })]);
        expect(files.stored.get('chaptermarks')).toEqual(manager.chaptermarks);
    });

    it.each([['nothing', undefined], ['null', null]])('should ignore %s', async (name, value) => {
        const { manager, storage: files } = setup();
        manager.mergeChaptermarks(value);
        await flush();
        expect(files.saveBookmarks).not.toHaveBeenCalled();
    });

    it('should add one mark for a manga that two of the merged marks belong to, the first one', async () => {
        const { manager } = setup();
        manager.mergeChaptermarks([mark({ chapterID: '/c/1' }), mark({ mangaID: '/m/2', chapterID: '/c/7' }), mark({ chapterID: '/c/2' })]);
        await flush();
        expect(manager.chaptermarks).toEqual([mark({ chapterID: '/c/1' }), mark({ mangaID: '/m/2', chapterID: '/c/7' })]);
        // a mark that is deleted does not come back from a second one that was left behind
        manager.deleteChaptermark(mark());
        expect(manager.chaptermarks.filter(entry => entry.mangaID === '/m/1')).toEqual([]);
    });

    it('should keep the marks of one manga of two connectors apart when it merges them', async () => {
        const { manager } = setup();
        manager.mergeChaptermarks([mark({ connectorID: 'site-a' }), mark({ connectorID: 'site-b' }), mark({ connectorID: 'site-a', chapterID: '/c/2' })]);
        await flush();
        expect(manager.chaptermarks.map(entry => [entry.connectorID, entry.chapterID])).toEqual([['site-a', '/c/1'], ['site-b', '/c/1']]);
    });
});

describe('loadChaptermarks', () => {
    it('should take over the stored marks and tell about it', async () => {
        const { manager } = setup({ chaptermarks: [mark(), mark({ mangaID: '/m/2' })] });
        const changed = once(manager, 'changed');
        const callback = vi.fn();
        manager.loadChaptermarks(callback);
        const event = await changed;
        expect(manager.chaptermarks).toEqual([mark(), mark({ mangaID: '/m/2' })]);
        expect(event.detail).toBe(manager.chaptermarks);
        expect(callback).toHaveBeenCalledWith(null);
    });

    it('should accept a list without marks', async () => {
        const { manager } = setup({ chaptermarks: [] });
        manager.chaptermarks = [mark()];
        const callback = vi.fn();
        manager.loadChaptermarks(callback);
        await flush();
        expect(manager.chaptermarks).toEqual([]);
        expect(callback).toHaveBeenCalledWith(null);
    });

    it('should refuse a stored value that is no list and keep the marks that it has', async () => {
        const { manager } = setup({ chaptermarks: null });
        manager.chaptermarks = [mark()];
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const changed = vi.fn();
        manager.addEventListener('changed', changed);
        const callback = vi.fn();
        manager.loadChaptermarks(callback);
        await flush();
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(callback.mock.calls[0][0].message).toBe('Invalid chaptermark list!');
        expect(log).toHaveBeenCalledWith('Failed to load chaptermarks:', 'Invalid chaptermark list!');
        expect(manager.chaptermarks).toEqual([mark()]);
        expect(changed).not.toHaveBeenCalled();
    });

    it('should pass on the error of the storage, as it is when there is no file yet', async () => {
        const { manager } = setup();
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const callback = vi.fn();
        manager.loadChaptermarks(callback);
        await flush();
        expect(callback.mock.calls[0][0].message).toMatch(/ENOENT/);
        expect(manager.chaptermarks).toEqual([]);
        expect(log).not.toHaveBeenCalled();
    });

    it('should work without a callback', async () => {
        const { manager } = setup({ chaptermarks: [mark()] });
        const changed = once(manager, 'changed');
        manager.loadChaptermarks();
        await changed;
        const failing = setup({ chaptermarks: null });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(() => failing.manager.loadChaptermarks(undefined)).not.toThrow();
        await flush();
    });

    it.each([
        ['an object', { connectorID: 'site' }],
        ['a text', 'chaptermarks'],
        ['a number', 42],
        ['true', true]
    ])('should refuse a stored value that is %s, and keep the marks that it has', async (name, stored) => {
        const { manager } = setup({ chaptermarks: stored });
        manager.chaptermarks = [mark()];
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const changed = vi.fn();
        manager.addEventListener('changed', changed);
        const callback = vi.fn();
        manager.loadChaptermarks(callback);
        await flush();
        expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(callback.mock.calls[0][0].message).toBe('Invalid chaptermark list!');
        expect(manager.chaptermarks).toEqual([mark()]);
        expect(changed).not.toHaveBeenCalled();
    });
});

describe('a save that fails', () => {
    it('should bring back the marks of the storage, so the list and the file do not differ', async () => {
        const { manager, storage: files } = setup({ chaptermarks: [mark({ chapterID: '/c/stored' })] });
        manager.chaptermarks = [mark({ chapterID: '/c/stored' })];
        files.saveBookmarks.mockRejectedValueOnce(new Error('disk full'));
        const reloaded = once(manager, 'changed');
        manager.addChaptermark(chapter('/c/new', 'Chapter New', '/m/new'));
        expect(manager.chaptermarks).toHaveLength(2);
        const event = await reloaded;
        expect(manager.chaptermarks).toEqual([mark({ chapterID: '/c/stored' })]);
        expect(event.detail).toBe(manager.chaptermarks);
    });

    // NOTE: when the storage cannot be read either, nothing tells the user, and the mark stays in memory only
    it('should keep the mark in memory when the storage cannot be read either', async () => {
        const { manager, storage: files } = setup();
        files.saveBookmarks.mockRejectedValue(new Error('disk full'));
        const changed = vi.fn();
        manager.addEventListener('changed', changed);
        manager.addChaptermark(chapter());
        await flush();
        expect(manager.chaptermarks).toEqual([mark()]);
        expect(changed).not.toHaveBeenCalled();
    });
});

describe('_syncChaptermarks', () => {
    it('should call back when the marks are saved', async () => {
        const { manager } = setup();
        manager.chaptermarks = [mark()];
        const callback = vi.fn();
        manager._syncChaptermarks(callback);
        await flush();
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(null);
    });

    it('should call back with the result of bringing the stored marks back when the save fails', async () => {
        const { manager, storage: files } = setup({ chaptermarks: [mark({ chapterID: '/c/stored' })] });
        manager.chaptermarks = [mark({ chapterID: '/c/unsaved' })];
        files.saveBookmarks.mockRejectedValue(new Error('disk full'));
        const callback = vi.fn();
        manager._syncChaptermarks(callback);
        await flush();
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(null);
        expect(manager.chaptermarks).toEqual([mark({ chapterID: '/c/stored' })]);
    });

    it('should call back with the error when the stored marks cannot be brought back either', async () => {
        const { manager, storage: files } = setup();
        manager.chaptermarks = [mark()];
        files.saveBookmarks.mockRejectedValue(new Error('disk full'));
        const callback = vi.fn();
        manager._syncChaptermarks(callback);
        await flush();
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0][0].message).toMatch(/ENOENT/);
    });
});

describe('the settings of the application', () => {
    it('should save the marks again when the settings are saved, for the case that the bookmark directory changed', async () => {
        const { manager, settings, storage: files } = setup();
        manager.chaptermarks = [mark()];
        const saved = once(manager, 'changed');
        settings.dispatchEvent(new CustomEvent('saved'));
        expect((await saved).detail).toEqual([mark()]);
        expect(files.saveBookmarks).toHaveBeenCalledWith('chaptermarks', [mark()], 2);
    });

    it('should not save when the settings are only loaded', async () => {
        const { settings, storage: files } = setup();
        settings.dispatchEvent(new CustomEvent('loaded'));
        await flush();
        expect(files.saveBookmarks).not.toHaveBeenCalled();
    });
});
