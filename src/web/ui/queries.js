import { QueryClient } from '@tanstack/react-query';
import { getEngine, whenConnectorsReady } from './engine.js';

/**
 * TanStack Query layer (audit §5.2 server-state).
 *
 * The engine APIs are callback-based (`getMangas(cb)`, `updateMangas(cb)`,
 * `manga.getChapters(cb)`); this module wraps them in promises and owns the
 * cache keys. Cached lists are local JSON reads (fast); only an explicit
 * Update hits the sites. Engine objects are cached by reference, so chapter
 * status mutations stay visible without refetch.
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: Infinity,
            gcTime: Infinity,
            retry: false,
            refetchOnWindowFocus: false
        }
    }
});

export function getConnector(connectorId) {
    const connector = getEngine().Connectors.find(entry => entry.id === connectorId);
    if (!connector) {
        throw new Error(`Unknown connector "${connectorId}"!`);
    }
    return connector;
}

export function fetchMangaList(connector) {
    return new Promise((resolve, reject) => {
        connector.getMangas((error, mangas) => {
            if (error || !mangas) {
                reject(error || new Error(`Failed to load manga list for "${connector.label}"!`));
            } else {
                resolve(mangas);
            }
        });
    });
}

export function updateMangaList(connector) {
    return new Promise((resolve, reject) => {
        connector.updateMangas((error, mangas) => {
            if (error || !mangas) {
                reject(error || new Error(`Failed to update manga list for "${connector.label}"!`));
            } else {
                resolve(mangas);
            }
        });
    });
}

export function fetchPages(chapter) {
    return new Promise((resolve, reject) => {
        chapter.getPages((error, media) => {
            if (error || !media) {
                reject(error || new Error(`Failed to load pages for "${chapter.title}"!`));
            } else {
                resolve(media);
            }
        });
    });
}

export async function resolveChapter(connectorId, mangaId, chapterId) {
    const manga = await resolveManga(connectorId, mangaId);
    let chapters = queryClient.getQueryData(['chapters', connectorId, mangaId]);
    if (!chapters) {
        chapters = await fetchChapterList(manga);
        queryClient.setQueryData(['chapters', connectorId, mangaId], chapters);
    }
    const index = chapters.findIndex(entry => entry.id === chapterId);
    if (index < 0) {
        throw new Error(`Chapter "${chapterId}" not found!`);
    }
    return { manga, chapters, index };
}

export function fetchChapterList(manga) {
    return new Promise((resolve, reject) => {
        manga.getChapters((error, chapters) => {
            if (error || !chapters) {
                reject(error || new Error(`Failed to load chapters for "${manga.title}"!`));
            } else {
                resolve(chapters);
            }
        });
    });
}

/**
 * Resolve a Manga object for the chapters route. Prefers the cached manga
 * list (same object refs as the library), otherwise loads the list directly
 * (local JSON, no site fetch) and finds the entry.
 */
export async function resolveManga(connectorId, mangaId) {
    // a deep link (reload on the reader) may be resolved before the connectors are registered
    await whenConnectorsReady();
    const connector = getConnector(connectorId);
    let mangas = queryClient.getQueryData(['mangas', connectorId]);
    if (!mangas) {
        mangas = await fetchMangaList(connector);
        queryClient.setQueryData(['mangas', connectorId], mangas);
    }
    const manga = mangas.find(entry => entry.id === mangaId);
    if (!manga) {
        throw new Error(`Manga "${mangaId}" not found for connector "${connector.label}"!`);
    }
    return manga;
}

export function addChapterDownloads(chapters) {
    const manager = getEngine().DownloadManager;
    let added = 0;
    for (const chapter of chapters) {
        manager.addDownload(chapter);
        added++;
    }
    return added;
}
