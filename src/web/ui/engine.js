/**
 * Engine bridge.
 *
 * The engine is NOT imported as a module: it is loaded as classic scripts
 * that expose `window.Engine` BEFORE the React shell mounts (see
 * `loadEngine()` in `index.html`; connectors depend on that global too).
 * This adapter only reads the global, so engine logic stays untouched and
 * dynamically-imported connectors are unaffected.
 *
 * Reads are snapshot-style (the engine is fully initialized before mount);
 * live lists additionally expose subscribe/getSnapshot pairs for
 * `useSyncExternalStore`. Missing pieces degrade to empty values (never
 * throw, except the raw accessor) so the shell can still paint.
 */
export function getEngine() {
    const engine = typeof window !== 'undefined' ? window.Engine : undefined;
    if (!engine) {
        throw new Error('Engine global is not available (loadEngine() must run before mount)!');
    }
    return engine;
}

const NO_CONNECTORS = { connectors: [], ready: false };
let connectorsCache = { registry: null, length: -1, ready: false, value: NO_CONNECTORS };

/**
 * Snapshot of the connector registry for `useSyncExternalStore`: the identity
 * only changes when connectors were registered (batches) or loading finished.
 * Engines without a registry (plain list) count as fully loaded.
 */
export function getConnectorsSnapshot() {
    let engine = null;
    try {
        engine = getEngine();
    } catch {
        return NO_CONNECTORS;
    }
    const registry = engine.ConnectorRegistry || null;
    const list = registry ? registry.list : engine.Connectors || [];
    const ready = registry ? registry.isReady : true;
    if (
        connectorsCache.registry !== registry ||
        connectorsCache.length !== list.length ||
        connectorsCache.ready !== ready
    ) {
        connectorsCache = {
            registry,
            length: list.length,
            ready,
            value: { connectors: list.slice(), ready },
        };
    }
    return connectorsCache.value;
}

export function subscribeConnectors(notify) {
    let registry = null;
    try {
        registry = getEngine().ConnectorRegistry;
    } catch {
        return () => undefined;
    }
    if (!registry) {
        return () => undefined;
    }
    const handler = () => notify();
    registry.addEventListener('registered', handler);
    registry.addEventListener('ready', handler);
    return () => {
        registry.removeEventListener('registered', handler);
        registry.removeEventListener('ready', handler);
    };
}

export async function whenConnectorsReady() {
    try {
        await getEngine().ConnectorsReady;
    } catch {
        // no engine (tests, early paint): nothing to wait for
    }
}

/**
 * Progress of the running manga list update of a connector: the requests it completed so far and the seconds
 * since it started; `undefined` when the connector is not updating (or is no engine connector).
 */
export function getUpdateProgress(connector) {
    const progress = connector ? connector.updateProgress : undefined;
    if (!progress) {
        return undefined;
    }
    return {
        requests: progress.requests,
        seconds: Math.max(0, Math.floor((Date.now() - progress.startedAt) / 1000)),
    };
}

export function getEngineStatus() {
    let engine = null;
    try {
        engine = getEngine();
    } catch {
        return { connectors: 0, version: '' };
    }
    let version = '';
    try {
        version = `${engine.Version.branch.label}@${engine.Version.revision.label}`;
    } catch {
        version = '';
    }
    let connectors = 0;
    try {
        connectors = engine.Connectors.length;
    } catch {
        connectors = 0;
    }
    return { connectors, version };
}

export function getVersionInfo() {
    try {
        const version = getEngine().Version;
        return {
            branch: version.branch.label,
            revision: version.revision.label,
            link: version.revision.link,
        };
    } catch {
        return { branch: '', revision: '', link: '' };
    }
}

export function isReaderEnabled() {
    try {
        return !!getEngine().Settings.readerEnabled.value;
    } catch {
        return true;
    }
}

export function subscribeSettings(listener) {
    let settings = null;
    try {
        settings = getEngine().Settings;
    } catch {
        return () => undefined;
    }
    const handler = () => listener();
    settings.addEventListener('saved', handler);
    return () => settings.removeEventListener('saved', handler);
}

const NO_BOOKMARKS = [];
let bookmarksCache = NO_BOOKMARKS;

/**
 * Snapshot of the bookmarks for `useSyncExternalStore`. The manager changes its list in place (add, remove, sort,
 * import) and announces it with an event, but React compares snapshots by identity: the list itself would never redraw
 * anything. So this hands out a copy that is replaced only when the list differs from the copy given out last.
 */
export function getBookmarks() {
    let list = NO_BOOKMARKS;
    try {
        list = getEngine().BookmarkManager.bookmarks;
    } catch {
        return NO_BOOKMARKS;
    }
    if (
        list.length !== bookmarksCache.length ||
        list.some((bookmark, index) => bookmark !== bookmarksCache[index])
    ) {
        bookmarksCache = list.slice();
    }
    return bookmarksCache;
}

