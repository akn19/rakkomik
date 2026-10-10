// Bridge contract tests: engine.js reads window.Engine without importing it.
let bridge = null;

beforeAll(async () => {
    bridge = await import('../ui/engine.js');
});

function fakeEngine(overrides) {
    globalThis.window = Object.assign({}, globalThis.window, {
        Engine: Object.assign({
            Connectors: [{ id: 'a' }, { id: 'b' }],
            Version: {
                branch: { label: 'main' },
                revision: { label: 'a1965c' }
            }
        }, overrides)
    });
}

afterEach(() => {
    delete globalThis.window.Engine;
});

describe('ui engine bridge', () => {
    it('should snapshot connector count and version', () => {
        fakeEngine();
        expect(bridge.getEngineStatus()).toEqual({
            connectors: 2,
            version: 'main@a1965c'
        });
    });

    it('should degrade to empties when the engine global is missing', () => {
        expect(bridge.getEngineStatus()).toEqual({ connectors: 0, version: '' });
    });

    it('should subscribe to bookmark manager events and read live bookmarks', () => {
        const listeners = {};
        const bookmarks = [{ key: { manga: 'm1', connector: 'c1' }, title: { manga: 'M1', connector: 'C1' } }];
        fakeEngine({
            BookmarkManager: {
                bookmarks,
                addEventListener: vi.fn((event, handler) => {
                    listeners[event] = handler;
                }),
                removeEventListener: vi.fn(),
                deleteBookmark: vi.fn(() => true)
            }
        });
        const notify = vi.fn();
        const unsubscribe = bridge.subscribeBookmarks(notify);
        expect(bridge.getBookmarks()).toBe(bookmarks);
        listeners.added();
        expect(notify).toHaveBeenCalledTimes(1);
        expect(bridge.deleteBookmark(bookmarks[0])).toBe(true);
        unsubscribe();
    });

    it('should roundtrip a settings draft through save with numeric clamping', async () => {
        const text = { input: 'text', label: 'T', value: 'hello' };
        const numeric = { input: 'numeric', label: 'N', value: 5, min: 1, max: 10 };
        const saved = [];
        fakeEngine({
            Settings: {
                getCategorizedSettings: () => [{ category: 'General', settings: [text, numeric] }],
                save: vi.fn(async () => {
                    saved.push([text.value, numeric.value]);
                })
            }
        });
        const draft = bridge.getSettingsDraft();
        expect(draft).toHaveLength(1);
        draft[0].items[0].value = 'world';
        draft[0].items[1].value = 99;
        await bridge.saveSettingsDraft(draft);
        expect(text.value).toBe('world');
        expect(numeric.value).toBe(10);
        expect(saved).toEqual([['world', 10]]);
    });

    it('should merge download manager events like the classic job list', () => {
        const makeJob = status => {
            const instance = {
                status,
                labels: { connector: 'c', manga: 'm', chapter: `ch-${status}` },
                progress: 0,
                errors: [],
                isSame: other => other === instance,
                chapter: {}
            };
            return instance;
        };
        // new queued job is tracked
        let list = bridge.mergeDownloadJobs([], makeJob('queued'));
        expect(list).toHaveLength(1);
        // untracked completed job is ignored
        list = bridge.mergeDownloadJobs(list, makeJob('completed'));
        expect(list).toHaveLength(1);
        // tracked job completing is dropped
        const tracked = { status: 'completed', isSame: () => false };
        expect(bridge.mergeDownloadJobs([tracked], tracked)).toHaveLength(0);
        // failed twin is replaced by the retry
        const failed = { status: 'failed', isSame: () => true };
        const retry = { status: 'queued', isSame: other => other === failed };
        expect(bridge.mergeDownloadJobs([failed], retry)).toEqual([retry]);
    });

    it('should flatten the manager queue and detect active downloads', () => {
        const listeners = {};
        fakeEngine({
            DownloadManager: {
                queue: {
                    c1: Object.assign([{ status: 'downloading' }, { status: 'completed' }], { activeCount: 1 }),
                    c2: [{ status: 'failed' }]
                },
                addEventListener: vi.fn((event, handler) => {
                    listeners[event] = handler;
                }),
                removeEventListener: vi.fn(),
                addDownload: vi.fn()
            }
        });
        expect(bridge.getDownloadJobs()).toHaveLength(3);
        expect(bridge.hasActiveDownloads()).toBe(true);
        const notify = vi.fn();
        const unsubscribe = bridge.subscribeDownloads(notify);
        listeners.updated({ detail: 'job' });
        expect(notify).toHaveBeenCalledTimes(1);
        unsubscribe();
        bridge.restartChapterDownload({ id: 'c' });
    });

    it('should find connectors by local manga titles', async () => {
        fakeEngine({
            Connectors: [{ id: 'c1' }, { id: 'c2' }],
            Storage: {
                loadMangaList: vi.fn(async id => (id === 'c1' ? [{ title: 'One Piece' }] : []))
            }
        });
        await expect(bridge.findConnectorsByManga('piece')).resolves.toEqual(['c1']);
        await expect(bridge.findConnectorsByManga('naruto')).resolves.toEqual([]);
    });

    it('should browse directories and files through the available bridges', async () => {
        fakeEngine({
            Storage: { folderBrowser: vi.fn(async () => '/tmp/manga') }
        });
        await expect(bridge.browseDirectory('/tmp')).resolves.toBe('/tmp/manga');
        globalThis.window.hakuneko = {
            dialog: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/tmp/a.epub'] })) }
        };
        await expect(bridge.browseFile()).resolves.toBe('/tmp/a.epub');
        delete globalThis.window.hakuneko;
    });
    it('should expose version links, reader flag and settings events', () => {
        const listeners = {};
        fakeEngine({
            Version: { branch: { label: 'main' }, revision: { label: 'a1965c', link: 'https://example.test/rev' } },
            Settings: {
                readerEnabled: { value: false },
                addEventListener: vi.fn((event, handler) => {
                    listeners[event] = handler;
                }),
                removeEventListener: vi.fn()
            }
        });
        expect(bridge.getVersionInfo()).toEqual({ branch: 'main', revision: 'a1965c', link: 'https://example.test/rev' });
        expect(bridge.isReaderEnabled()).toBe(false);
        const notify = vi.fn();
        const unsubscribe = bridge.subscribeSettings(notify);
        listeners.saved();
        expect(notify).toHaveBeenCalledTimes(1);
        unsubscribe();
        expect(globalThis.window.Engine.Settings.removeEventListener).toHaveBeenCalledWith('saved', expect.any(Function));
    });

    it('should degrade version, reader flag and settings events without an engine', () => {
        expect(bridge.getVersionInfo()).toEqual({ branch: '', revision: '', link: '' });
        expect(bridge.isReaderEnabled()).toBe(true);
        expect(bridge.subscribeSettings(vi.fn())()).toBeUndefined();
    });

    it('should delegate folder, bookmark import and chaptermark removal to the engine', async () => {
        const chapter = { id: 'c' };
        const marked = { chapterID: 'c' };
        const file = { name: 'bookmarks.db' };
        fakeEngine({
            Storage: { showFolderContent: vi.fn() },
            BookmarkManager: { importBookmarks: vi.fn(async () => undefined) },
            ChaptermarkManager: { deleteChaptermark: vi.fn() }
        });
        bridge.showChapterFolder(chapter);
        expect(globalThis.window.Engine.Storage.showFolderContent).toHaveBeenCalledWith(chapter);
        await bridge.importBookmarksFile(file);
        expect(globalThis.window.Engine.BookmarkManager.importBookmarks).toHaveBeenCalledWith(file);
        bridge.deleteChaptermark(marked);
        expect(globalThis.window.Engine.ChaptermarkManager.deleteChaptermark).toHaveBeenCalledWith(marked);
    });
    it('should snapshot the connector registry and notify on registration', async () => {
        const listeners = {};
        const list = [{ id: 'a' }];
        const registry = {
            list,
            isReady: false,
            addEventListener: vi.fn((event, handler) => {
                listeners[event] = handler;
            }),
            removeEventListener: vi.fn()
        };
        fakeEngine({ ConnectorRegistry: registry, Connectors: list });
        const first = bridge.getConnectorsSnapshot();
        expect(first).toEqual({ connectors: [{ id: 'a' }], ready: false });
        // unchanged registry => same identity (required by useSyncExternalStore)
        expect(bridge.getConnectorsSnapshot()).toBe(first);
        list.push({ id: 'b' });
        const second = bridge.getConnectorsSnapshot();
        expect(second).not.toBe(first);
        expect(second.connectors).toHaveLength(2);
        registry.isReady = true;
        expect(bridge.getConnectorsSnapshot().ready).toBe(true);
        const notify = vi.fn();
        const unsubscribe = bridge.subscribeConnectors(notify);
        listeners.registered();
        listeners.ready();
        expect(notify).toHaveBeenCalledTimes(2);
        unsubscribe();
        expect(registry.removeEventListener).toHaveBeenCalledTimes(2);
    });

    it('should treat an engine without a registry as fully loaded and wait for readiness', async () => {
        fakeEngine();
        expect(bridge.getConnectorsSnapshot().ready).toBe(true);
        expect(bridge.subscribeConnectors(vi.fn())()).toBeUndefined();
        let release = null;
        fakeEngine({ ConnectorsReady: new Promise(resolve => { release = resolve; }) });
        let done = false;
        const waiting = bridge.whenConnectorsReady().then(() => { done = true; });
        await Promise.resolve();
        expect(done).toBe(false);
        release([]);
        await waiting;
        expect(done).toBe(true);
    });

    it('should return an empty snapshot without an engine', () => {
        expect(bridge.getConnectorsSnapshot()).toEqual({ connectors: [], ready: false });
    });
});
