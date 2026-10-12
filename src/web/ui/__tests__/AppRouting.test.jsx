// The whole interface, with the router that the application uses: the addresses, the views behind them, and how
// the panels lead to the reader.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App.jsx';
import { queryClient } from '../queries.js';
import { addChapter, addManga, createConnector, installBridge, installEngine } from './support/fakeEngine.js';

let engine = null;
let site = null;

// The router of the application is created when the module is loaded and keeps its history between the tests of a
// file. It only follows the address once it is mounted, so a test goes to its address after the first render.
async function visit(hash) {
    await act(async () => {
        window.location.hash = hash;
        window.dispatchEvent(new Event('popstate'));
    });
}

async function renderApp(hash = '#/') {
    let utils = null;
    await act(async () => {
        utils = render(<App />);
    });
    await visit(hash);
    return utils;
}

function openMenu() {
    fireEvent.click(screen.getByTitle('Toggle menu'));
}

// the query cache outlives a test, and so would the manga lists of the one before; the components go first, or they put them back
afterEach(() => {
    cleanup();
    queryClient.clear();
});

beforeEach(() => {
    site = createConnector({ id: 'site', label: 'Site' });
    engine = installEngine({ connectors: [site] });
    installBridge();
});

describe('addresses', () => {
    it('should show the start page at the root address', async () => {
        await renderApp('#/');
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome to RakKomik');
    });

    it.each([
        ['#/downloads', /The queue is empty/, 'Downloads'],
        ['#/bookmarks', /No bookmarks yet/, 'Bookmarks']
    ])('should show the view of the address %s, with its name as the heading', async (hash, text, heading) => {
        await renderApp(hash);
        expect(screen.getByText(text)).toBeTruthy();
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(heading);
    });

    it('should lead from the menu to each of the views, and back to the start', async () => {
        await renderApp('#/');
        for (const [name, hash, text] of [
            ['Downloads', '#/downloads', /The queue is empty/],
            ['Bookmarks', '#/bookmarks', /No bookmarks yet/],
            ['Start', '#/', /Welcome to RakKomik/]
        ]) {
            openMenu();
            fireEvent.click(screen.getByRole('button', { name }));
            await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
            expect(window.location.hash).toBe(hash);
            // the menu closed itself
            expect(screen.queryByText('Views')).toBeNull();
        }
    });

    it('should keep the panels and the menu when the address is one that nothing serves', async () => {
        await renderApp('#/nowhere');
        expect(screen.getByTitle('Toggle menu')).toBeTruthy();
        expect(screen.getByText('Manga List')).toBeTruthy();
        expect(screen.getByText('Chapter List')).toBeTruthy();
        expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
        expect(screen.getByText('Page not found.')).toBeTruthy();
    });
});

describe('from the panels to the reader', () => {
    function library(chapterId) {
        const manga = addManga(site, { id: 'm1', title: 'Berserk' });
        return addChapter(manga, { id: chapterId, title: `Chapter ${chapterId}`, getPages: vi.fn(callback => callback(null, ['https://img.example/1.jpg'])) });
    }

    // the user picks the manga and opens the preview of the chapter
    async function openPreview(chapter) {
        await renderApp('#/');
        fireEvent.click(await screen.findByText('Berserk'));
        await screen.findByText(chapter.title);
        fireEvent.click(screen.getByTitle('Show preview of chapter\'s pages'));
    }

    it.each([['c1'], ['12345'], ['true'], ['null'], ['0042']])('should open the reader for the chapter %s, whatever the id looks like', async id => {
        const chapter = library(id);
        await openPreview(chapter);
        await waitFor(() => expect(chapter.getPages).toHaveBeenCalledTimes(1));
        expect(window.location.hash).toMatch(/^#\/reader\?/);
        // the thumbnails of the pages: the id arrived as it left, so the chapter was found
        expect(await screen.findByTitle('Page 1')).toBeTruthy();
        expect(screen.queryByText('Chapter not found.')).toBeNull();
    });

    it('should say so when the chapter of the address is not one of the manga', async () => {
        library('c1');
        await renderApp('#/reader?connector=%22site%22&manga=%22m1%22&chapter=%22nope%22');
        expect(await screen.findByText('Chapter not found.')).toBeTruthy();
    });
});

describe('what the engine tells the application', () => {
    function cachedChapters() {
        queryClient.setQueryData(['chapters', 'site', 'm1'], []);
        queryClient.setQueryData(['mangas', 'site'], []);
        return () => queryClient.getQueryState(['chapters', 'site', 'm1']).isInvalidated;
    }

    it('should read the chapter lists again after a download event, and leave the manga lists alone', async () => {
        await renderApp('#/');
        const invalidated = cachedChapters();
        expect(invalidated()).toBe(false);
        act(() => engine.DownloadManager.emit('updated', { status: 'queued' }));
        expect(invalidated()).toBe(true);
        expect(queryClient.getQueryState(['mangas', 'site']).isInvalidated).toBe(false);
    });

    it('should read the chapter lists again after the settings were saved, a moment later', async () => {
        vi.useFakeTimers();
        await renderApp('#/');
        const invalidated = cachedChapters();
        act(() => engine.Settings.emit('saved'));
        // not at once: the engine clears its own caches first
        expect(invalidated()).toBe(false);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(invalidated()).toBe(true);
    });

    it('should stop listening to the engine when the application goes away', async () => {
        const { unmount } = await renderApp('#/');
        const downloads = vi.spyOn(engine.DownloadManager, 'removeEventListener');
        const settings = vi.spyOn(engine.Settings, 'removeEventListener');
        unmount();
        expect(downloads).toHaveBeenCalledWith('updated', expect.any(Function));
        expect(settings).toHaveBeenCalledWith('saved', expect.any(Function));
    });
});