export function subscribeBookmarks(notify) {
    let manager = null;
    try {
        manager = getEngine().BookmarkManager;
    } catch {
        return () => undefined;
    }
    const handler = () => notify();
    manager.addEventListener('added', handler);
    manager.addEventListener('removed', handler);
    manager.addEventListener('changed', handler);
    return () => {
        manager.removeEventListener('added', handler);
        manager.removeEventListener('removed', handler);
        manager.removeEventListener('changed', handler);
    };
}

export function deleteBookmark(bookmark) {
    return getEngine().BookmarkManager.deleteBookmark(bookmark);
}

export function isMangaBookmarked(manga) {
    try {
        const manager = getEngine().BookmarkManager;
        return manager.bookmarks.some(
            (bookmark) =>
                bookmark.key.manga === manga.id && bookmark.key.connector === manga.connector.id,
        );
    } catch {
        return false;
    }
}

export function toggleBookmark(manga) {
    const manager = getEngine().BookmarkManager;
    if (isMangaBookmarked(manga)) {
        const bookmark = manager.bookmarks.find(
            (entry) => entry.key.manga === manga.id && entry.key.connector === manga.connector.id,
        );
        return manager.deleteBookmark(bookmark);
    }
    return manager.addBookmark(manga);
}

export function getChaptermark(manga) {
    try {
        return getEngine().ChaptermarkManager.getChaptermark(manga) || null;
    } catch {
        return null;
    }
}

export function subscribeChaptermarks(notify) {
    let manager = null;
    try {
        manager = getEngine().ChaptermarkManager;
    } catch {
        return () => undefined;
    }
    const handler = () => notify();
    manager.addEventListener('changed', handler);
    return () => manager.removeEventListener('changed', handler);
}

export function deleteChaptermark(markedChapter) {
    getEngine().ChaptermarkManager.deleteChaptermark(markedChapter);
}

export function isChapterMarked(chapter, markedChapter) {
    try {
        return (
            !!markedChapter &&
            getEngine().ChaptermarkManager.isChapterMarked(chapter, markedChapter)
        );
    } catch {
        return false;
    }
}

// The manager takes a job out of its queue when the job starts, so the queue only holds what still waits: a job that
// downloads, or one that failed, is known from the events of the manager alone. They are followed from the first call
// on (the application subscribes when it starts, before anything can be downloaded), the way the list of the jobs bar is.
const jobTrackers = new WeakMap();

function trackJobs(manager) {
    let tracker = jobTrackers.get(manager);
    if (!tracker) {
        tracker = {
            jobs: Object.values(manager.queue || {})
                .filter((entry) => Array.isArray(entry))
                .flat(),
        };
        manager.addEventListener('updated', (event) => {
            tracker.jobs = mergeDownloadJobs(tracker.jobs, event.detail);
        });
        jobTrackers.set(manager, tracker);
    }
    return tracker;
}

/**
 * The jobs that wait, download or failed. The list is replaced when it changes, never changed in place.
 */
export function getDownloadJobs() {
    try {
        return trackJobs(getEngine().DownloadManager).jobs;
    } catch {
        return [];
    }
}

export function subscribeDownloads(listener) {
    let manager = null;
    try {
        manager = getEngine().DownloadManager;
        // before the listener: the list of jobs is up to date when a listener is told about an event
        trackJobs(manager);
    } catch {
        return () => undefined;
    }
    const handler = (event) => listener(event);
    manager.addEventListener('updated', handler);
    return () => manager.removeEventListener('updated', handler);
}

/**
 * Calls the listener when the status of a chapter changes (queued, downloading, completed, failed). The chapter
 * objects change in place, so a view that shows their status has to redraw itself on this.
 */
export function subscribeChapterStatus(listener) {
    // the engine announces it on the document, under the name Enums.EventListener.onChapterStatusChanged
    document.addEventListener('onChapterStatusChanged', listener);
    return () => document.removeEventListener('onChapterStatusChanged', listener);
}

/**
 * Tell the engine what the user selected, which the Discord presence shows: it listens for these events on the document,
 * where the pages of the classic interface announced them (the chapter is announced by the engine itself, when its pages
 * are asked for). The names are Enums.EventListener.onSelectConnector and .onSelectManga.
 */
export function announceConnector(connector) {
    document.dispatchEvent(new CustomEvent('onSelectConnector', { detail: connector }));
}

export function announceManga(manga) {
    document.dispatchEvent(new CustomEvent('onSelectManga', { detail: manga }));
}

/**
 * Merge one manager event into the view list (classic jobs.html parity):
 * update a tracked job in place, drop it when completed or canceled, replace a failed
 * twin, and track new queued/downloading jobs.
 */
