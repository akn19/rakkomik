// The part of the engine that the interface reads through `window.Engine` and `window.hakuneko` (see engine.js): the same
// members and events, none of the real work. Connectors, mangas and chapters are plain objects that answer like the
// classes of the engine do (`getMangas(callback)`, `getChapters(callback)`, `getPages(callback)`). The managers change
// their lists IN PLACE and announce it with an event, like the real ones: a view that compares snapshots by identity
// would not see such a change, which is exactly what the tests have to be able to show.

class Emitter extends EventTarget {
    emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }
}

export function createConnector(fields = {}) {
    const connector = {
        id: 'site',
        label: 'Site',
        url: 'https://site.example',
        tags: [],
        links: {},
        mangas: [],
        ...fields
    };
    connector.getMangas = fields.getMangas || vi.fn(callback => callback(null, connector.mangas));
    connector.updateMangas = fields.updateMangas || vi.fn(callback => callback(null, connector.mangas));
    return connector;
}

export function addManga(connector, fields = {}) {
    const number = connector.mangas.length + 1;
    const manga = { id: `m${number}`, title: `Manga ${number}`, connector, chapters: [], ...fields };
    manga.getChapters = fields.getChapters || vi.fn(callback => callback(null, manga.chapters));
    connector.mangas.push(manga);
    return manga;
}

export function addChapter(manga, fields = {}) {
    const number = manga.chapters.length + 1;
    const chapter = {
        id: `c${number}`,
        title: `Chapter ${number}`,
        status: 'available',
        language: '',
        manga,
        file: { full: `/downloads/${manga.id}/c${number}` },
        ...fields
    };
    chapter.getPages = fields.getPages || vi.fn(callback => callback(null, []));
    manga.chapters.push(chapter);
    return chapter;
}

export function createDownloadJob(chapter, fields = {}) {
    const job = {
        chapter,
        status: 'queued',
        progress: 0,
        errors: [],
        labels: { connector: chapter.manga.connector.label, manga: chapter.manga.title, chapter: chapter.title },
        ...fields
    };
    job.isSame = other => other.chapter === chapter;
    return job;
}

export function createSettings(fields = {}) {
    const settings = Object.assign(new Emitter(), {
        readerEnabled: { value: true },
        // [{ category, settings: [{ input, label, description, value, min, max, options }] }]
        groups: [],
        getCategorizedSettings: () => settings.groups,
        save: vi.fn(async () => settings.emit('saved')),
        NovelColorProfile: () => ({ background: 'white', text: 'black' })
    }, fields);
    return settings;
}

function createBookmarkManager() {
    const manager = Object.assign(new Emitter(), {
        bookmarks: [],
        addBookmark: vi.fn(manga => {
            if (manager.bookmarks.some(bookmark => bookmark.key.manga === manga.id && bookmark.key.connector === manga.connector.id)) {
                return false;
            }
            const bookmark = {
                key: { connector: manga.connector.id, manga: manga.id },
                title: { connector: manga.connector.label, manga: manga.title }
            };
            manager.bookmarks.push(bookmark);
            manager.bookmarks.sort((a, b) => (a.title.manga.toLowerCase() < b.title.manga.toLowerCase() ? -1 : 1));
            manager.emit('added', bookmark);
            return true;
        }),
        deleteBookmark: vi.fn(bookmark => {
            const index = manager.bookmarks.findIndex(entry => entry.key.manga === bookmark.key.manga && entry.key.connector === bookmark.key.connector);
            if (index < 0) {
                return false;
            }
            manager.bookmarks.splice(index, 1);
            manager.emit('removed', bookmark);
            return true;
        }),
        importBookmarks: vi.fn(async () => undefined)
    });
    return manager;
}

