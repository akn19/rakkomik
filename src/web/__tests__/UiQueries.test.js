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
        }),
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
        }),
    };
    return self;
}

function fakeEngine(extra) {
    globalThis.window = Object.assign({}, globalThis.window, {
        Engine: Object.assign(
            {
                Connectors: [connector('c1'), connector('c2')],
                DownloadManager: { addDownload: vi.fn() },
                ChaptermarkManager: {
                    isChapterMarked: vi.fn(() => true),
                },
            },
            extra,
        ),
    });
}

afterEach(() => {
    // only fakeEngine makes a window: a test without an engine can be the first of a run (the order is shuffled)
    delete globalThis.window?.Engine;
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
        conn.getMangas.mockImplementationOnce((callback) => callback(new Error('boom'), undefined));
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
            getPages: vi.fn((callback) => callback(null, ['http://img/1.jpg', 'http://img/2.jpg'])),
        };
        await expect(queries.fetchPages(chapter)).resolves.toHaveLength(2);
        chapter.getPages.mockImplementationOnce((callback) =>
            callback(new Error('empty'), undefined),
        );
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
                deleteBookmark: vi.fn(() => true),
            },
            ChaptermarkManager: {
                isChapterMarked: vi.fn(() => true),
                addChaptermark: vi.fn(),
                deleteChaptermark: vi.fn(),
            },
        });
        expect(bridge.isMangaBookmarked(m)).toBe(false);
        expect(bridge.toggleBookmark(m)).toBe(true);
        expect(bridge.isChapterMarked({ id: 'c' }, { chapterID: 'c' })).toBe(true);
        bridge.toggleChaptermark({ id: 'c' }, { chapterID: 'c' });
    });
});

describe('ui queries: what is said when the engine says nothing', () => {
    it('should name what failed when the engine gives neither an error nor a result', async () => {
        fakeEngine();
        const conn = queries.getConnector('c1');
        conn.getMangas.mockImplementationOnce((callback) => callback(null, undefined));
        await expect(queries.fetchMangaList(conn)).rejects.toThrow(
            'Failed to load manga list for "Label c1"!',
        );
        conn.updateMangas.mockImplementationOnce((callback) => callback(null, undefined));
        await expect(queries.updateMangaList(conn)).rejects.toThrow(
            'Failed to update manga list for "Label c1"!',
        );
        const noChapters = {
            title: 'Title m1',
            getChapters: (callback) => callback(null, undefined),
        };
        await expect(queries.fetchChapterList(noChapters)).rejects.toThrow(
            'Failed to load chapters for "Title m1"!',
        );
        const noPages = { title: 'Ch 1', getPages: (callback) => callback(null, undefined) };
        await expect(queries.fetchPages(noPages)).rejects.toThrow(
            'Failed to load pages for "Ch 1"!',
        );
    });

    it('should prefer the error of the engine to the generic message', async () => {
        fakeEngine();
        const conn = queries.getConnector('c1');
        const failure = new Error('HTTP 503');
        conn.updateMangas.mockImplementationOnce((callback) =>
            callback(failure, [{ id: 'ignored' }]),
        );
        await expect(queries.updateMangaList(conn)).rejects.toBe(failure);
    });

    it('should accept an empty list as a list: a site with nothing is not a failure', async () => {
        fakeEngine();
        const conn = queries.getConnector('c1');
        conn.getMangas.mockImplementationOnce((callback) => callback(null, []));
        await expect(queries.fetchMangaList(conn)).resolves.toEqual([]);
        const noChapters = { title: 'Title', getChapters: (callback) => callback(null, []) };
        await expect(queries.fetchChapterList(noChapters)).resolves.toEqual([]);
    });

    it('should name the connector in the error for an unknown one', () => {
        fakeEngine();
        expect(() => queries.getConnector('nope')).toThrow('Unknown connector "nope"!');
    });

    it('should name the manga and the connector when a manga is not found', async () => {
        fakeEngine();
        await expect(queries.resolveManga('c1', 'ghost')).rejects.toThrow(
            'Manga "ghost" not found for connector "Label c1"!',
        );
    });

    it('should name the chapter when it is not found', async () => {
        fakeEngine();
        await expect(queries.resolveChapter('c1', 'm1', 'ghost')).rejects.toThrow(
            'Chapter "ghost" not found!',
        );
    });
});

describe('ui queries: the cache', () => {
    it('should keep what it reads until it is told otherwise: the sites are only asked on an explicit update', () => {
        expect(queries.queryClient.getDefaultOptions().queries).toEqual({
            staleTime: Infinity,
            gcTime: Infinity,
            retry: false,
            refetchOnWindowFocus: false,
        });
    });

    it('should keep the manga list of each connector apart', async () => {
        fakeEngine();
        const first = await queries.resolveManga('c1', 'm1');
        const second = await queries.resolveManga('c2', 'm1');
        expect(second).not.toBe(first);
        expect(first.connector.id).toBe('c1');
        expect(second.connector.id).toBe('c2');
        await expect(queries.resolveManga('c2', 'other')).rejects.toThrow(
            'Manga "other" not found for connector "Label c2"!',
        );
    });

    it('should read the chapters of a manga once, and keep them for the next lookup', async () => {
        fakeEngine();
        const resolved = await queries.resolveChapter('c1', 'm1', 'm1-c1');
        const again = await queries.resolveChapter('c1', 'm1', 'm1-c1');
        expect(again.chapters).toBe(resolved.chapters);
        expect(resolved.manga.getChapters).toHaveBeenCalledTimes(1);
        expect(queries.queryClient.getQueryData(['chapters', 'c1', 'm1'])).toBe(resolved.chapters);
    });

    it('should use the chapters that a view has already cached', async () => {
        fakeEngine();
        const cached = [{ id: 'x1' }, { id: 'x2' }];
        queries.queryClient.setQueryData(
            ['mangas', 'c1'],
            [{ id: 'm1', title: 'T', getChapters: vi.fn() }],
        );
        queries.queryClient.setQueryData(['chapters', 'c1', 'm1'], cached);
        const resolved = await queries.resolveChapter('c1', 'm1', 'x2');
        expect(resolved.index).toBe(1);
        expect(resolved.manga.getChapters).not.toHaveBeenCalled();
    });

    it('should wait for the connectors to register before it looks one up, as a link to the reader is read at once', async () => {
        const connectors = [];
        let release = null;
        fakeEngine({
            Connectors: connectors,
            ConnectorsReady: new Promise((resolve) => {
                release = resolve;
            }),
        });
        let result = 'pending';
        const resolving = queries.resolveManga('late', 'm1').then(
            (value) => {
                result = value;
            },
            (error) => {
                result = error;
            },
        );
        await Promise.resolve();
        expect(result).toBe('pending');
        connectors.push(connector('late'));
        release(connectors);
        await resolving;
        expect(result).toMatchObject({ id: 'm1' });
    });

    it('should count the downloads that it queued, none for an empty list', () => {
        fakeEngine();
        expect(queries.addChapterDownloads([])).toBe(0);
        expect(globalThis.window.Engine.DownloadManager.addDownload).not.toHaveBeenCalled();
    });
});
