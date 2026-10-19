// The page viewer of a chapter: thumbnails to pick a page, the reading mode with its toolbar and keys, and the way it
// steps through the chapters of the panel. The engine is a fake that answers like the real one (see support/fakeEngine.js),
// the router is a real one in memory, and the last group renders the whole application with its real route configuration.
import { StrictMode } from 'react';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createNovelPage } from '../../mjs/engine/Novel.mjs';
import { useSelection } from '../selection.jsx';
import ReaderView from '../views/Reader.jsx';
import {
    addChapter,
    addManga,
    createConnector,
    createSettings,
    installEngine,
} from './support/fakeEngine.js';
import { renderRouted } from './support/render.jsx';

// the router and the queries answer in their own time: a failure may take longer to show than a success needs on a busy machine
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20000 });

const START = 'Start page';
const RESOLVING = 'Resolving chapter …';
const LOADING = 'Loading pages …';
const NOT_FOUND = 'Chapter not found.';
const SPACE_AGAIN = 'Press Space again for the next chapter.';
const DEFAULT_URL = '/reader?connector=site&manga=m1&chapter=c2';
// the tooltip of the button that closes the reader (the application has other buttons that start with Close)
const CLOSE = /^Close( the preview)? \(ESC\)$/;

// the keys of the reader as a browser reports them: `key` is what was typed, `code` the physical key
const ESCAPE = { key: 'Escape', code: 'Escape' };
const ARROW_LEFT = { key: 'ArrowLeft', code: 'ArrowLeft' };
const ARROW_RIGHT = { key: 'ArrowRight', code: 'ArrowRight' };
const ARROW_UP = { key: 'ArrowUp', code: 'ArrowUp' };
const ARROW_DOWN = { key: 'ArrowDown', code: 'ArrowDown' };
const PAGE_UP = { key: 'PageUp', code: 'PageUp' };
const PAGE_DOWN = { key: 'PageDown', code: 'PageDown' };
const ZOOM_IN = { key: '+', code: 'Equal' };
const ZOOM_OUT = { key: '-', code: 'Minus' };
const DEFAULT_WIDTH = { key: '/', code: 'Slash' };
const FIT_WIDTH = { key: '*', code: 'NumpadMultiply' };
const SPACE = { key: ' ', code: 'Space' };

const imagesOf = (id) => [1, 2, 3].map((number) => `https://img.example/${id}/${number}.jpg`);

/**
 * Presses a key anywhere in the window.
 * @returns {boolean} false when the reader took the key over (it prevented the default of the browser)
 */
function press(key, init = {}, target = document.body) {
    return fireEvent.keyDown(target, { ...key, ...init });
}

/**
 * A manga whose chapters are listed the way sites list them, the newest first: the entry above "Chapter 2" is "Chapter 3".
 * @param {object} [options]
 * @param {string[]} [options.ids] the ids of the chapters, in the order of the list
 * @param {function(string): string[]} [options.pagesOf] the pages that the engine finds for a chapter
 * @param {object} [options.engine] members that replace those of the fake engine
 */
function createLibrary({ ids = ['c3', 'c2', 'c1'], pagesOf = imagesOf, engine = {} } = {}) {
    const connector = createConnector({ id: 'site', label: 'Site' });
    const manga = addManga(connector, { id: 'm1', title: 'Manga One' });
    const chapters = ids.map((id) =>
        addChapter(manga, {
            id,
            title: `Chapter ${id.replace(/^c/, '')}`,
            getPages: vi.fn((callback) => callback(null, pagesOf(id))),
        }),
    );
    return {
        connector,
        manga,
        chapters,
        engine: installEngine({ connectors: [connector], engine }),
    };
}

/**
 * Renders the reader under the route that the application gives it, the start page under the root. `selection.current` is the
 * selection that the panels share with the reader. A test that does not make its own engine gets the library of createLibrary.
 */
async function renderReader(
    url = DEFAULT_URL,
    { extra = null, library = true, strict = false } = {},
) {
    if (library && !window.Engine) {
        createLibrary();
    }
    const selection = {};
    function SelectionProbe() {
        selection.current = useSelection();
        return null;
    }
    const reader = strict ? (
        <StrictMode>
            <ReaderView />
        </StrictMode>
    ) : (
        <ReaderView />
    );
    const view = await renderRouted(<p>{START}</p>, {
        url,
        routes: [
            {
                path: '/reader',
                element: (
                    <>
                        {reader}
                        <SelectionProbe />
                        {extra}
                    </>
                ),
            },
        ],
    });
    return { ...view, selection, user: userEvent.setup() };
}

/** The reader with the thumbnails of the chapter on the screen. */
async function openThumbnails(url, options) {
    const view = await renderReader(url, options);
    await screen.findByTitle('Page 1');
    return view;
}

/** The reader in reading mode, started at the given page (0 is the first). */
async function openReading(url, { page = 0, ...options } = {}) {
    const view = await openThumbnails(url, options);
    await view.user.click(screen.getByTitle(`Page ${page + 1}`));
    return view;
}

const thumbnails = () => screen.getAllByTitle(/^Page \d+$/);
const images = () => screen.getAllByAltText(/^Page \d+$/);
const isReading = () => document.querySelector('[data-reading]') !== null;
const widthOf = () => images()[0].style.width;
const marginOf = () => images()[0].style.margin;
const readingContainer = () => document.getElementById('rk-page-0').parentElement;
const thumbnailContainer = () => screen.getByTitle('Page 1').parentElement;
// the first element of the toolbar is the title of the chapter
const shownTitle = () => screen.getByTitle(CLOSE).parentElement.querySelector('span').textContent;
const titleIs = (title) => waitFor(() => expect(shownTitle()).toBe(title));
const shownWidth = () => screen.getByText(/^Image Width:/).textContent;

/** Collects the frames that the reader asks for, `flush` runs them (each may ask for the next one). */
function captureFrames() {
    const queue = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) =>
        queue.push(callback),
    );
    return () => {
        while (queue.length) {
            queue.shift()(0);
        }
    };
}

/** A layout for the images in reading mode (happy-dom has none): the rectangles that the browser would report. */
function layOut(rectangles, height = 1000) {
    window.innerHeight = height;
    const pages = images();
    pages.forEach((page, index) => {
        const { top, bottom } = rectangles[index];
        vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({
            top,
            bottom,
            left: 0,
            right: 0,
            x: 0,
            y: top,
            width: 0,
            height: bottom - top,
        });
    });
    return pages;
}

/** What `scrollIntoView` was called on, as the ids of the elements. */
function scrolledTo(spy) {
    return spy.mock.contexts.map((element) => element.id);
}

const viewport = window.innerHeight;
let consoleError = null;
let consoleWarn = null;

beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    // React and the router report their complaints (an update outside act, an unknown prop, ...) on the console
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    window.innerHeight = viewport;
});

