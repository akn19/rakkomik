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

export function isChapterMarked(chapter, markedChapter) {
    try {
        return !!markedChapter && getEngine().ChaptermarkManager.isChapterMarked(chapter, markedChapter);
    } catch {
        return false;
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
