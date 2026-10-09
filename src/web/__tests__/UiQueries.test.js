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
        getChapters: jest.fn((callback) => {
            callback(null, [{ id: `${id}-c1`, title: 'Ch 1', manga: null }]);
        })
    };
}

function connector(id) {
    const self = {
        id,
        label: `Label ${id}`,
        getMangas: jest.fn((callback) => {
            callback(null, [manga('m1', self), manga('m2', self)]);
        }),
        updateMangas: jest.fn((callback) => {
            callback(null, [manga('m1', self)]);
        })
    };
    return self;
}

function fakeEngine(extra) {
    globalThis.window = Object.assign({}, globalThis.window, {
        Engine: Object.assign({
            Connectors: [connector('c1'), connector('c2')],
            DownloadManager: { addDownload: jest.fn() },
            ChaptermarkManager: {
                isChapterMarked: jest.fn(() => true)
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
                addBookmark: jest.fn(() => true),
                deleteBookmark: jest.fn(() => true)
            },
            ChaptermarkManager: {
                isChapterMarked: jest.fn(() => true),
                addChaptermark: jest.fn(),
                deleteChaptermark: jest.fn()
            }
        });
        expect(bridge.isMangaBookmarked(m)).toBe(false);
        expect(bridge.toggleBookmark(m)).toBe(true);
        expect(bridge.isChapterMarked({ id: 'c' }, { chapterID: 'c' })).toBe(true);
        bridge.toggleChaptermark({ id: 'c' }, { chapterID: 'c' });
    });
});