describe('the chapter of the address', () => {
    it('should say that it resolves the chapter until the list of chapters is there', async () => {
        const answers = [];
        const connector = createConnector({ id: 'site' });
        const manga = addManga(connector, {
            id: 'm1',
            getChapters: vi.fn((callback) => {
                answers.push(callback);
            }),
        });
        addChapter(manga, { id: 'c1', title: 'Chapter 1' });
        installEngine({ connectors: [connector] });
        await renderReader('/reader?connector=site&manga=m1&chapter=c1');
        expect(await screen.findByText(RESOLVING)).toBeTruthy();
        expect(screen.queryByTitle(CLOSE)).toBeNull();
        await act(async () => answers[0](null, manga.chapters));
        expect(await screen.findByText('Chapter 1')).toBeTruthy();
        expect(screen.queryByText(RESOLVING)).toBeNull();
        expect(manga.getChapters).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['an unknown connector', '/reader?connector=nowhere&manga=m1&chapter=c2'],
        ['an unknown manga', '/reader?connector=site&manga=nowhere&chapter=c2'],
        ['an unknown chapter', '/reader?connector=site&manga=m1&chapter=nowhere'],
        ['a chapter that belongs to another manga', '/reader?connector=site&manga=m2&chapter=c2'],
        ['no parameters at all', '/reader'],
    ])(
        'should say that the chapter is not found for %s, and offer the way out',
        async (name, url) => {
            const { connector, chapters, engine } = createLibrary();
            addManga(connector, { id: 'm2', title: 'Manga Two' });
            const { user } = await renderReader(url);
            expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
            expect(chapters[1].getPages).not.toHaveBeenCalled();
            await user.click(screen.getByRole('button', { name: 'Close' }));
            expect(await screen.findByText(START)).toBeTruthy();
            expect(engine.ChaptermarkManager.addChaptermark).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['an error', (callback) => callback(new Error('The manga folder is gone'), [])],
        ['no list at all', (callback) => callback(null, undefined)],
    ])(
        'should say that the chapter is not found when the engine answers the chapter list with %s',
        async (name, answer) => {
            const connector = createConnector({ id: 'site' });
            addManga(connector, { id: 'm1', getChapters: vi.fn(answer) });
            installEngine({ connectors: [connector] });
            await renderReader('/reader?connector=site&manga=m1&chapter=c1');
            expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
        },
    );

    it('should say that the chapter is not found when there is no engine, instead of failing', async () => {
        await renderReader('/reader?connector=site&manga=m1&chapter=c1', { library: false });
        expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
    });

    it('should let Escape leave the page of a chapter that is not found', async () => {
        createLibrary();
        await renderReader('/reader?connector=site&manga=m1&chapter=nowhere');
        await screen.findByText(NOT_FOUND);
        press(ESCAPE);
        expect(await screen.findByText(START)).toBeTruthy();
    });

    it('should wait for the connectors of the engine when it is opened by a deep link, instead of calling the chapter missing', async () => {
        const connectors = [];
        let registered = null;
        const gate = new Promise((resolve) => {
            registered = resolve;
        });
        const connector = createConnector({ id: 'site' });
        const manga = addManga(connector, { id: 'm1' });
        addChapter(manga, {
            id: 'c1',
            title: 'Chapter 1',
            getPages: vi.fn((callback) => callback(null, imagesOf('c1'))),
        });
        installEngine({ connectors, ready: false, engine: { ConnectorsReady: gate } });
        await renderReader('/reader?connector=site&manga=m1&chapter=c1');
        expect(await screen.findByText(RESOLVING)).toBeTruthy();
        expect(screen.queryByText(NOT_FOUND)).toBeNull();
        connectors.push(connector);
        await act(async () => registered(connectors));
        expect(await screen.findByTitle('Page 1')).toBeTruthy();
    });

    it('should show the title of the chapter as text, whatever it holds', async () => {
        const { chapters } = createLibrary();
        chapters[1].title = '<img src=x onerror="window.pwned = 1"> & <b>bold</b>';
        await renderReader();
        await screen.findByTitle('Page 1');
        expect(shownTitle()).toBe('<img src=x onerror="window.pwned = 1"> & <b>bold</b>');
        expect(document.querySelector('img, b')).toBeNull();
        expect(window.pwned).toBeUndefined();
    });

    it('should select the manga of the chapter, for the panels that show its chapters', async () => {
        const { manga } = createLibrary();
        const { selection } = await renderReader();
        await screen.findByText('Chapter 2');
        expect(selection.current.manga).toBe(manga);
    });

    it('should select the connector of the chapter together with its manga', async () => {
        createLibrary();
        const { selection } = await renderReader();
        await screen.findByText('Chapter 2');
        expect(selection.current.connectorId).toBe('site');
    });

    it('should leave the connector alone that the user picks while the chapter is open: the panels stay beside the reader', async () => {
        createLibrary();
        const { selection } = await renderReader();
        await screen.findByText('Chapter 2');
        act(() => selection.current.selectConnector('other'));
        await act(async () => undefined);
        expect(selection.current.connectorId).toBe('other');
        // its manga is the one that the user has not chosen yet, and it stays so
        expect(selection.current.manga).toBeNull();
        await act(async () => undefined);
        expect(selection.current.connectorId).toBe('other');
    });

    it('should select the connector of the link again when the user goes to another chapter', async () => {
        const { manga } = createLibrary();
        const { router, selection } = await renderReader();
        await screen.findByText('Chapter 2');
        act(() => selection.current.selectConnector('other'));
        await act(async () => undefined);
        await act(async () => {
            await router.navigate({
                to: '/reader',
                search: { connector: 'site', manga: 'm1', chapter: 'c3' },
            });
        });
        await screen.findByText('Chapter 3');
        expect(selection.current.connectorId).toBe('site');
        expect(selection.current.manga).toBe(manga);
    });
});

describe('the pages of the chapter', () => {
    it('should show the title and the way out while the engine collects the pages, then the thumbnails', async () => {
        const answers = [];
        const { chapters } = createLibrary();
        chapters[1].getPages = vi.fn((callback) => {
            answers.push(callback);
        });
        await renderReader();
        expect(await screen.findByText(LOADING)).toBeTruthy();
        expect(shownTitle()).toBe('Chapter 2');
        expect(screen.getByTitle('Close the preview (ESC)')).toBeTruthy();
        expect(screen.queryAllByTitle(/^Page \d+$/)).toHaveLength(0);
        await act(async () => answers[0](null, imagesOf('c2')));
        expect(thumbnails()).toHaveLength(3);
        expect(screen.queryByText(LOADING)).toBeNull();
        expect(chapters[1].getPages).toHaveBeenCalledTimes(1);
    });

    it.each([
        [
            'the error of the engine',
            (callback) => callback(new Error('The site is down'), undefined),
            'The site is down',
        ],
        [
            'an engine that throws',
            () => {
                throw new Error('No connection');
            },
            'No connection',
        ],
        [
            'no pages and no error',
            (callback) => callback(null, undefined),
            'Failed to load pages for "Chapter 2"!',
        ],
    ])('should say why the pages are missing: %s', async (name, getPages, reason) => {
        const { chapters } = createLibrary();
        chapters[1].getPages = vi.fn(getPages);
        await renderReader();
        expect(
            await screen.findByText(`Failed to load pages for this chapter: ${reason}`),
        ).toBeTruthy();
        expect(screen.queryByText(LOADING)).toBeNull();
        expect(screen.queryAllByTitle(/^Page \d+$/)).toHaveLength(0);
        // the way out is still there
        expect(shownTitle()).toBe('Chapter 2');
        press(ESCAPE);
        expect(await screen.findByText(START)).toBeTruthy();
    });

    // NOTE: a chapter without pages gets no message at all, only the title and the way out. The engine turns the empty page list of a
    // chapter on a site into an error (Chapter.getPages), so this is a chapter that was downloaded without any page.
    it.each([
        ['an empty page list', []],
        ['something that is no list', 'https://img.example/1.jpg'],
    ])('should show nothing but the toolbar for %s', async (name, pages) => {
        const { chapters } = createLibrary();
        chapters[1].getPages = vi.fn((callback) => callback(null, pages));
        await renderReader();
        await screen.findByText('Chapter 2');
        await waitFor(() => expect(screen.queryByText(LOADING)).toBeNull());
        expect(screen.queryByText(/^Failed to load pages/)).toBeNull();
        expect(screen.queryAllByTitle(/^Page \d+$/)).toHaveLength(0);
        // the wheel over the toolbar has nothing to scroll
        fireEvent.wheel(screen.getByTitle('Close the preview (ESC)').parentElement, {
            deltaY: 100,
        });
        press(ESCAPE);
        expect(await screen.findByText(START)).toBeTruthy();
    });

    it('should not ask the engine for the pages of a chapter again when the chapter is opened again', async () => {
        const { chapters } = createLibrary();
        const { router } = await openThumbnails();
        press(ESCAPE);
        await screen.findByText(START);
        await act(async () => {
            await router.navigate({
                to: '/reader',
                search: { connector: 'site', manga: 'm1', chapter: 'c2' },
            });
        });
        expect(thumbnails()).toHaveLength(3);
        expect(chapters[1].getPages).toHaveBeenCalledTimes(1);
    });

    it('should ask for the pages again when the chapter is opened again after a failure', async () => {
        const { chapters } = createLibrary();
        const answers = [
            (callback) => callback(new Error('The site is down')),
            (callback) => callback(null, imagesOf('c2')),
        ];
        chapters[1].getPages = vi.fn((callback) => answers.shift()(callback));
        const { router } = await renderReader();
        await screen.findByText('Failed to load pages for this chapter: The site is down');
        press(ESCAPE);
        await screen.findByText(START);
        await act(async () => {
            await router.navigate({
                to: '/reader',
                search: { connector: 'site', manga: 'm1', chapter: 'c2' },
            });
        });
        expect(await screen.findByTitle('Page 1')).toBeTruthy();
        expect(chapters[1].getPages).toHaveBeenCalledTimes(2);
    });
});