function createChaptermarkManager() {
    const manager = Object.assign(new Emitter(), {
        chaptermarks: [],
        getChaptermark: manga => manager.chaptermarks.find(mark => mark.mangaID === manga.id && mark.connectorID === manga.connector.id),
        isChapterMarked: (chapter, mark) => !!mark && !!chapter
            && (mark.chapterID === chapter.id || mark.chapterTitle === chapter.title)
            && mark.mangaID === chapter.manga.id
            && mark.connectorID === chapter.manga.connector.id,
        addChaptermark: vi.fn(chapter => {
            const mark = {
                connectorID: chapter.manga.connector.id,
                mangaID: chapter.manga.id,
                chapterID: chapter.id,
                chapterTitle: chapter.title
            };
            const index = manager.chaptermarks.findIndex(entry => entry.connectorID === mark.connectorID && entry.mangaID === mark.mangaID);
            if (index < 0) {
                manager.chaptermarks.push(mark);
            } else {
                manager.chaptermarks[index] = mark;
            }
            manager.emit('changed', manager.chaptermarks);
        }),
        deleteChaptermark: vi.fn(mark => {
            const index = manager.chaptermarks.findIndex(entry => entry.connectorID === mark.connectorID && entry.mangaID === mark.mangaID);
            if (index > -1) {
                manager.chaptermarks.splice(index, 1);
                manager.emit('changed', manager.chaptermarks);
            }
        })
    });
    return manager;
}

function createDownloadManager() {
    // an array that is used as a map, like the real queue
    const queue = [];
    const manager = Object.assign(new Emitter(), {
        queue,
        addDownload: vi.fn(chapter => {
            const id = chapter.manga.connector.id;
            queue[id] = queue[id] || [];
            const job = createDownloadJob(chapter);
            queue[id].push(job);
            manager.emit('updated', job);
        })
    });
    return manager;
}

/**
 * Put a fake engine into `window.Engine`.
 * @param {object} [options]
 * @param {object[]} [options.connectors] the registered connectors
 * @param {boolean} [options.ready] whether the background loading of the connectors has finished
 * @param {object} [options.engine] members that replace those of the default engine
 * @returns {object} the engine; `engine.ConnectorRegistry` announces `registered` and `ready` like the real one
 */
export function installEngine({ connectors = [], ready = true, engine: overrides = {} } = {}) {
    const registry = Object.assign(new Emitter(), { list: connectors, isReady: ready });
    const engine = {
        Connectors: connectors,
        ConnectorRegistry: registry,
        ConnectorsReady: Promise.resolve(connectors),
        Version: { branch: { label: 'main' }, revision: { label: 'abc1234', link: 'https://example.test/revision' } },
        Settings: createSettings(),
        BookmarkManager: createBookmarkManager(),
        ChaptermarkManager: createChaptermarkManager(),
        DownloadManager: createDownloadManager(),
        Storage: {
            loadMangaList: vi.fn(async () => []),
            showFolderContent: vi.fn(),
            folderBrowser: vi.fn(async () => undefined)
        },
        ...overrides
    };
    window.Engine = engine;
    return engine;
}

/**
 * Put a fake of the bridge of the main process into `window.hakuneko` (see preload.js).
 * @returns {object} the bridge; `bridge.emit('close')` calls the listeners that were added with `bridge.on('close', ...)`
 */
export function installBridge() {
    const listeners = new Map();
    const bridge = {
        send: vi.fn(),
        on: vi.fn((channel, listener) => {
            listeners.set(channel, [...(listeners.get(channel) || []), listener]);
        }),
        off: vi.fn((channel, listener) => {
            listeners.set(channel, (listeners.get(channel) || []).filter(entry => entry !== listener));
        }),
        emit: (channel, ...args) => (listeners.get(channel) || []).forEach(listener => listener(...args)),
        window: {
            minimize: vi.fn(async () => undefined),
            maximize: vi.fn(async () => undefined),
            unmaximize: vi.fn(async () => undefined),
            isMaximized: vi.fn(async () => false),
            close: vi.fn(async () => undefined)
        },
        dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) }
    };
    window.hakuneko = bridge;
    return bridge;
}