export function mergeDownloadJobs(jobList, job) {
    const list = jobList.slice();
    const index = list.indexOf(job);
    if (index > -1) {
        // a job that is over, or that was canceled, is not a download any more
        if (job.status === 'completed' || job.status === 'canceled') {
            list.splice(index, 1);
        }
        return list;
    }
    const failedTwin = list.findIndex((item) => job.isSame(item) && item.status === 'failed');
    if (failedTwin > -1) {
        list.splice(failedTwin, 1);
    }
    if (job.status === 'queued' || job.status === 'downloading') {
        list.push(job);
    }
    return list;
}

export function restartChapterDownload(chapter) {
    getEngine().DownloadManager.addDownload(chapter);
}

/**
 * Stop a download that waits or runs.
 * @returns {boolean} whether it was stopped (not when it is over, or when its pages are being written)
 */
export function cancelDownload(job) {
    return getEngine().DownloadManager.cancel(job);
}

/**
 * Stop the download of a chapter, wherever it is in the process.
 * @returns {boolean} whether a download was stopped
 */
export function cancelChapterDownload(chapter) {
    return getEngine().DownloadManager.cancelChapter(chapter);
}

/**
 * Stop every download that waits or runs.
 * @returns {number} how many were stopped
 */
export function cancelAllDownloads() {
    return getEngine().DownloadManager.cancelAll();
}

export function hasActiveDownloads() {
    return getDownloadJobs().some((job) => job.status === 'queued' || job.status === 'downloading');
}

export function subscribeAppClose(listener) {
    const bridge = typeof window !== 'undefined' ? window.hakuneko : undefined;
    if (!bridge || typeof bridge.on !== 'function') {
        return () => undefined;
    }
    bridge.on('close', listener);
    return () => {
        if (typeof bridge.off === 'function') {
            bridge.off('close', listener);
        }
    };
}

export function quitApp() {
    const bridge = typeof window !== 'undefined' ? window.hakuneko : undefined;
    if (bridge) {
        bridge.send('quit');
    }
}

export function openExternalLink(url) {
    if (url && typeof window !== 'undefined') {
        window.open(url, '_blank', 'nodeIntegration=no');
    }
}

export async function findConnectorsByManga(pattern) {
    const engine = getEngine();
    const needle = pattern.trim().toLowerCase();
    const matches = [];
    for (const connector of engine.Connectors) {
        try {
            const mangas = await engine.Storage.loadMangaList(connector.id);
            if (mangas.some((manga) => manga.title.toLowerCase().includes(needle))) {
                matches.push(connector.id);
            }
        } catch {
            // connectors without a synchronized list simply do not match
        }
    }
    return matches;
}

export function showChapterFolder(chapter) {
    getEngine().Storage.showFolderContent(chapter);
}

export function importBookmarksFile(file) {
    return getEngine().BookmarkManager.importBookmarks(file);
}

export function markChapterRead(chapter) {
    try {
        getEngine().ChaptermarkManager.addChaptermark(chapter);
    } catch {
        // reading progress is best-effort; never break the reader
    }
}

export function toggleChaptermark(chapter, markedChapter) {
    const manager = getEngine().ChaptermarkManager;
    if (markedChapter && manager.isChapterMarked(chapter, markedChapter)) {
        manager.deleteChaptermark(markedChapter);
    } else {
        manager.addChaptermark(chapter);
    }
}

export function getSettingsDraft() {
    return getEngine()
        .Settings.getCategorizedSettings()
        .map((group) => ({
            category: group.category,
            items: group.settings.map((ref) => ({ ref, value: ref.value })),
        }));
}

export async function saveSettingsDraft(draft) {
    for (const group of draft) {
        for (const item of group.items) {
            let value = item.value;
            // Mirror Settings._getValidValue clamping for numerics.
            if (item.ref.input === 'numeric' && value !== '' && value !== undefined) {
                value = Number(value);
                if (item.ref.min !== undefined && value < item.ref.min) {
                    value = item.ref.min;
                }
                if (item.ref.max !== undefined && value > item.ref.max) {
                    value = item.ref.max;
                }
            }
            item.ref.value = value;
        }
    }
    await getEngine().Settings.save();
}

export async function browseDirectory(currentPath) {
    return getEngine().Storage.folderBrowser(currentPath);
}

export async function browseFile() {
    const bridge = typeof window !== 'undefined' ? window.hakuneko : undefined;
    if (!bridge) {
        return null;
    }
    const result = await bridge.dialog.showOpenDialog({ properties: ['openFile'] });
    const filePaths = result && !result.canceled ? result.filePaths || [] : [];
    return filePaths.length ? filePaths[0] : null;
}