describe('the thumbnails', () => {
    it('should show one thumbnail for each page, in the order of the pages, with the page as its picture', async () => {
        await openThumbnails();
        const shown = thumbnails();
        expect(shown.map((thumbnail) => thumbnail.getAttribute('title'))).toEqual([
            'Page 1',
            'Page 2',
            'Page 3',
        ]);
        shown.forEach((thumbnail, index) => {
            expect(thumbnail.style.backgroundImage).toContain(
                `https://img.example/c2/${index + 1}.jpg`,
            );
        });
        expect(isReading()).toBe(false);
        expect(screen.queryAllByAltText(/^Page \d+$/)).toHaveLength(0);
    });

    // encodeURI leaves the apostrophe of a manga title in the address of a downloaded page: unescaped, it ends the string of the
    // address and the browser drops the whole picture
    it('should keep an apostrophe of a page address inside of the picture', async () => {
        const { chapters } = createLibrary();
        chapters[1].getPages = vi.fn((callback) =>
            callback(null, ["file:///home/me/Manga/Don't%20Toy/Chapter%201/001.jpg"]),
        );
        await renderReader();
        const thumbnail = await screen.findByTitle('Page 1');
        expect(thumbnail.style.backgroundImage).toContain('Toy/Chapter%201/001.jpg');
    });

    it('should show a page every time the chapter lists it', async () => {
        const { chapters } = createLibrary();
        const page = imagesOf('c2')[0];
        chapters[1].getPages = vi.fn((callback) => callback(null, [page, page]));
        await renderReader();
        await screen.findByTitle('Page 1');
        expect(thumbnails()).toHaveLength(2);
        expect(thumbnails()[1].style.backgroundImage).toBe(thumbnails()[0].style.backgroundImage);
    });

    it('should show the beginning of the text as the thumbnail of a page of a novel', async () => {
        const { chapters } = createLibrary();
        const first = createNovelPage('<h1>The Beginning</h1><p>It was a dark night.</p>');
        const second = createNovelPage('<p>Rain fell on <em>the roofs</em>.</p>');
        chapters[1].getPages = vi.fn((callback) => callback(null, [first, second]));
        await renderReader();
        const shown = await screen.findAllByTitle(/^Page \d+$/);
        expect(shown).toHaveLength(2);
        expect(shown[0].textContent).toBe('The Beginning It was a dark night.');
        expect(shown[1].textContent).toBe('Rain fell on the roofs.');
        expect(shown[0].getAttribute('aria-label')).toBe('Page 1');
        expect(shown[1].getAttribute('aria-label')).toBe('Page 2');
        // a novel has no picture to show
        expect(shown[0].style.backgroundImage).toBe('');
    });

    it('should open reading at the page that was clicked, and put that page in view', async () => {
        const { user } = await openThumbnails();
        const scroll = vi
            .spyOn(Element.prototype, 'scrollIntoView')
            .mockImplementation(() => undefined);
        await user.click(screen.getByTitle('Page 3'));
        expect(isReading()).toBe(true);
        expect(screen.queryAllByTitle(/^Page \d+$/)).toHaveLength(0);
        expect(images().map((image) => image.getAttribute('src'))).toEqual(imagesOf('c2'));
        expect(scrolledTo(scroll)).toEqual(['rk-page-2']);
    });

    it('should offer the title and the way out only, until a page is picked', async () => {
        await openThumbnails();
        expect(shownTitle()).toBe('Chapter 2');
        expect(screen.getByTitle('Close the preview (ESC)')).toBeTruthy();
        for (const title of [
            'Zoom In (+)',
            'Zoom Out (-)',
            'Next Chapter (ArrowRight)',
            'Previous Chapter (ArrowLeft)',
            'Magic Scroll Down (SPACEBAR)',
        ]) {
            expect(screen.queryByTitle(title)).toBeNull();
        }
        expect(screen.queryByText(/^Image Width:/)).toBeNull();
    });

    it.each([
        ['the Escape key', async () => press(ESCAPE)],
        ['the button', async (user) => user.click(screen.getByTitle('Close the preview (ESC)'))],
    ])(
        'should leave for the start page with %s, without marking the chapter as read',
        async (name, close) => {
            const { user } = await openThumbnails();
            await close(user);
            expect(await screen.findByText(START)).toBeTruthy();
            expect(window.Engine.ChaptermarkManager.addChaptermark).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['ArrowRight', ARROW_RIGHT],
        ['ArrowLeft', ARROW_LEFT],
        ['ArrowUp', ARROW_UP],
        ['ArrowDown', ARROW_DOWN],
        ['PageUp', PAGE_UP],
        ['PageDown', PAGE_DOWN],
        ['+', ZOOM_IN],
        ['-', ZOOM_OUT],
        ['*', FIT_WIDTH],
        ['/', DEFAULT_WIDTH],
        ['Space', SPACE],
    ])('should leave the key %s alone while only the thumbnails show', async (name, key) => {
        const { router } = await openThumbnails();
        thumbnailContainer().scrollBy = vi.fn();
        const frames = captureFrames();
        const allowed = press(key);
        frames();
        expect(allowed).toBe(true);
        expect(thumbnailContainer().scrollBy).not.toHaveBeenCalled();
        expect(screen.queryByText(SPACE_AGAIN)).toBeNull();
        expect(isReading()).toBe(false);
        expect(router.history.location.search).toEqual(expect.stringContaining('chapter=c2'));
        expect(thumbnails()).toHaveLength(3);
    });
});

describe('reading', () => {
    it('should show the pages as images that fill three quarters of the width, one below the other', async () => {
        await openReading();
        expect(isReading()).toBe(true);
        expect(images().map((image) => image.getAttribute('alt'))).toEqual([
            'Page 1',
            'Page 2',
            'Page 3',
        ]);
        expect(images().map((image) => image.getAttribute('src'))).toEqual(imagesOf('c2'));
        expect(images().map((image) => image.id)).toEqual(['rk-page-0', 'rk-page-1', 'rk-page-2']);
        expect(widthOf()).toBe('75%');
        expect(shownWidth()).toBe('Image Width: 75%');
    });

    it('should show every button of the toolbar, with its key in the tooltip', async () => {
        await openReading();
        expect(shownTitle()).toBe('Chapter 2');
        for (const title of [
            'Previous Chapter (ArrowLeft)',
            'Next Chapter (ArrowRight)',
            'Decrease spacing between images (CTRL -)',
            'Increase spacing between images (CTRL +)',
            'Zoom In (+)',
            'Zoom Out (-)',
            'Default Image Width (/)',
            'Zoom to Fit Window (*)',
            'Magic Scroll Down (SPACEBAR)',
            'Close (ESC)',
        ]) {
            expect(screen.getAllByTitle(title)).toHaveLength(1);
        }
        expect(screen.queryByTitle('Close the preview (ESC)')).toBeNull();
    });

    it.each([
        ['the Escape key', async () => press(ESCAPE)],
        ['the button', async (user) => user.click(screen.getByTitle('Close (ESC)'))],
    ])(
        'should go back to the thumbnails with %s, and mark the chapter as read',
        async (name, close) => {
            const { user } = await openReading();
            const marker = window.Engine.ChaptermarkManager;
            expect(marker.addChaptermark).not.toHaveBeenCalled();
            await close(user);
            expect(isReading()).toBe(false);
            expect(thumbnails()).toHaveLength(3);
            expect(marker.addChaptermark).toHaveBeenCalledTimes(1);
            expect(marker.addChaptermark.mock.calls[0][0].id).toBe('c2');
            expect(marker.chaptermarks.map((mark) => mark.chapterID)).toEqual(['c2']);
            // the reader itself stays: the page is only left by a second close
            expect(screen.queryByText(START)).toBeNull();
        },
    );

    it('should mark the chapter that is open when reading is closed, not the one reading started with', async () => {
        const { chapters } = createLibrary();
        await openReading();
        press(ARROW_RIGHT);
        await titleIs('Chapter 3');
        await screen.findByAltText('Page 1');
        press(ESCAPE);
        const marker = window.Engine.ChaptermarkManager;
        expect(marker.addChaptermark).toHaveBeenCalledTimes(1);
        expect(marker.addChaptermark).toHaveBeenCalledWith(chapters[0]);
    });

    // NOTE: reading closed while the next chapter is still being resolved marks nothing, as no chapter is open at that moment
    it('should show the thumbnails of the next chapter when reading is closed while it resolves', async () => {
        await openReading();
        let ready = null;
        window.Engine.ConnectorsReady = new Promise((resolve) => {
            ready = resolve;
        });
        press(ARROW_RIGHT);
        await screen.findByText(RESOLVING);
        press(ESCAPE);
        expect(isReading()).toBe(false);
        await act(async () => ready([]));
        expect(await screen.findByTitle('Page 1')).toBeTruthy();
        expect(shownTitle()).toBe('Chapter 3');
        expect(isReading()).toBe(false);
        expect(window.Engine.ChaptermarkManager.addChaptermark).not.toHaveBeenCalled();
    });

    it('should leave the reader with a second close, and mark the chapter only for the reading', async () => {
        await openReading();
        press(ESCAPE);
        press(ESCAPE);
        expect(await screen.findByText(START)).toBeTruthy();
        expect(window.Engine.ChaptermarkManager.addChaptermark).toHaveBeenCalledTimes(1);
    });

    it.each([
        [
            'the engine fails to mark it',
            (engine) =>
                engine.ChaptermarkManager.addChaptermark.mockImplementation(() => {
                    throw new Error('disk full');
                }),
        ],
        [
            'the engine has no chapter marks',
            (engine) => {
                engine.ChaptermarkManager = undefined;
            },
        ],
        [
            'the engine is gone',
            () => {
                delete window.Engine;
            },
        ],
    ])('should go back to the thumbnails all the same when %s', async (name, sabotage) => {
        await openReading();
        sabotage(window.Engine);
        press(ESCAPE);
        expect(isReading()).toBe(false);
        expect(thumbnails()).toHaveLength(3);
    });

    it('should hand the wheel over the toolbar on to the pages, which lie below it', async () => {
        await openReading();
        readingContainer().scrollBy = vi.fn();
        fireEvent.wheel(screen.getByTitle('Close (ESC)').parentElement, {
            deltaY: 120,
            deltaX: -4,
        });
        expect(readingContainer().scrollBy).toHaveBeenCalledTimes(1);
        expect(readingContainer().scrollBy).toHaveBeenCalledWith({ top: 120, left: -4 });
    });

    it('should mark the frame as reading, for the shell that hides its panels then', async () => {
        const { user } = await openThumbnails();
        expect(isReading()).toBe(false);
        await user.click(screen.getByTitle('Page 1'));
        expect(isReading()).toBe(true);
        press(ESCAPE);
        expect(isReading()).toBe(false);
    });
});

describe('reading a chapter without pages', () => {
    // NOTE: stepping to a chapter that has no pages leaves the frame of reading with the toolbar only
    async function readEmptyChapter() {
        const { chapters } = createLibrary();
        chapters[0].getPages = vi.fn((callback) => callback(null, []));
        const view = await openReading();
        press(ARROW_RIGHT);
        await titleIs('Chapter 3');
        await waitFor(() => expect(screen.queryByText(LOADING)).toBeNull());
        return view;
    }

    it.each([
        ['ArrowUp', ARROW_UP],
        ['ArrowDown', ARROW_DOWN],
        ['PageUp', PAGE_UP],
        ['PageDown', PAGE_DOWN],
        ['Space', SPACE],
    ])('should have nothing to scroll with %s, and go on working', async (name, key) => {
        await readEmptyChapter();
        const frames = captureFrames();
        press(key);
        frames();
        expect(screen.queryByText(SPACE_AGAIN)).toBeNull();
        expect(isReading()).toBe(true);
        press(ZOOM_IN);
        expect(shownWidth()).toBe('Image Width: 90%');
        press(ESCAPE);
        expect(isReading()).toBe(false);
    });

    it('should have nothing to scroll with the button of the magic scroll', async () => {
        const { user } = await readEmptyChapter();
        await user.click(screen.getByTitle('Magic Scroll Down (SPACEBAR)'));
        expect(screen.queryByText(SPACE_AGAIN)).toBeNull();
        expect(isReading()).toBe(true);
    });
});

