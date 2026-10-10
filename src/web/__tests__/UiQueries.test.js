// Query-layer contract tests: callback engine APIs wrapped as promises,
// resolved against the shared QueryClient cache.
let queries = null;
let bridge = null;

beforeAll(async () => {
    queries = await import('../ui/queries.js');
    bridge = await import('../ui/engine.js');
});

function manga(id, connector) {
    return {
        id,
        title: `Title ${id}`,
        connector,
        getChapters: vi.fn((callback) => {
            callback(null, [{ id: `${id}-c1`, title: 'Ch 1', manga: null }]);
        })
    };
}

function connector(id) {
    const self = {
        id,
        label: `Label ${id}`,
        getMangas: vi.fn((callback) => {
            callback(null, [manga('m1', self), manga('m2', self)]);
        }),
        updateMangas: vi.fn((callback) => {
            callback(null, [manga('m1', self)]);
        })
    };
    return self;
}

function fakeEngine(extra) {
    globalThis.window = Object.assign({}, globalThis.window, {
        Engine: Object.assign({
            Connectors: [connector('c1'), connector('c2')],
            DownloadManager: { addDownload: vi.fn() },
            ChaptermarkManager: {
                isChapterMarked: vi.fn(() => true)
            }
        }, extra)
    });
}

afterEach(() => {
    delete globalThis.window.Engine;
    queries.queryClient.clear();
});

describe('ui queries', () => {
    it('should look connectors up by id', () => {
        fakeEngine();
        expect(queries.getConnector('c2').label).toBe('Label c2');
        expect(() => queries.getConnector('nope')).toThrow();
    });

    it('should wrap getMangas/updateMangas callbacks in promises', async () => {
        fakeEngine();
        const conn = queries.getConnector('c1');
        await expect(queries.fetchMangaList(conn)).resolves.toHaveLength(2);
        await expect(queries.updateMangaList(conn)).resolves.toHaveLength(1);
    });

    it('should reject when the engine reports errors', async () => {
        fakeEngine();
        const conn = queries.getConnector('c1');
        conn.getMangas.mockImplementationOnce(callback => callback(new Error('boom'), undefined));
        await expect(queries.fetchMangaList(conn)).rejects.toThrow('boom');
    });

    it('should resolve manga from the query cache without refetching', async () => {
        fakeEngine();
        const conn = queries.getConnector('c1');
        queries.queryClient.setQueryData(['mangas', 'c1'], [{ id: 'cached', title: 'Cached' }]);
        await expect(queries.resolveManga('c1', 'cached')).resolves.toMatchObject({ id: 'cached' });
        expect(conn.getMangas).not.toHaveBeenCalled();
    });

    it('should load the manga list on a cache miss when resolving', async () => {
        fakeEngine();
        const resolved = await queries.resolveManga('c1', 'm2');
        expect(resolved.title).toBe('Title m2');
        expect(queries.queryClient.getQueryData(['mangas', 'c1'])).toHaveLength(2);
    });

    it('should throw when the manga is unknown', async () => {
        fakeEngine();
        await expect(queries.resolveManga('c1', 'ghost')).rejects.toThrow();
    });

    it('should wrap manga.getChapters in a promise', async () => {
        fakeEngine();
        const resolved = await queries.resolveManga('c1', 'm1');
        await expect(queries.fetchChapterList(resolved)).resolves.toHaveLength(1);
    });

    it('should wrap chapter.getPages in a promise', async () => {
        fakeEngine();
        const chapter = {
            id: 'c1',
            title: 'Ch 1',
            getPages: vi.fn(callback => callback(null, ['http://img/1.jpg', 'http://img/2.jpg']))
        };
        await expect(queries.fetchPages(chapter)).resolves.toHaveLength(2);
        chapter.getPages.mockImplementationOnce(callback => callback(new Error('empty'), undefined));
        await expect(queries.fetchPages(chapter)).rejects.toThrow('empty');
    });

    it('should resolve chapters with siblings for prev/next navigation', async () => {
        fakeEngine();
        const resolved = await queries.resolveChapter('c1', 'm1', 'm1-c1');
        expect(resolved.manga.title).toBe('Title m1');
        expect(resolved.index).toBe(0);
        expect(resolved.chapters).toHaveLength(1);
        await expect(queries.resolveChapter('c1', 'm1', 'ghost')).rejects.toThrow();
    });

    it('should fan chapter downloads out to the download manager', () => {
        fakeEngine();
        const added = queries.addChapterDownloads([{ id: 'a' }, { id: 'b' }]);
        expect(added).toBe(2);
        expect(globalThis.window.Engine.DownloadManager.addDownload).toHaveBeenCalledTimes(2);
    });

    it('should toggle bookmarks and chaptermarks through the bridge', () => {
        const m = manga('m1', { id: 'c1' });
        fakeEngine({
            BookmarkManager: {
                bookmarks: [],
                addBookmark: vi.fn(() => true),
                deleteBookmark: vi.fn(() => true)
            },
            ChaptermarkManager: {
                isChapterMarked: vi.fn(() => true),
                addChaptermark: vi.fn(),
                deleteChaptermark: vi.fn()
            }
        });
        expect(bridge.isMangaBookmarked(m)).toBe(false);
        expect(bridge.toggleBookmark(m)).toBe(true);
        expect(bridge.isChapterMarked({ id: 'c' }, { chapterID: 'c' })).toBe(true);
        bridge.toggleChaptermark({ id: 'c' }, { chapterID: 'c' });
    });
});
