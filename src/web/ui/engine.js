/**
 * Engine bridge (audit §5.3).
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

export function getEngineStatus() {
    let engine = null;
    try {
        engine = getEngine();
    } catch {
        return { connectors: 0, frontend: '', version: '' };
    }
    let frontend = '';
    try {
        const setting = engine.Settings.frontend;
        const option = setting.options.find(entry => entry.value === setting.value);
        frontend = option ? option.name : setting.value;
    } catch {
        frontend = '';
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
    return { connectors, frontend, version };
}

export function getVersionInfo() {
    try {
        const version = getEngine().Version;
        return {
            branch: version.branch.label,
            revision: version.revision.label,
            link: version.revision.link
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

export function getBookmarks() {
    try {
        return getEngine().BookmarkManager.bookmarks;
    } catch {
        return [];
    }
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
        return manager.bookmarks.some(bookmark => bookmark.key.manga === manga.id && bookmark.key.connector === manga.connector.id);
    } catch {
        return false;
    }
}

export function toggleBookmark(manga) {
    const manager = getEngine().BookmarkManager;
    if (isMangaBookmarked(manga)) {
        const bookmark = manager.bookmarks.find(entry => entry.key.manga === manga.id && entry.key.connector === manga.connector.id);
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
        return !!markedChapter && getEngine().ChaptermarkManager.isChapterMarked(chapter, markedChapter);
    } catch {
        return false;
    }
}

export function getDownloadJobs() {
    try {
        const queue = getEngine().DownloadManager.queue || {};
        return Object.values(queue)
            .filter(entry => Array.isArray(entry))
            .flat();
    } catch {
        return [];
    }
}

export function subscribeDownloads(listener) {
    let manager = null;
    try {
        manager = getEngine().DownloadManager;
    } catch {
        return () => undefined;
    }
    const handler = event => listener(event);
    manager.addEventListener('updated', handler);
    return () => manager.removeEventListener('updated', handler);
}

/**
 * Merge one manager event into the view list (classic jobs.html parity):
 * update a tracked job in place, drop it when completed, replace a failed
 * twin, and track new queued/downloading jobs.
 */
export function mergeDownloadJobs(jobList, job) {
    const list = jobList.slice();
    const index = list.indexOf(job);
    if (index > -1) {
        if (job.status === 'completed') {
            list.splice(index, 1);
        }
        return list;
    }
    const failedTwin = list.findIndex(item => job.isSame(item) && item.status === 'failed');
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

export function hasActiveDownloads() {
    return getDownloadJobs().some(job => job.status === 'queued' || job.status === 'downloading');
}

export function subscribeAppClose(listener) {
    const hakuneko = typeof window !== 'undefined' ? window.hakuneko : undefined;
    if (!hakuneko || typeof hakuneko.on !== 'function') {
        return () => undefined;
    }
    hakuneko.on('close', listener);
    return () => {
        if (typeof hakuneko.off === 'function') {
            hakuneko.off('close', listener);
        }
    };
}

export function quitApp() {
    const hakuneko = typeof window !== 'undefined' ? window.hakuneko : undefined;
    if (hakuneko) {
        hakuneko.send('quit');
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
            if (mangas.some(manga => manga.title.toLowerCase().includes(needle))) {
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
    return getEngine().Settings.getCategorizedSettings().map(group => ({
        category: group.category,
        items: group.settings.map(ref => ({ ref, value: ref.value }))
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
    const hakuneko = typeof window !== 'undefined' ? window.hakuneko : undefined;
    if (!hakuneko) {
        return null;
    }
    const result = await hakuneko.dialog.showOpenDialog({ properties: ['openFile'] });
    const filePaths = result && !result.canceled ? result.filePaths || [] : [];
    return filePaths.length ? filePaths[0] : null;
}