describe('the keys of the reader', () => {
    // Control + and - are also the zoom of the window (the menu of the application): the reader takes them over while it
    // reads, so that the window does not zoom along
    it.each([
        ['*', FIT_WIDTH, '100%', '2em auto', true],
        ['+', ZOOM_IN, '90%', '2em auto', true],
        ['-', ZOOM_OUT, '60%', '2em auto', true],
        ['Ctrl +', { ...ZOOM_IN, ctrlKey: true }, '75%', '3em auto', false],
        ['Ctrl -', { ...ZOOM_OUT, ctrlKey: true }, '75%', '1em auto', false],
    ])(
        'should change the size or the spacing of the pages with %s',
        async (name, key, width, margin, left) => {
            await openReading();
            expect(press(key)).toBe(left);
            expect(widthOf()).toBe(width);
            expect(shownWidth()).toBe(`Image Width: ${width}`);
            expect(marginOf()).toBe(margin);
        },
    );

    it('should bring the pages back to the default width with /', async () => {
        await openReading();
        press(FIT_WIDTH);
        press(ZOOM_IN);
        expect(widthOf()).toBe('115%');
        press(DEFAULT_WIDTH);
        expect(widthOf()).toBe('75%');
    });

    it.each([
        ['ArrowRight', ARROW_RIGHT],
        ['ArrowLeft', ARROW_LEFT],
        ['ArrowUp', ARROW_UP],
        ['ArrowDown', ARROW_DOWN],
        ['PageUp', PAGE_UP],
        ['PageDown', PAGE_DOWN],
        ['Escape', ESCAPE],
        ['Space', SPACE],
        ['*', FIT_WIDTH],
        ['/', DEFAULT_WIDTH],
    ])('should leave Ctrl+%s to the browser', async (name, key) => {
        const { router } = await openReading();
        readingContainer().scrollBy = vi.fn();
        const frames = captureFrames();
        expect(press(key, { ctrlKey: true })).toBe(true);
        frames();
        expect(readingContainer().scrollBy).not.toHaveBeenCalled();
        expect(screen.queryByText(SPACE_AGAIN)).toBeNull();
        expect(isReading()).toBe(true);
        expect(widthOf()).toBe('75%');
        expect(router.history.location.search).toEqual(expect.stringContaining('chapter=c2'));
        expect(window.Engine.ChaptermarkManager.addChaptermark).not.toHaveBeenCalled();
    });

    it.each(['input', 'select', 'textarea'])(
        'should leave the keys to a %s, where they are typed',
        async (field) => {
            const extra = (
                <>
                    <input aria-label="input" />
                    <select aria-label="select">
                        <option>*</option>
                    </select>
                    <textarea aria-label="textarea" />
                </>
            );
            const { router } = await openReading(DEFAULT_URL, { extra });
            const target = screen.getByLabelText(field);
            for (const key of [ZOOM_IN, FIT_WIDTH, ARROW_RIGHT, ESCAPE, SPACE]) {
                expect(press(key, {}, target)).toBe(true);
            }
            expect(widthOf()).toBe('75%');
            expect(isReading()).toBe(true);
            expect(router.history.location.search).toEqual(expect.stringContaining('chapter=c2'));
            expect(screen.queryByText(SPACE_AGAIN)).toBeNull();
            // the same keys work as soon as they are typed somewhere else
            press(ZOOM_IN, {}, screen.getByTitle('Zoom Out (-)'));
            expect(widthOf()).toBe('90%');
        },
    );

    it('should scroll by 64 pixels in small steps with ArrowDown, and take the key over from the browser', async () => {
        await openReading();
        const flush = captureFrames();
        const container = readingContainer();
        container.scrollBy = vi.fn();
        expect(press(ARROW_DOWN)).toBe(false);
        flush();
        expect(container.scrollBy.mock.calls.map(([options]) => options.top)).toEqual([
            10, 10, 10, 10, 10, 10, 4,
        ]);
    });

    it('should scroll by 64 pixels in small steps with ArrowUp, and take the key over from the browser', async () => {
        await openReading();
        const flush = captureFrames();
        const container = readingContainer();
        container.scrollBy = vi.fn();
        expect(press(ARROW_UP)).toBe(false);
        flush();
        expect(container.scrollBy.mock.calls.map(([options]) => options.top)).toEqual([
            -10, -10, -10, -10, -10, -10, -4,
        ]);
    });

    it.each([
        ['PageDown', PAGE_DOWN, 950],
        ['PageUp', PAGE_UP, -950],
    ])('should scroll by 95 percent of the window with %s', async (name, key, distance) => {
        await openReading();
        window.innerHeight = 1000;
        const container = readingContainer();
        container.scrollBy = vi.fn();
        press(key);
        expect(container.scrollBy).toHaveBeenCalledTimes(1);
        const [options] = container.scrollBy.mock.calls[0];
        expect(options.top).toBeCloseTo(distance, 6);
        expect(options.left).toBe(0);
        expect(options.behavior).toBe('smooth');
    });

    it.each([
        ['an unused letter', { key: 'a', code: 'KeyA' }],
        ['Enter', { key: 'Enter', code: 'Enter' }],
        ['Tab', { key: 'Tab', code: 'Tab' }],
        ['F5', { key: 'F5', code: 'F5' }],
        ['Home', { key: 'Home', code: 'Home' }],
    ])('should not take %s over from the browser', async (name, key) => {
        await openReading();
        expect(press(key)).toBe(true);
        expect(widthOf()).toBe('75%');
        expect(isReading()).toBe(true);
    });

    it('should not activate a focused button with Space, because the key belongs to the magic scroll', async () => {
        const { user } = await openReading();
        const zoomIn = screen.getByTitle('Zoom In (+)');
        act(() => zoomIn.focus());
        expect(document.activeElement).toBe(zoomIn);
        await user.keyboard(' ');
        expect(widthOf()).toBe('75%');
        expect(document.activeElement).not.toBe(zoomIn);
        expect(await screen.findByText(SPACE_AGAIN)).toBeTruthy();
    });

    it.each([
        ['the page', document.body],
        ['the window itself', window],
    ])('should take Space over from the browser when it comes from %s', async (name, target) => {
        await openReading();
        expect(press(SPACE, {}, target)).toBe(false);
        expect(screen.getByText(SPACE_AGAIN)).toBeTruthy();
    });

    it('should work with the focus on a button of the toolbar', async () => {
        await openReading();
        press(ZOOM_IN, {}, screen.getByTitle('Zoom Out (-)'));
        expect(widthOf()).toBe('90%');
    });
});

describe('the size and the spacing of the pages', () => {
    it('should never zoom in beyond 400 percent, and zoom out again from there', async () => {
        await openReading();
        for (let count = 0; count < 21; count++) {
            press(ZOOM_IN);
        }
        expect(widthOf()).toBe('390%');
        press(ZOOM_IN);
        expect(widthOf()).toBe('400%');
        press(ZOOM_IN);
        expect(widthOf()).toBe('400%');
        expect(shownWidth()).toBe('Image Width: 400%');
        press(ZOOM_OUT);
        expect(widthOf()).toBe('385%');
    });

    it('should never zoom out below 25 percent, and zoom in again from there', async () => {
        await openReading();
        for (let count = 0; count < 3; count++) {
            press(ZOOM_OUT);
        }
        expect(widthOf()).toBe('30%');
        press(ZOOM_OUT);
        expect(widthOf()).toBe('25%');
        press(ZOOM_OUT);
        expect(widthOf()).toBe('25%');
        expect(shownWidth()).toBe('Image Width: 25%');
        press(ZOOM_IN);
        expect(widthOf()).toBe('40%');
    });

    it('should never make the spacing between the pages negative', async () => {
        await openReading();
        press(ZOOM_OUT, { ctrlKey: true });
        expect(marginOf()).toBe('1em auto');
        press(ZOOM_OUT, { ctrlKey: true });
        expect(marginOf()).toBe('0em auto');
        press(ZOOM_OUT, { ctrlKey: true });
        expect(marginOf()).toBe('0em auto');
        press(ZOOM_IN, { ctrlKey: true });
        expect(marginOf()).toBe('1em auto');
    });

    it('should give every page the same size and spacing', async () => {
        await openReading();
        press(ZOOM_IN);
        press(ZOOM_IN, { ctrlKey: true });
        expect(images().map((image) => image.style.width)).toEqual(['90%', '90%', '90%']);
        expect(images().map((image) => image.style.margin)).toEqual([
            '3em auto',
            '3em auto',
            '3em auto',
        ]);
    });

    it.each([
        ['Zoom In (+)', '105%', '2em auto'],
        ['Zoom Out (-)', '75%', '2em auto'],
        ['Default Image Width (/)', '75%', '2em auto'],
        ['Zoom to Fit Window (*)', '100%', '2em auto'],
        ['Increase spacing between images (CTRL +)', '90%', '3em auto'],
        ['Decrease spacing between images (CTRL -)', '90%', '1em auto'],
    ])('should do what the tooltip says with the button %s', async (title, width, margin) => {
        const { user } = await openReading();
        press(ZOOM_IN);
        await user.click(screen.getByTitle(title));
        expect(widthOf()).toBe(width);
        expect(marginOf()).toBe(margin);
        expect(shownWidth()).toBe(`Image Width: ${width}`);
    });

    it('should keep the relative position in the chapter when the pages change their size', async () => {
        await openReading();
        const container = readingContainer();
        // the chapter is as tall as its pages are wide
        Object.defineProperty(container, 'scrollHeight', {
            configurable: true,
            get: () => (1000 * parseFloat(images()[0].style.width)) / 75,
        });
        container.scrollTop = 500;
        press(ZOOM_IN);
        expect(container.scrollTop).toBeCloseTo(600, 6);
        press(ZOOM_OUT);
        expect(container.scrollTop).toBeCloseTo(500, 6);
    });

    it('should leave the scroll position alone while the chapter has no height yet', async () => {
        await openReading();
        const container = readingContainer();
        container.scrollTop = 123;
        press(ZOOM_IN);
        expect(container.scrollTop).toBe(123);
    });
});

describe('moving between the chapters', () => {
    it('should open the chapter above with ArrowRight and the one below with ArrowLeft, as the list shows them', async () => {
        const { connector, manga } = createLibrary();
        const { router } = await openReading();
        press(ARROW_RIGHT);
        await titleIs('Chapter 3');
        expect(router.history.location.search).toContain('chapter=c3');
        await screen.findByAltText('Page 1');
        press(ARROW_LEFT);
        await titleIs('Chapter 2');
        press(ARROW_LEFT);
        await titleIs('Chapter 1');
        await screen.findByAltText('Page 1');
        expect(images().map((image) => image.getAttribute('src'))).toEqual(imagesOf('c1'));
        // the lists of the manga and of its chapters are read once, not at every step
        expect(connector.getMangas).toHaveBeenCalledTimes(1);
        expect(manga.getChapters).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['Next Chapter (ArrowRight)', 'Chapter 3'],
        ['Previous Chapter (ArrowLeft)', 'Chapter 1'],
    ])('should open %s with its button', async (title, expected) => {
        const { user } = await openReading();
        await user.click(screen.getByTitle(title));
        await titleIs(expected);
    });

    it('should keep the connector and the manga of the address, and nothing else', async () => {
        const { router } = await openReading();
        press(ARROW_RIGHT);
        await titleIs('Chapter 3');
        expect(router.state.location.pathname).toBe('/reader');
        expect(router.state.location.search).toEqual({
            connector: 'site',
            manga: 'm1',
            chapter: 'c3',
        });
    });

    it('should stay in reading mode, from the first page, and cover the window while the next chapter resolves', async () => {
        await openReading(DEFAULT_URL, { page: 2 });
        const scroll = vi
            .spyOn(Element.prototype, 'scrollIntoView')
            .mockImplementation(() => undefined);
        // the next chapter is held back until the connectors are ready, which is awaited whenever a chapter is resolved
        let ready = null;
        window.Engine.ConnectorsReady = new Promise((resolve) => {
            ready = resolve;
        });
        const container = readingContainer();
        container.scrollTop = 500;
        press(ARROW_RIGHT);
        expect(container.scrollTop).toBe(0);
        expect(await screen.findByText(RESOLVING)).toBeTruthy();
        expect(isReading()).toBe(true);
        await act(async () => ready([]));
        await titleIs('Chapter 3');
        await screen.findByAltText('Page 1');
        expect(isReading()).toBe(true);
        // the last page that was put in view is the first one of the new chapter, which is there now
        const [last] = scroll.mock.contexts.slice(-1);
        expect(last.isConnected).toBe(true);
        expect(last.getAttribute('src')).toBe(imagesOf('c3')[0]);
        expect(scrolledTo(scroll)).not.toContain('rk-page-2');
    });

    it('should keep the size and the spacing that were chosen for the next chapter', async () => {
        await openReading();
        press(ZOOM_IN);
        press(ZOOM_IN, { ctrlKey: true });
        press(ARROW_RIGHT);
        await titleIs('Chapter 3');
        await screen.findByAltText('Page 1');
        expect(widthOf()).toBe('90%');
        expect(marginOf()).toBe('3em auto');
    });

    it.each([
        ['the newest chapter has no next one', 'c3', ARROW_RIGHT, 'Chapter 3'],
        ['the oldest chapter has no previous one', 'c1', ARROW_LEFT, 'Chapter 1'],
    ])('should do nothing at the end of the list: %s', async (name, id, key, title) => {
        const { router } = await openReading(`/reader?connector=site&manga=m1&chapter=${id}`);
        press(key);
        await act(async () => undefined);
        expect(router.history.location.search).toContain(`chapter=${id}`);
        expect(shownTitle()).toBe(title);
        expect(screen.queryByText(NOT_FOUND)).toBeNull();
        expect(screen.queryByText(RESOLVING)).toBeNull();
        expect(images()).toHaveLength(3);
        expect(isReading()).toBe(true);
    });

    it.each([
        ['the next button of the newest chapter', 'c3', 'Next Chapter (ArrowRight)'],
        ['the previous button of the oldest chapter', 'c1', 'Previous Chapter (ArrowLeft)'],
    ])('should do nothing with %s', async (name, id, title) => {
        const { router, user } = await openReading(`/reader?connector=site&manga=m1&chapter=${id}`);
        await user.click(screen.getByTitle(title));
        await act(async () => undefined);
        expect(router.history.location.search).toContain(`chapter=${id}`);
        expect(images()).toHaveLength(3);
    });

    it('should not move at all when the manga has one chapter only', async () => {
        createLibrary({ ids: ['c1'] });
        const { router, user } = await openReading('/reader?connector=site&manga=m1&chapter=c1');
        press(ARROW_RIGHT);
        press(ARROW_LEFT);
        await user.click(screen.getByTitle('Next Chapter (ArrowRight)'));
        await act(async () => undefined);
        expect(router.history.location.search).toContain('chapter=c1');
        expect(images()).toHaveLength(3);
    });

    it('should step through the order of the chapter list that the panel put into the selection', async () => {
        const { chapters } = createLibrary();
        const { selection } = await openReading();
        // the panel shows the chapters sorted by title: the entry above Chapter 2 is Chapter 1 now
        act(() => selection.current.setChapterOrder([chapters[2], chapters[1], chapters[0]]));
        press(ARROW_RIGHT);
        await titleIs('Chapter 1');
        await screen.findByAltText('Page 1');
        press(ARROW_LEFT);
        await titleIs('Chapter 2');
        press(ARROW_LEFT);
        await titleIs('Chapter 3');
    });

    it('should not step to a chapter that the filter of the panel hides', async () => {
        const { chapters } = createLibrary();
        const { router, selection } = await openReading();
        // Chapter 1 is filtered out: below Chapter 2 there is nothing, though the manga has more
        act(() => selection.current.setChapterOrder([chapters[0], chapters[1]]));
        press(ARROW_LEFT);
        await act(async () => undefined);
        expect(router.history.location.search).toContain('chapter=c2');
        press(ARROW_RIGHT);
        await titleIs('Chapter 3');
    });

    it('should use the whole list of the chapters until the panel has published its own', async () => {
        const { chapters } = createLibrary();
        const { selection } = await openReading();
        expect(selection.current.chapterOrder).toEqual([]);
        press(ARROW_RIGHT);
        await titleIs('Chapter 3');
        // and also when the list of the panel does not hold the chapter that is open (a filter hides it)
        await screen.findByAltText('Page 1');
        act(() => selection.current.setChapterOrder([chapters[1]]));
        press(ARROW_LEFT);
        await titleIs('Chapter 2');
    });

    it('should not move when the panel lists the open chapter only', async () => {
        const { chapters } = createLibrary();
        const { router, selection } = await openReading();
        act(() => selection.current.setChapterOrder([chapters[1]]));
        press(ARROW_RIGHT);
        press(ARROW_LEFT);
        await act(async () => undefined);
        expect(router.history.location.search).toContain('chapter=c2');
    });

    it.each([
        '12345',
        '007',
        '1e3',
        'true',
        'null',
        '0',
        '-5',
        '1.50',
        '"quoted"',
        '/series/x/ch-1?a=1&b=2#frag',
        'ünï/çødé',
    ])('should carry the chapter id %s through the address as the string it is', async (id) => {
        createLibrary({ ids: [id, 'c2', 'c1'] });
        const { router } = await openReading();
        press(ARROW_RIGHT);
        await titleIs(`Chapter ${id}`);
        expect(router.state.location.search.chapter).toBe(id);
        await screen.findByAltText('Page 1');
        press(ARROW_LEFT);
        await titleIs('Chapter 2');
        expect(router.state.location.search.chapter).toBe('c2');
    });
});

describe('the magic scroll', () => {
    // the pages end at the bottom of the window: the chapter is read to its end
    const AT_THE_END = [
        { top: -3000, bottom: -1000 },
        { top: -1000, bottom: 500 },
        { top: 500, bottom: 1000 },
    ];

    it('should ask for a second press at the end of the chapter, and open the next chapter with it', async () => {
        const { router } = await openReading();
        layOut(AT_THE_END);
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        expect(press(SPACE)).toBe(false);
        expect(screen.getByText(SPACE_AGAIN)).toBeTruthy();
        await act(async () => {
            vi.advanceTimersByTime(3999);
        });
        expect(router.history.location.search).toContain('chapter=c2');
        press(SPACE);
        vi.useRealTimers();
        await titleIs('Chapter 3');
    });

    it('should forget that it asked after four seconds', async () => {
        const { router } = await openReading();
        layOut(AT_THE_END);
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        press(SPACE);
        expect(screen.getAllByText(SPACE_AGAIN)).toHaveLength(1);
        await act(async () => {
            vi.advanceTimersByTime(4000);
        });
        expect(screen.queryByText(SPACE_AGAIN)).toBeNull();
        press(SPACE);
        expect(screen.getAllByText(SPACE_AGAIN)).toHaveLength(1);
        vi.useRealTimers();
        await act(async () => undefined);
        expect(router.history.location.search).toContain('chapter=c2');
    });

    it('should ask again after the chapter was changed by the second press', async () => {
        await openReading();
        layOut(AT_THE_END);
        press(SPACE);
        press(SPACE);
        await titleIs('Chapter 3');
        await screen.findByAltText('Page 1');
        // the first question is still on the screen, the new one comes with it
        expect(screen.getAllByText(SPACE_AGAIN)).toHaveLength(1);
        layOut(AT_THE_END);
        press(SPACE);
        expect(screen.getAllByText(SPACE_AGAIN)).toHaveLength(2);
    });

    it('should open the chapter that the list of the panel shows above, with the second press', async () => {
        const { chapters } = createLibrary();
        const { selection } = await openReading();
        act(() => selection.current.setChapterOrder([chapters[2], chapters[1], chapters[0]]));
        layOut(AT_THE_END);
        press(SPACE);
        press(SPACE);
        await titleIs('Chapter 1');
    });

    it('should follow the order of the panel for chapters whose ids are numbers as well', async () => {
        const connector = createConnector({ id: 'site', label: 'Site' });
        const manga = addManga(connector, { id: 'm1', title: 'Manga One' });
        const chapters = [30, 20, 10].map((id) =>
            addChapter(manga, {
                id,
                title: `Chapter ${id}`,
                getPages: vi.fn((callback) => callback(null, imagesOf(String(id)))),
            }),
        );
        installEngine({ connectors: [connector] });
        // the address as the application writes it: the id is a string, which the quotes keep from being read as a number
        const { selection } = await openReading('/reader?connector=site&manga=m1&chapter=%2220%22');
        // the panel shows the oldest chapter first: the one above Chapter 20 is Chapter 10 (the list of the engine has 30)
        act(() => selection.current.setChapterOrder([chapters[2], chapters[1], chapters[0]]));
        layOut(AT_THE_END);
        press(SPACE);
        press(SPACE);
        await titleIs('Chapter 10');
    });

    it('should go on to the next page below when the window shows only the gap between two pages', async () => {
        createLibrary({ pagesOf: (id) => [...imagesOf(id), `https://img.example/${id}/4.jpg`] });
        await openReading();
        const scroll = vi
            .spyOn(Element.prototype, 'scrollIntoView')
            .mockImplementation(() => undefined);
        layOut([
            { top: -5000, bottom: -3000 },
            { top: -2500, bottom: -500 },
            { top: 1500, bottom: 3500 },
            { top: 4000, bottom: 6000 },
        ]);
        press(SPACE);
        expect(scrolledTo(scroll)).toEqual(['rk-page-2']);
    });

    // NOTE: at the newest chapter nothing can follow, but the first press still announces "the next chapter", and the second one does
    // nothing (no navigation to a chapter that is not there).
    it('should not go anywhere at the end of the newest chapter', async () => {
        const { router } = await openReading('/reader?connector=site&manga=m1&chapter=c3');
        layOut(AT_THE_END);
        press(SPACE);
        expect(screen.getByText(SPACE_AGAIN)).toBeTruthy();
        press(SPACE);
        await act(async () => undefined);
        expect(router.history.location.search).toContain('chapter=c3');
        expect(screen.queryByText(NOT_FOUND)).toBeNull();
        expect(images()).toHaveLength(3);
    });

    it('should ask again at the end of another chapter, whatever was asked in the chapter before', async () => {
        const { router } = await openReading('/reader?connector=site&manga=m1&chapter=c1');
        layOut(AT_THE_END);
        press(SPACE);
        press(ARROW_RIGHT);
        await titleIs('Chapter 2');
        await screen.findByAltText('Page 1');
        layOut(AT_THE_END);
        press(SPACE);
        await act(async () => undefined);
        expect(router.history.location.search).toContain('chapter=c2');
    });

    // rectangles of the images, the height of the window is 1000 and a step of the magic scroll is 800
    it.each([
        [
            'the top of the next page is in view: scroll to it',
            [
                { top: -900, bottom: 100 },
                { top: 100, bottom: 1100 },
                { top: 1100, bottom: 2100 },
            ],
            { into: ['rk-page-1'], by: null },
        ],
        [
            'the page is taller than the window: scroll by 80 percent of the window',
            [
                { top: -100, bottom: 1900 },
                { top: 1900, bottom: 2900 },
                { top: 2900, bottom: 3900 },
            ],
            { into: [], by: 800 },
        ],
        [
            'less than a step is left of the page: scroll just that',
            [
                { top: -100, bottom: 1300 },
                { top: 1300, bottom: 2300 },
                { top: 2300, bottom: 3300 },
            ],
            { into: [], by: 300 },
        ],
        [
            'the page is fully in view and the next one is not: scroll to the next page',
            [
                { top: -200, bottom: 900 },
                { top: 1100, bottom: 2100 },
                { top: 2100, bottom: 3100 },
            ],
            { into: ['rk-page-1'], by: null },
        ],
    ])('should scroll smoothly when %s', async (name, rectangles, expected) => {
        await openReading();
        const scroll = vi
            .spyOn(Element.prototype, 'scrollIntoView')
            .mockImplementation(() => undefined);
        layOut(rectangles);
        const container = readingContainer();
        container.scrollBy = vi.fn();
        press(SPACE);
        expect(scrolledTo(scroll)).toEqual(expected.into);
        scroll.mock.calls.forEach(([options]) => expect(options).toEqual({ behavior: 'smooth' }));
        if (expected.by === null) {
            expect(container.scrollBy).not.toHaveBeenCalled();
        } else {
            expect(container.scrollBy).toHaveBeenCalledTimes(1);
            expect(container.scrollBy).toHaveBeenCalledWith({
                top: expected.by,
                left: 0,
                behavior: 'smooth',
            });
        }
        expect(screen.queryByText(SPACE_AGAIN)).toBeNull();
    });

    it('should do the same with the button of the toolbar as with the key', async () => {
        const { user } = await openReading();
        layOut(AT_THE_END);
        await user.click(screen.getByTitle('Magic Scroll Down (SPACEBAR)'));
        expect(screen.getByText(SPACE_AGAIN)).toBeTruthy();
    });
});

describe('the images of the pages', () => {
    const SOURCE = 'https://img.example/c2/1.jpg';
    const START_TIME = Date.UTC(2030, 0, 1);

    function breakFirstImage() {
        const image = images()[0];
        fireEvent.error(image);
        return image;
    }

    it('should try a broken image again after a second, with a query that defeats the cache', async () => {
        await openReading();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        vi.setSystemTime(START_TIME);
        const image = breakFirstImage();
        vi.advanceTimersByTime(999);
        expect(image.getAttribute('src')).toBe(SOURCE);
        vi.advanceTimersByTime(1);
        expect(image.getAttribute('src')).toBe(`${SOURCE}?${START_TIME + 1000}`);
    });

    it('should add the query to an address that has one already with an ampersand', async () => {
        const { chapters } = createLibrary();
        chapters[1].getPages = vi.fn((callback) => callback(null, [`${SOURCE}?token=abc`]));
        await openReading();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        vi.setSystemTime(START_TIME);
        const image = breakFirstImage();
        vi.advanceTimersByTime(1000);
        expect(image.getAttribute('src')).toBe(`${SOURCE}?token=abc&${START_TIME + 1000}`);
    });

    it('should try three times at most, each time from the address of the page, and then give up', async () => {
        await openReading();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        vi.setSystemTime(START_TIME);
        const image = images()[0];
        for (const attempt of [1, 2, 3]) {
            fireEvent.error(image);
            vi.advanceTimersByTime(1000);
            expect(image.getAttribute('src')).toBe(`${SOURCE}?${START_TIME + attempt * 1000}`);
        }
        fireEvent.error(image);
        vi.advanceTimersByTime(10000);
        expect(image.getAttribute('src')).toBe(`${SOURCE}?${START_TIME + 3000}`);
    });

    it('should count the attempts for every image on its own', async () => {
        await openReading();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        vi.setSystemTime(START_TIME);
        const [first, second] = images();
        for (let count = 0; count < 3; count++) {
            fireEvent.error(first);
            vi.advanceTimersByTime(1000);
        }
        fireEvent.error(second);
        vi.advanceTimersByTime(1000);
        expect(second.getAttribute('src')).toBe(
            `https://img.example/c2/2.jpg?${START_TIME + 4000}`,
        );
    });

    it('should leave an image that loads alone', async () => {
        await openReading();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        fireEvent.load(images()[0]);
        vi.advanceTimersByTime(10000);
        expect(images()[0].getAttribute('src')).toBe(SOURCE);
    });

    it('should not try a broken image again after the reader was closed', async () => {
        const { unmount } = await openReading();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        const image = breakFirstImage();
        unmount();
        vi.advanceTimersByTime(1000);
        expect(image.getAttribute('src')).toBe(SOURCE);
    });
});

describe('the pages of a novel', () => {
    const story = createNovelPage('<h1>The Beginning</h1><p>It was a dark night.</p>');
    const hostile = createNovelPage(
        [
            '<p onclick="window.pwned = 1">Hello</p>',
            '<script>window.pwned = 2</script>',
            '<p><img src="https://cdn.example/a.png" alt="An illustration" onerror="window.pwned = 3" style="width:1px"></p>',
            '<iframe src="https://tracker.example"></iframe>',
            '<p><a href="javascript:window.pwned = 4">a link</a></p>',
        ].join(''),
    );

    function novelOf(...pages) {
        const { chapters } = createLibrary({
            engine: {
                Settings: createSettings({
                    NovelColorProfile: () => ({ background: 'black', text: 'white' }),
                }),
            },
        });
        chapters[1].getPages = vi.fn((callback) => callback(null, pages));
    }

    afterEach(() => {
        delete window.pwned;
    });

    it('should show the text in the colours that the user chose for novels', async () => {
        novelOf(story);
        await openReading();
        const page = document.getElementById('rk-page-0');
        expect(page.textContent).toBe('The Beginning\nIt was a dark night.');
        expect(page.querySelector('h1').textContent).toBe('The Beginning');
        expect(page.style.backgroundColor).toBe('black');
        expect(page.style.color).toBe('white');
        // text, not an image
        expect(screen.queryAllByAltText(/^Page \d+$/)).toHaveLength(0);
    });

    it('should show black on white when the colour profile of the settings is gone', async () => {
        const { chapters } = createLibrary({
            engine: {
                Settings: createSettings({
                    NovelColorProfile: () => {
                        throw new TypeError('no such profile');
                    },
                }),
            },
        });
        chapters[1].getPages = vi.fn((callback) => callback(null, [story]));
        await openReading();
        const page = document.getElementById('rk-page-0');
        expect(page.style.backgroundColor).toBe('white');
        expect(page.style.color).toBe('black');
    });

    it('should make the letters as large as the zoom says, 75 percent being the size of the application', async () => {
        novelOf(story);
        await openReading();
        const page = () => document.getElementById('rk-page-0');
        expect(page().style.fontSize).toBe('1em');
        press(ZOOM_IN);
        expect(page().style.fontSize).toBe('1.2em');
        press(ZOOM_OUT);
        press(ZOOM_OUT);
        expect(page().style.fontSize).toBe('0.8em');
        expect(shownWidth()).toBe('Image Width: 60%');
    });

    it('should space the pages like images', async () => {
        novelOf(story, story);
        await openReading();
        expect(document.getElementById('rk-page-1').style.margin).toBe('2em auto');
        press(ZOOM_IN, { ctrlKey: true });
        expect(document.getElementById('rk-page-1').style.margin).toBe('3em auto');
    });

    it('should clean the page up once more: nothing of it runs and nothing of it stays but the text and the illustration', async () => {
        novelOf(hostile);
        await openReading();
        const page = document.getElementById('rk-page-0');
        expect(page.textContent).toContain('Hello');
        expect(page.textContent).toContain('a link');
        expect(page.querySelector('script, iframe, a, style')).toBeNull();
        const attributes = [...page.querySelectorAll('*')].flatMap((element) =>
            element.getAttributeNames(),
        );
        expect(attributes.sort()).toEqual(['alt', 'src']);
        const illustration = page.querySelector('img');
        expect(illustration.getAttribute('src')).toBe('https://cdn.example/a.png');
        expect(illustration.getAttribute('alt')).toBe('An illustration');
        expect(window.pwned).toBeUndefined();
    });

    it('should clean the page up for the thumbnail as well', async () => {
        novelOf(hostile);
        await openThumbnails();
        const thumbnail = screen.getByTitle('Page 1');
        expect(thumbnail.textContent).toBe('Hello a link');
        expect(thumbnail.querySelector('script, iframe, img')).toBeNull();
        expect(window.pwned).toBeUndefined();
    });

    it('should open reading at the page of the novel that was clicked', async () => {
        novelOf(story, story);
        const { user } = await openThumbnails();
        const scroll = vi
            .spyOn(Element.prototype, 'scrollIntoView')
            .mockImplementation(() => undefined);
        await user.click(screen.getByTitle('Page 2'));
        expect(isReading()).toBe(true);
        expect(scrolledTo(scroll)).toEqual(['rk-page-1']);
        expect(document.getElementById('rk-page-1').tagName).toBe('ARTICLE');
    });

    it('should show the pages of a chapter in the order they come, texts and images alike', async () => {
        const { chapters } = createLibrary();
        chapters[1].getPages = vi.fn((callback) =>
            callback(null, [story, 'https://img.example/c2/2.jpg']),
        );
        await openReading();
        expect(document.getElementById('rk-page-0').tagName).toBe('ARTICLE');
        expect(document.getElementById('rk-page-1').tagName).toBe('IMG');
        expect(document.getElementById('rk-page-1').getAttribute('src')).toBe(
            'https://img.example/c2/2.jpg',
        );
    });
});

describe('leaving the reader', () => {
    it('should answer a key once under React.StrictMode, which sets up the effects of a component twice', async () => {
        await openReading(DEFAULT_URL, { strict: true });
        press(ZOOM_IN, { ctrlKey: true });
        expect(marginOf()).toBe('3em auto');
        press(ESCAPE);
        expect(window.Engine.ChaptermarkManager.addChaptermark).toHaveBeenCalledTimes(1);
    });

    it('should add one key listener, and no more when it draws again', async () => {
        const add = vi.spyOn(window, 'addEventListener');
        await openReading();
        press(ZOOM_IN);
        press(ZOOM_IN);
        const listeners = add.mock.calls.filter(([type]) => type === 'keydown');
        expect(listeners).toHaveLength(1);
    });

    it('should remove its key listener when it is unmounted, and ignore the keys afterwards', async () => {
        const add = vi.spyOn(window, 'addEventListener');
        const remove = vi.spyOn(window, 'removeEventListener');
        const { router, unmount } = await openThumbnails();
        const [[, listener]] = add.mock.calls.filter(([type]) => type === 'keydown');
        unmount();
        expect(
            remove.mock.calls.filter(
                ([type, removed]) => type === 'keydown' && removed === listener,
            ),
        ).toHaveLength(1);
        press(ESCAPE);
        await act(async () => undefined);
        expect(router.history.location.pathname).toBe('/reader');
    });

    it('should remove its key listener when the reader is left, and leave the keys to the page that follows', async () => {
        const remove = vi.spyOn(window, 'removeEventListener');
        const { router } = await openThumbnails();
        press(ESCAPE);
        await screen.findByText(START);
        expect(remove.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
        const before = router.history.location.href;
        press(ESCAPE);
        press(ARROW_RIGHT);
        press(ZOOM_IN);
        await act(async () => undefined);
        expect(router.history.location.href).toBe(before);
        expect(window.Engine.ChaptermarkManager.addChaptermark).not.toHaveBeenCalled();
    });

    it('should not fail when the pages arrive after the reader was left, and have them ready the next time', async () => {
        const answers = [];
        const { chapters } = createLibrary();
        chapters[1].getPages = vi.fn((callback) => {
            answers.push(callback);
        });
        const { router } = await renderReader();
        await screen.findByText(LOADING);
        press(ESCAPE);
        await screen.findByText(START);
        await act(async () => answers[0](null, imagesOf('c2')));
        await act(async () => {
            await router.navigate({
                to: '/reader',
                search: { connector: 'site', manga: 'm1', chapter: 'c2' },
            });
        });
        expect(await screen.findByTitle('Page 1')).toBeTruthy();
        expect(chapters[1].getPages).toHaveBeenCalledTimes(1);
    });
});

describe('a change of the address while the pages load', () => {
    it('should not show the pages of the chapter that was left, when they arrive late', async () => {
        const answers = {};
        const { chapters } = createLibrary();
        chapters[1].getPages = vi.fn((callback) => {
            answers.c2 = callback;
        });
        const { router } = await renderReader();
        await screen.findByText(LOADING);
        await act(async () => {
            await router.navigate({
                to: '/reader',
                search: { connector: 'site', manga: 'm1', chapter: 'c3' },
            });
        });
        await titleIs('Chapter 3');
        const before = (await screen.findAllByTitle(/^Page \d+$/)).map(
            (thumbnail) => thumbnail.style.backgroundImage,
        );
        expect(before[0]).toContain('/c3/1.jpg');
        await act(async () => answers.c2(null, imagesOf('c2')));
        expect(thumbnails().map((thumbnail) => thumbnail.style.backgroundImage)).toEqual(before);
        expect(shownTitle()).toBe('Chapter 3');
        // what arrived stays with its chapter
        await act(async () => {
            await router.navigate({
                to: '/reader',
                search: { connector: 'site', manga: 'm1', chapter: 'c2' },
            });
        });
        await titleIs('Chapter 2');
        expect(thumbnails()[0].style.backgroundImage).toContain('/c2/1.jpg');
        expect(chapters[1].getPages).toHaveBeenCalledTimes(1);
    });

    it('should not show the pages of a chapter with the same id in another manga', async () => {
        const { connector } = createLibrary({ pagesOf: (id) => imagesOf(`m1/${id}`) });
        const other = addManga(connector, { id: 'm2', title: 'Manga Two' });
        addChapter(other, {
            id: 'c2',
            title: 'Other Chapter 2',
            getPages: vi.fn((callback) => callback(null, imagesOf('m2/c2'))),
        });
        const { router } = await openThumbnails();
        expect(thumbnails()[0].style.backgroundImage).toContain('/m1/c2/1.jpg');
        await act(async () => {
            await router.navigate({
                to: '/reader',
                search: { connector: 'site', manga: 'm2', chapter: 'c2' },
            });
        });
        await titleIs('Other Chapter 2');
        expect((await screen.findAllByTitle(/^Page \d+$/))[0].style.backgroundImage).toContain(
            '/m2/c2/1.jpg',
        );
    });

    it('should not show a chapter that was resolved late for an address that was left', async () => {
        const answers = [];
        const { manga } = createLibrary();
        manga.getChapters = vi.fn((callback) => {
            if (answers.length === 0) {
                answers.push(callback);
            } else {
                callback(null, manga.chapters);
            }
        });
        const { router, selection } = await renderReader();
        await screen.findByText(RESOLVING);
        await act(async () => {
            await router.navigate({
                to: '/reader',
                search: { connector: 'site', manga: 'm1', chapter: 'c3' },
            });
        });
        await titleIs('Chapter 3');
        await act(async () => answers[0](null, manga.chapters));
        expect(shownTitle()).toBe('Chapter 3');
        expect(selection.current.manga).toBe(manga);
        expect(thumbnails()[0].style.backgroundImage).toContain('/c3/1.jpg');
    });
});

describe('the reader in the application', () => {
    let application = null;

    afterEach(() => {
        if (application) {
            application.clear();
            application = null;
        }
    });

    // the application as it is mounted, with the route configuration of router.jsx (its own router, in the hash of the address)
    async function renderApplication(hash = '') {
        window.location.hash = hash;
        vi.resetModules();
        const { default: AppRouter } = await import('../router.jsx');
        const { ToastProvider } = await import('../notify.jsx');
        const { queryClient } = await import('../queries.js');
        application = queryClient;
        await act(async () => {
            render(
                <QueryClientProvider client={queryClient}>
                    <ToastProvider>
                        <AppRouter />
                    </ToastProvider>
                </QueryClientProvider>,
            );
        });
        return userEvent.setup();
    }

    it('should open the chapter of a deep link, and show the chapters of its manga in the panel', async () => {
        createLibrary();
        await renderApplication('#/reader?connector=site&manga=m1&chapter=c2');
        expect(await screen.findByTitle('Page 1')).toBeTruthy();
        expect(shownTitle()).toBe('Chapter 2');
        expect(screen.getAllByTitle("Show preview of chapter's pages")).toHaveLength(3);
    });

    it.each([
        ['without a chapter', '#/reader?connector=site&manga=m1'],
        ['without parameters', '#/reader'],
    ])('should say that the chapter is not found for an address %s', async (name, hash) => {
        createLibrary();
        await renderApplication(hash);
        expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
    });

    it('should show the start page after the reader was closed, and leave the address of the start page', async () => {
        createLibrary();
        await renderApplication('#/reader?connector=site&manga=m1&chapter=c2');
        await screen.findByTitle('Page 1');
        press(ESCAPE);
        await waitFor(() => expect(window.location.hash).toBe('#/'));
        expect(screen.queryByTitle('Page 1')).toBeNull();
        expect(screen.queryByTitle(CLOSE)).toBeNull();
    });

    it('should step through the order that the chapter list shows, not through the order of the manga', async () => {
        createLibrary();
        const user = await renderApplication('#/reader?connector=site&manga=m1&chapter=c2');
        await user.click(await screen.findByTitle('Page 1'));
        // the panel sorts by title: Chapter 1, 2, 3, so the entry above Chapter 2 is Chapter 1 and not the newer Chapter 3
        await user.click(screen.getByTitle('Click to toggle chapter sorting'));
        press(ARROW_RIGHT);
        await titleIs('Chapter 1');
        press(ARROW_LEFT);
        await titleIs('Chapter 2');
        press(ARROW_LEFT);
        await titleIs('Chapter 3');
    });

    it.each([
        '12345',
        '007',
        '1e3',
        'true',
        'null',
        '0',
        '-5',
        '1.50',
        '"quoted"',
        '/series/x/ch-1?a=1&b=2#frag',
        'ünï/çødé',
        '{"id":7,"slug":"x"}',
    ])('should carry the chapter id %s through the real route as the string it is', async (id) => {
        createLibrary({ ids: [id, 'c2', 'c1'] });
        const user = await renderApplication('#/reader?connector=site&manga=m1&chapter=c2');
        await user.click(await screen.findByTitle('Page 1'));
        press(ARROW_RIGHT);
        await titleIs(`Chapter ${id}`);
        expect(screen.queryByText(NOT_FOUND)).toBeNull();
        await screen.findByAltText('Page 1');
        press(ARROW_LEFT);
        await titleIs('Chapter 2');
    });

    it('should open a chapter from the list of a manga whose id looks like a number', async () => {
        const connector = createConnector({ id: 'site', label: 'Site' });
        const manga = addManga(connector, { id: '100001', title: 'Numeric manga' });
        for (const id of ['5003', '5002', '5001']) {
            addChapter(manga, {
                id,
                title: `Chapter ${id}`,
                getPages: vi.fn((callback) => callback(null, imagesOf(id))),
            });
        }
        installEngine({ connectors: [connector] });
        const user = await renderApplication();
        await user.click(await screen.findByRole('option', { name: /Numeric manga/ }));
        await user.click((await screen.findAllByTitle("Show preview of chapter's pages"))[1]);
        expect(await screen.findByTitle('Page 1')).toBeTruthy();
        expect(shownTitle()).toBe('Chapter 5002');
        await user.click(screen.getByTitle('Page 1'));
        press(ARROW_RIGHT);
        await titleIs('Chapter 5003');
        expect(screen.queryByText(NOT_FOUND)).toBeNull();
    });

    it('should open the chapter of a link that carries its numeric-looking id without quotes', async () => {
        createLibrary({ ids: ['12345', 'c2', 'c1'] });
        await renderApplication('#/reader?connector=site&manga=m1&chapter=12345');
        await waitFor(() =>
            expect(screen.queryByTitle('Page 1') ?? screen.queryByText(NOT_FOUND)).not.toBeNull(),
        );
        expect(screen.queryByText(NOT_FOUND)).toBeNull();
        expect(shownTitle()).toBe('Chapter 12345');
    });

    it('should open a chapter whose manga and chapter ids are numbers, and step to the next one', async () => {
        const connector = createConnector({ id: 'site', label: 'Site' });
        const manga = addManga(connector, { id: 100001, title: 'Numeric manga' });
        for (const id of [5003, 5002, 5001]) {
            addChapter(manga, {
                id,
                title: `Chapter ${id}`,
                getPages: vi.fn((callback) => callback(null, imagesOf(id))),
            });
        }
        installEngine({ connectors: [connector] });
        const user = await renderApplication();
        await user.click(await screen.findByRole('option', { name: /Numeric manga/ }));
        await user.click((await screen.findAllByTitle("Show preview of chapter's pages"))[1]);
        await waitFor(() =>
            expect(screen.queryByTitle('Page 1') ?? screen.queryByText(NOT_FOUND)).not.toBeNull(),
        );
        expect(screen.queryByText(NOT_FOUND)).toBeNull();
        await user.click(screen.getByTitle('Page 1'));
        press(ARROW_RIGHT);
        await titleIs('Chapter 5003');
    });

    it('should open a chapter from the list of a manga that a deep link opened, whatever its connector', async () => {
        const first = createConnector({ id: 'a', label: 'Alpha' });
        addManga(first, { id: 'a1', title: 'Alpha manga' });
        const second = createConnector({ id: 'b', label: 'Beta' });
        const manga = addManga(second, { id: 'm1', title: 'Beta manga' });
        for (const id of ['c3', 'c2', 'c1']) {
            addChapter(manga, {
                id,
                title: `Chapter ${id.slice(1)}`,
                getPages: vi.fn((callback) => callback(null, imagesOf(id))),
            });
        }
        installEngine({ connectors: [first, second] });
        const user = await renderApplication('#/reader?connector=b&manga=m1&chapter=c2');
        await screen.findByTitle('Page 1');
        press(ESCAPE);
        await waitFor(() => expect(window.location.hash).toBe('#/'));
        await user.click((await screen.findAllByTitle("Show preview of chapter's pages"))[0]);
        await waitFor(() =>
            expect(screen.queryByTitle('Page 1') ?? screen.queryByText(NOT_FOUND)).not.toBeNull(),
        );
        expect(screen.queryByText(NOT_FOUND)).toBeNull();
    });
});

describe('the reader for the keyboard and the screen reader', () => {
    it('should give the reading frame the focus when reading starts, so that the keys work at once', async () => {
        await openReading();
        expect(document.activeElement).toBe(document.querySelector('[data-reading]'));
    });

    it('should leave the keys that are single characters alone while a control outside of the reader has the focus', async () => {
        const extra = <button type="button">Outside</button>;
        await openReading(DEFAULT_URL, { extra });
        const outside = screen.getByRole('button', { name: 'Outside' });
        act(() => outside.focus());
        for (const key of [ZOOM_IN, ZOOM_OUT, FIT_WIDTH, DEFAULT_WIDTH]) {
            expect(press(key, {}, outside)).toBe(true);
        }
        expect(widthOf()).toBe('75%');
        // the other keys of the reader still work there
        expect(press(ARROW_DOWN, {}, outside)).toBe(false);
        // and the characters work again inside of the reader
        press(ZOOM_IN, {}, screen.getByTitle('Zoom In (+)'));
        expect(widthOf()).toBe('90%');
    });

    it('should announce the width of the pages and the states of the chapter', async () => {
        await openReading();
        expect(screen.getByRole('status').textContent).toBe('Image Width: 75%');
    });

    it('should say that a chapter was not found as an alert', async () => {
        await renderReader('/reader?connector=site&manga=m1&chapter=nope');
        expect((await screen.findByRole('alert')).textContent).toContain('Chapter not found.');
    });

    it('should name the thumbnails of the pages', async () => {
        await openThumbnails();
        expect(screen.getAllByRole('button', { name: /^Page \d$/ })).toHaveLength(3);
    });

    it('should head the view with the title of the chapter, while reading as well', async () => {
        const { user } = await openThumbnails();
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Chapter 2');
        await user.click(screen.getByTitle('Page 1'));
        expect(isReading()).toBe(true);
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Chapter 2');
    });
});
