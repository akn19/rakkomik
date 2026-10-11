import React from 'react';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Enums from '../../mjs/engine/Enums.mjs';
import ChaptersPanel from '../ChaptersPanel.jsx';
import MangaPanel from '../MangaPanel.jsx';
import { queryClient, resolveChapter } from '../queries.js';
import { useSelection } from '../selection.jsx';
import { setLayout } from './support/layout.js';
import { addChapter, addManga, createConnector, installEngine } from './support/fakeEngine.js';
import { renderRouted } from './support/render.jsx';

let engine = null;
let site = null;

beforeEach(() => {
    site = createConnector({ id: 'site', label: 'Site' });
    engine = installEngine({ connectors: [site] });
});

afterEach(() => {
    // The cache is emptied after the panel is gone: the hook of renderRouted empties it while the panel is still mounted,
    // and a mounted query puts itself back, so the next test (the ids repeat) would be given the lists of this one.
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
});

const MARK = 'Mark this chapter as "recently read"';
const UNMARK = 'Remove the "recently read" marker from this chapter';
const PREVIEW = "Show preview of chapter's pages";

// a manga of the connector with one chapter for each entry: a title, or the fields of the chapter
function mangaWith(chapters, fields = {}, connector = site) {
    const manga = addManga(connector, fields);
    for (const chapter of chapters) {
        addChapter(manga, typeof chapter === 'string' ? { title: chapter } : chapter);
    }
    return manga;
}

// The panel next to a component that reads the selection, which is all that the manga panel does to it. The button takes
// the panel away without taking its providers away.
async function mountPanel({ readerEnabled = true, url = '/' } = {}) {
    const selection = {};
    function Harness() {
        selection.current = useSelection();
        const [shown, setShown] = React.useState(true);
        return (
            <>
                <button type="button" onClick={() => setShown(false)}>Remove the panel</button>
                {shown && <ChaptersPanel readerEnabled={readerEnabled} />}
            </>
        );
    }
    const utils = await renderRouted(<Harness />, { url, routes: [{ path: '/reader', element: <p>The reader</p> }] });
    return { selection, ...utils };
}

// what a click on a manga in the manga panel does to the selection
async function select(selection, manga, connectorId = manga.connector.id) {
    await act(async () => {
        selection.current.selectConnector(connectorId);
        selection.current.selectManga(manga);
    });
}

// the list of the manga has arrived (or failed)
async function loaded(manga) {
    await waitFor(() => {
        expect(manga.getChapters).toHaveBeenCalled();
        expect(screen.queryByTitle(/^Loading chapter list/)).toBeNull();
    });
}

async function showManga(manga, options) {
    const view = await mountPanel(options);
    await select(view.selection, manga);
    await loaded(manga);
    return view;
}

// the titles of the rows, in the order that they are drawn
function rows() {
    return screen.queryAllByTitle(/Doubleclick to open the folder/).map(node => node.textContent);
}

function rowOf(title) {
    return screen.getByText(title, { selector: 'span' }).parentElement;
}

function statusButtonOf(title) {
    return within(rowOf(title)).getAllByRole('button')[0];
}

function footer() {
    return screen.getByText(/^Chapters: \d+ \/ \d+$/).textContent;
}

// the status line shows a spinner while it is busy, and then only
function spinning() {
    return screen.getByText(/^Chapters: \d+ \/ \d+$/).parentElement.querySelector('svg') !== null;
}

function toastOf(message) {
    return screen.getByText(message).closest('.pointer-events-auto');
}

// the question that asks to confirm; its buttons have the same names as buttons elsewhere
function question() {
    return within(screen.getByRole('heading').closest('.fixed'));
}

const sortButton = () => screen.getByTitle('Click to toggle chapter sorting');
const downloadAllButton = () => screen.getByTitle(/^Click to download all chapters/);
const languageSelect = () => screen.getByTitle('Select a language to filter the chapter list');
const patternInput = () => screen.getByTitle(/^Enter a pattern/);

// a pattern is typed in one go: the keyboard of user-event reads "{" and "[" as commands
function filterBy(pattern) {
    fireEvent.change(patternInput(), { target: { value: pattern } });
}

function chooseLanguage(language) {
    fireEvent.change(languageSelect(), { target: { value: language } });
}

function languageOptions() {
    return [...languageSelect().options].map(option => option.value);
}

function highlighted() {
    return rows().filter(title => rowOf(title).className.includes('list-selected'));
}

function markedRows() {
    return rows().filter(title => within(rowOf(title)).getByTitle(/recently read/).getAttribute('title') === UNMARK);
}

const orderOf = selection => selection.current.chapterOrder.map(chapter => chapter.title);

// what Chapter.setStatus of the engine does after it changed the status: it tells the document, under the name that the engine
// gives the event
const STATUS_CHANGED = Enums.EventListener.onChapterStatusChanged;

function announceStatus(chapter) {
    act(() => {
        document.dispatchEvent(new CustomEvent(STATUS_CHANGED, { detail: chapter }));
    });
}

// what DownloadManager.addDownload does to the chapter of a job: the status changes in place, the document is told
function queueLikeTheEngine(chapter) {
    chapter.status = 'queued';
    document.dispatchEvent(new CustomEvent(STATUS_CHANGED, { detail: chapter }));
}

describe('chapters panel', () => {
    describe('without a manga', () => {
        it('should show no list, and not ask the engine for anything, until a manga is selected', async () => {
            const manga = mangaWith(['Chapter 1']);
            const { selection } = await mountPanel();
            expect(screen.getByText('Chapter List')).toBeTruthy();
            expect(rows()).toEqual([]);
            expect(footer()).toBe('Chapters: 0 / 0');
            expect(screen.queryByTitle(/^Loading chapter list/)).toBeNull();
            // a query that is disabled has no data and counts as pending: the status line must not take that for loading
            expect(spinning()).toBe(false);
            // a connector alone is not enough
            await act(async () => selection.current.selectConnector('site'));
            expect(rows()).toEqual([]);
            expect(spinning()).toBe(false);
            expect(manga.getChapters).not.toHaveBeenCalled();
        });

        it('should drop the list when the manga is deselected', async () => {
            const { selection } = await showManga(mangaWith(['Chapter 1', 'Chapter 2']));
            expect(rows()).toEqual(['Chapter 1', 'Chapter 2']);
            await act(async () => selection.current.selectConnector('other'));
            expect(rows()).toEqual([]);
            expect(footer()).toBe('Chapters: 0 / 0');
            expect(spinning()).toBe(false);
            expect(selection.current.chapterOrder).toEqual([]);
        });
    });

    describe('loading', () => {
        it('should say that the list is loading until the engine has answered, then show it', async () => {
            let answer = null;
            const manga = mangaWith(['Chapter 1', 'Chapter 2'], { title: 'Berserk', getChapters: vi.fn(callback => { answer = callback; }) });
            const { selection } = await mountPanel();
            await select(selection, manga);
            expect(screen.getByTitle('Loading chapter list (Berserk)')).toBeTruthy();
            expect(spinning()).toBe(true);
            expect(footer()).toBe('Chapters: 0 / 0');
            expect(rows()).toEqual([]);
            await act(async () => answer(null, manga.chapters));
            await screen.findByText('Chapter 2');
            expect(screen.queryByTitle(/^Loading chapter list/)).toBeNull();
            expect(spinning()).toBe(false);
            expect(footer()).toBe('Chapters: 2 / 2');
        });

        it('should not keep showing the chapters of the previous manga while the next one is loading', async () => {
            let answer = null;
            const first = mangaWith(['First 1', 'First 2'], { title: 'First' });
            const second = mangaWith(['Second 1'], { title: 'Second', getChapters: vi.fn(callback => { answer = callback; }) });
            const { selection } = await showManga(first);
            await select(selection, second);
            expect(rows()).toEqual([]);
            expect(screen.getByTitle('Loading chapter list (Second)')).toBeTruthy();
            expect(footer()).toBe('Chapters: 0 / 0');
            await act(async () => answer(null, second.chapters));
            await screen.findByText('Second 1');
            expect(rows()).toEqual(['Second 1']);
        });

        it.each([
            ['an error', callback => callback(new Error('site is down'), [])],
            ['no list at all', callback => callback(null, undefined)]
        ])('should stop saying that it is loading, and show an empty list, when the engine answers with %s', async (name, answer) => {
            // NOTE: nothing tells the user why the list is empty, the failure is only visible to the query
            const manga = mangaWith(['Chapter 1'], { getChapters: vi.fn(answer) });
            await showManga(manga);
            expect(rows()).toEqual([]);
            expect(footer()).toBe('Chapters: 0 / 0');
            expect(spinning()).toBe(false);
        });

        it('should try again to load a list that failed when its manga is selected again', async () => {
            const broken = mangaWith(['Chapter 1', 'Chapter 2'], {
                getChapters: vi.fn()
                    .mockImplementationOnce(callback => callback(new Error('site is down'), []))
                    .mockImplementation(callback => callback(null, broken.chapters))
            });
            const other = mangaWith(['Other 1']);
            const { selection } = await showManga(broken);
            expect(rows()).toEqual([]);
            await select(selection, other);
            await screen.findByText('Other 1');
            await select(selection, broken);
            await screen.findByText('Chapter 2');
            expect(broken.getChapters).toHaveBeenCalledTimes(2);
        });

        it('should keep the lists of mangas apart when they have the same id on different connectors', async () => {
            const other = createConnector({ id: 'other', label: 'Other' });
            engine.Connectors.push(other);
            const first = mangaWith(['Site 1', 'Site 2'], { id: 'same' });
            const second = mangaWith(['Other 1'], { id: 'same' }, other);
            const { selection } = await showManga(first);
            await select(selection, second);
            await screen.findByText('Other 1');
            expect(rows()).toEqual(['Other 1']);
            expect(footer()).toBe('Chapters: 1 / 1');
            // back to the first: its list is still there, the engine is not asked again
            await select(selection, first);
            await screen.findByText('Site 2');
            expect(rows()).toEqual(['Site 1', 'Site 2']);
            expect(first.getChapters).toHaveBeenCalledTimes(1);
            expect(second.getChapters).toHaveBeenCalledTimes(1);
        });

        it('should not let a late answer for the previous manga replace the list of the current one', async () => {
            let late = null;
            const slow = mangaWith(['Slow 1', 'Slow 2'], { getChapters: vi.fn(callback => { late = callback; }) });
            const fast = mangaWith(['Fast 1']);
            const { selection } = await mountPanel();
            await select(selection, slow);
            await select(selection, fast);
            await screen.findByText('Fast 1');
            await act(async () => late(null, slow.chapters));
            // give the query the time to hand the late list to the panel, if it was going to
            await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
            expect(rows()).toEqual(['Fast 1']);
            expect(footer()).toBe('Chapters: 1 / 1');
            expect(orderOf(selection)).toEqual(['Fast 1']);
        });

        it('should draw only the rows that fit, and the rows that are scrolled to, of a long list', async () => {
            const manga = mangaWith(Array.from({ length: 100 }, (unused, index) => `Chapter ${index + 1}`));
            setLayout({ width: 900, height: 66 });
            await showManga(manga);
            expect(footer()).toBe('Chapters: 100 / 100');
            expect(rows().length).toBeGreaterThan(0);
            expect(rows().length).toBeLessThan(40);
            expect(rows()[0]).toBe('Chapter 1');
            const list = screen.getByRole('list');
            list.scrollTop = 22 * 60;
            fireEvent.scroll(list);
            await waitFor(() => expect(rows()).toContain('Chapter 61'));
            expect(rows()).not.toContain('Chapter 1');
        });

        it('should survive a filter that makes the list shorter than the part that was scrolled to', async () => {
            const manga = mangaWith(Array.from({ length: 100 }, (unused, index) => `Chapter ${index + 1}`));
            setLayout({ width: 900, height: 66 });
            await showManga(manga);
            const list = screen.getByRole('list');
            list.scrollTop = 22 * 90;
            fireEvent.scroll(list);
            await waitFor(() => expect(rows()).toContain('Chapter 91'));
            filterBy('Chapter 1');
            expect(rows().length).toBeGreaterThan(0);
            expect(rows().every(title => title.startsWith('Chapter 1'))).toBe(true);
            expect(footer()).toBe('Chapters: 12 / 100');
        });
    });

    describe('title filter', () => {
        const TITLES = ['Chapter 1', 'Chapter 2', 'Chapter 10', 'Special 1.5', 'Special 1x5', 'Épisode 3', 'Vol. 1 / Part 2'];

        it.each([
            ['nothing', '', TITLES],
            ['a word, whatever the case', 'chapter', ['Chapter 1', 'Chapter 2', 'Chapter 10']],
            ['capital letters', 'CHAPTER 1', ['Chapter 1', 'Chapter 10']],
            ['a part from the middle of a title', 'ter 2', ['Chapter 2']],
            ['letters with accents, whatever the case', 'ÉPISODE', ['Épisode 3']],
            ['a pattern with a slash that is not a regular expression', 'vol. 1 / part', ['Vol. 1 / Part 2']],
            ['a plain pattern, which is not read as a regular expression', '1.5', ['Special 1.5']],
            ['a pattern that matches no title', 'volume', []],
            ['a regular expression with an anchor', '/^Chapter 1$/', ['Chapter 1']],
            ['a regular expression, which is a regular expression', '/1.5/', ['Special 1.5', 'Special 1x5']],
            ['a regular expression, which is case sensitive without the flag i', '/chapter 1$/', []],
            ['a regular expression with the flag i', '/chapter 1$/i', ['Chapter 1']],
            ['a regular expression with classes and quantifiers', '/chapter\\s\\d{2}/i', ['Chapter 10']],
            ['a regular expression with the flag g, for every title alike', '/chapter/gi', ['Chapter 1', 'Chapter 2', 'Chapter 10']],
            ['a regular expression that is not finished, which is plain text', '/chapter', []],
            ['more slashes than a regular expression has, which is plain text', '/chapter/i/', []],
            ['two slashes without an expression, which is plain text', '//', []]
        ])('should list %s: "%s"', async (name, pattern, expected) => {
            await showManga(mangaWith(TITLES));
            filterBy(pattern);
            expect(rows()).toEqual(expected);
            expect(footer()).toBe(`Chapters: ${expected.length} / ${TITLES.length}`);
        });

        it.each([
            ['an expression that cannot be compiled', '/(/'],
            ['a flag that does not exist', '/chapter/z']
        ])('should match no title, and go on working, with %s', async (name, pattern) => {
            await showManga(mangaWith(TITLES));
            filterBy(pattern);
            expect(rows()).toEqual([]);
            expect(footer()).toBe(`Chapters: 0 / ${TITLES.length}`);
            // the field and the list are still alive
            filterBy('/^chapter 2$/i');
            expect(rows()).toEqual(['Chapter 2']);
            filterBy('');
            expect(rows()).toEqual(TITLES);
        });

        it('should narrow the list while the pattern is typed, and widen it again when characters are deleted', async () => {
            const user = userEvent.setup();
            await showManga(mangaWith(['Chapter 1', 'Chapter 10', 'Chapter 2']));
            await user.type(patternInput(), 'chapter 1');
            expect(rows()).toEqual(['Chapter 1', 'Chapter 10']);
            await user.type(patternInput(), '0');
            expect(rows()).toEqual(['Chapter 10']);
            await user.clear(patternInput());
            expect(rows()).toEqual(['Chapter 1', 'Chapter 10', 'Chapter 2']);
        });
    });

    describe('language filter', () => {
        const CHAPTERS = [
            { title: 'Chapter 1', language: 'pt' },
            { title: 'Chapter 2', language: 'en' },
            { title: 'Chapter 3', language: '' },
            { title: 'Chapter 4', language: 'de' },
            { title: 'Chapter 5', language: 'en' },
            { title: 'Chapter 6', language: undefined }
        ];

        it('should offer every language of the chapters once, sorted, after the choice of all of them', async () => {
            await showManga(mangaWith(CHAPTERS));
            expect(languageOptions()).toEqual(['', 'de', 'en', 'pt']);
            expect(languageSelect().options[0].textContent).toBe('*');
            expect(languageSelect().value).toBe('');
        });

        it('should offer only the choice of all languages when no chapter has a language', async () => {
            await showManga(mangaWith(['Chapter 1', 'Chapter 2']));
            expect(languageOptions()).toEqual(['']);
        });

        it('should list the chapters of the chosen language, and all of them again for the choice of all languages', async () => {
            await showManga(mangaWith(CHAPTERS));
            chooseLanguage('en');
            expect(rows()).toEqual(['Chapter 2', 'Chapter 5']);
            expect(footer()).toBe('Chapters: 2 / 6');
            chooseLanguage('de');
            expect(rows()).toEqual(['Chapter 4']);
            chooseLanguage('');
            expect(rows()).toHaveLength(6);
            expect(footer()).toBe('Chapters: 6 / 6');
        });

        it('should treat languages that differ only in case as the same one', async () => {
            await showManga(mangaWith([
                { title: 'Chapter 1', language: 'en' },
                { title: 'Chapter 2', language: 'EN' },
                { title: 'Chapter 3', language: 'de' }
            ]));
            chooseLanguage('en');
            expect(rows()).toEqual(['Chapter 1', 'Chapter 2']);
        });

        it('should apply the language and the title together', async () => {
            await showManga(mangaWith(CHAPTERS));
            chooseLanguage('en');
            filterBy('chapter 5');
            expect(rows()).toEqual(['Chapter 5']);
            filterBy('chapter 4');
            expect(rows()).toEqual([]);
        });

        it('should go back to all languages when another manga is selected, although it has the same language', async () => {
            const first = mangaWith(CHAPTERS);
            const second = mangaWith([
                { title: 'Second 1', language: 'en' },
                { title: 'Second 2', language: 'fr' }
            ]);
            const { selection } = await showManga(first);
            chooseLanguage('en');
            expect(rows()).toEqual(['Chapter 2', 'Chapter 5']);
            await select(selection, second);
            await screen.findByText('Second 2');
            expect(languageSelect().value).toBe('');
            expect(languageOptions()).toEqual(['', 'en', 'fr']);
            expect(rows()).toEqual(['Second 1', 'Second 2']);
        });

        it('should keep the language when the engine changes a chapter and the panel is drawn again', async () => {
            const manga = mangaWith(CHAPTERS);
            await showManga(manga);
            chooseLanguage('en');
            manga.chapters[1].status = 'completed';
            announceStatus(manga.chapters[1]);
            expect(languageSelect().value).toBe('en');
            expect(rows()).toEqual(['Chapter 2', 'Chapter 5']);
        });
    });

    describe('sorting', () => {
        const TITLES = ['Chapter 10', 'Chapter 2', 'Chapter 1', 'Chapter 21', 'Chapter 3'];
        const shapeOf = () => [...sortButton().querySelector('svg').classList].filter(name => name.startsWith('lucide-'));

        it('should keep the order of the engine until it is asked to sort', async () => {
            await showManga(mangaWith(TITLES));
            expect(rows()).toEqual(TITLES);
            expect(shapeOf()).toContain('lucide-arrow-up-down');
        });

        it('should go from the order of the engine to ascending, to descending, and back, with the icon of each state', async () => {
            await showManga(mangaWith(TITLES));
            fireEvent.click(sortButton());
            expect(rows()).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 10', 'Chapter 21']);
            expect(shapeOf()).toContain('lucide-arrow-down-a-z');
            fireEvent.click(sortButton());
            expect(rows()).toEqual(['Chapter 21', 'Chapter 10', 'Chapter 3', 'Chapter 2', 'Chapter 1']);
            expect(shapeOf()).toContain('lucide-arrow-up-a-z');
            fireEvent.click(sortButton());
            expect(rows()).toEqual(TITLES);
            expect(shapeOf()).toContain('lucide-arrow-up-down');
        });

        it('should put the numbers inside of the titles in numeric order, not in alphabetical order', async () => {
            await showManga(mangaWith(['Vol.2 Ch.10', 'Vol.10 Ch.1', 'Vol.2 Ch.9', 'Vol.1 Ch.100']));
            fireEvent.click(sortButton());
            expect(rows()).toEqual(['Vol.1 Ch.100', 'Vol.2 Ch.9', 'Vol.2 Ch.10', 'Vol.10 Ch.1']);
        });

        it('should treat titles that differ only in case as equal, and keep them in the order of the engine', async () => {
            await showManga(mangaWith(['b', 'a', 'A', 'B']));
            fireEvent.click(sortButton());
            expect(rows()).toEqual(['a', 'A', 'b', 'B']);
            fireEvent.click(sortButton());
            expect(rows()).toEqual(['b', 'B', 'a', 'A']);
        });

        it('should sort what the filters leave, and leave the list of the engine as it was', async () => {
            const manga = mangaWith(TITLES);
            await showManga(manga);
            filterBy('chapter 1');
            expect(rows()).toEqual(['Chapter 10', 'Chapter 1']);
            fireEvent.click(sortButton());
            expect(rows()).toEqual(['Chapter 1', 'Chapter 10']);
            expect(footer()).toBe('Chapters: 2 / 5');
            // the reader steps through the list of the engine: sorting must work on a copy
            expect(manga.chapters.map(chapter => chapter.title)).toEqual(TITLES);
        });
    });

    describe('order that the reader steps through', () => {
        it('should hand the chapters of the manga, as the engine knows them, to the selection', async () => {
            const manga = mangaWith(['Chapter 1', 'Chapter 2', 'Chapter 3']);
            const { selection } = await showManga(manga);
            expect(orderOf(selection)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3']);
            // the reader needs the chapters of the engine, not copies
            expect(selection.current.chapterOrder[1]).toBe(manga.chapters[1]);
        });

        it('should hand over the list as it is filtered and sorted', async () => {
            const { selection } = await showManga(mangaWith(['Chapter 10', 'Chapter 2', 'Chapter 1', 'Special 7']));
            filterBy('chapter');
            expect(orderOf(selection)).toEqual(['Chapter 10', 'Chapter 2', 'Chapter 1']);
            fireEvent.click(sortButton());
            expect(orderOf(selection)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 10']);
            fireEvent.click(sortButton());
            expect(orderOf(selection)).toEqual(['Chapter 10', 'Chapter 2', 'Chapter 1']);
            filterBy('nothing like this');
            expect(selection.current.chapterOrder).toEqual([]);
        });

        it('should follow the language filter', async () => {
            const { selection } = await showManga(mangaWith([
                { title: 'Chapter 1', language: 'en' },
                { title: 'Chapter 2', language: 'de' }
            ]));
            chooseLanguage('de');
            expect(orderOf(selection)).toEqual(['Chapter 2']);
        });

        it('should hand over the chapters of the next manga, and nothing of the previous one', async () => {
            const { selection } = await showManga(mangaWith(['First 1', 'First 2']));
            await select(selection, mangaWith(['Second 1']));
            await screen.findByText('Second 1');
            expect(orderOf(selection)).toEqual(['Second 1']);
        });

        it('should take the order back when the panel goes away', async () => {
            const { selection } = await showManga(mangaWith(['Chapter 1', 'Chapter 2']));
            expect(selection.current.chapterOrder).toHaveLength(2);
            fireEvent.click(screen.getByRole('button', { name: 'Remove the panel' }));
            expect(screen.queryByText('Chapter List')).toBeNull();
            expect(selection.current.chapterOrder).toEqual([]);
        });
    });

    describe('downloading all chapters', () => {
        // available are 1 and 4
        const STATUSES = ['available', 'completed', 'failed', 'available', 'queued', 'offline', 'unavailable', 'downloading'];

        function mangaWithStatuses() {
            return mangaWith(STATUSES.map((status, index) => ({ title: `Chapter ${index + 1}`, status })));
        }

        const queued = () => engine.DownloadManager.addDownload.mock.calls.map(([chapter]) => chapter.title);

        it('should ask before it queues, and queue only the chapters that are available', async () => {
            await showManga(mangaWithStatuses());
            fireEvent.click(downloadAllButton());
            expect(screen.getByRole('heading').textContent).toBe('Download 2 new chapter(s) from the current chapter list?');
            expect(queued()).toEqual([]);
            fireEvent.click(question().getByRole('button', { name: 'Download' }));
            expect(queued()).toEqual(['Chapter 1', 'Chapter 4']);
            expect(screen.getByText('Queued 2 chapter(s).')).toBeTruthy();
            expect(toastOf('Queued 2 chapter(s).').className).toMatch(/green/);
            expect(screen.queryByRole('heading')).toBeNull();
        });

        it('should queue nothing when the question is declined', async () => {
            await showManga(mangaWithStatuses());
            fireEvent.click(downloadAllButton());
            fireEvent.click(question().getByRole('button', { name: 'Cancel' }));
            expect(screen.queryByRole('heading')).toBeNull();
            expect(queued()).toEqual([]);
            expect(screen.queryByText(/^Queued/)).toBeNull();
        });

        it('should hand the chapters themselves, not copies, to the download manager, which finds duplicates by identity', async () => {
            const manga = mangaWithStatuses();
            await showManga(manga);
            fireEvent.click(downloadAllButton());
            fireEvent.click(question().getByRole('button', { name: 'Download' }));
            const [first, second] = engine.DownloadManager.addDownload.mock.calls.map(([chapter]) => chapter);
            expect(first).toBe(manga.chapters[0]);
            expect(second).toBe(manga.chapters[3]);
        });

        it('should queue only the chapters that the title filter shows', async () => {
            await showManga(mangaWithStatuses());
            filterBy('/chapter [1-3]$/i');
            fireEvent.click(downloadAllButton());
            expect(screen.getByRole('heading').textContent).toBe('Download 1 new chapter(s) from the current chapter list?');
            fireEvent.click(question().getByRole('button', { name: 'Download' }));
            expect(queued()).toEqual(['Chapter 1']);
        });

        it('should queue only the chapters that the language filter shows', async () => {
            await showManga(mangaWith([
                { title: 'Chapter 1', language: 'en' },
                { title: 'Chapter 2', language: 'de' },
                { title: 'Chapter 3', language: 'en' }
            ]));
            chooseLanguage('de');
            fireEvent.click(downloadAllButton());
            fireEvent.click(question().getByRole('button', { name: 'Download' }));
            expect(queued()).toEqual(['Chapter 2']);
        });

        it('should queue the chapters in the order that the list shows them', async () => {
            await showManga(mangaWithStatuses());
            fireEvent.click(sortButton());
            fireEvent.click(sortButton());
            fireEvent.click(downloadAllButton());
            fireEvent.click(question().getByRole('button', { name: 'Download' }));
            expect(queued()).toEqual(['Chapter 4', 'Chapter 1']);
        });

        it.each([
            ['every chapter has a status other than available', ['completed', 'failed', 'queued']],
            ['the manga has no chapters', []]
        ])('should do nothing when %s', async (name, statuses) => {
            await showManga(mangaWith(statuses.map((status, index) => ({ title: `Chapter ${index + 1}`, status }))));
            fireEvent.click(downloadAllButton());
            expect(screen.queryByRole('heading')).toBeNull();
            expect(queued()).toEqual([]);
            expect(screen.queryByText(/^Queued/)).toBeNull();
        });

        it('should do nothing when the filters hide every chapter that is available', async () => {
            await showManga(mangaWithStatuses());
            filterBy('/chapter [23]$/i');
            expect(rows()).toEqual(['Chapter 2', 'Chapter 3']);
            fireEvent.click(downloadAllButton());
            expect(screen.queryByRole('heading')).toBeNull();
            expect(queued()).toEqual([]);
        });

        it('should do nothing while no manga is selected', async () => {
            await mountPanel();
            fireEvent.click(downloadAllButton());
            expect(screen.queryByRole('heading')).toBeNull();
            expect(queued()).toEqual([]);
        });

        it('should not offer chapters again that the engine has queued meanwhile', async () => {
            engine.DownloadManager.addDownload.mockImplementation(queueLikeTheEngine);
            await showManga(mangaWithStatuses());
            fireEvent.click(downloadAllButton());
            fireEvent.click(question().getByRole('button', { name: 'Download' }));
            expect(queued()).toEqual(['Chapter 1', 'Chapter 4']);
            fireEvent.click(downloadAllButton());
            expect(screen.queryByRole('heading')).toBeNull();
            expect(queued()).toEqual(['Chapter 1', 'Chapter 4']);
        });
    });

    describe('a list that cannot be loaded', () => {
        it('should say why, instead of looking like a manga without chapters', async () => {
            const manga = mangaWith(['Chapter 1']);
            manga.getChapters.mockImplementation(callback => callback(new Error('HTTP 503')));
            const { selection } = await mountPanel();
            await select(selection, manga);
            expect(await screen.findByText('Failed to load the chapter list: HTTP 503')).toBeTruthy();
            expect(toastOf('Failed to load the chapter list: HTTP 503').className).toMatch(/red/);
            expect(footer()).toBe('Chapters: 0 / 0');
        });

        it('should say it once for a failure, however often the panel is drawn again', async () => {
            const manga = mangaWith(['Chapter 1']);
            manga.getChapters.mockImplementation(callback => callback(new Error('HTTP 503')));
            const { selection } = await mountPanel();
            await select(selection, manga);
            await screen.findByText('Failed to load the chapter list: HTTP 503');
            fireEvent.change(screen.getByTitle(/Enter a pattern/), { target: { value: 'x' } });
            fireEvent.change(screen.getByTitle(/Enter a pattern/), { target: { value: '' } });
            expect(screen.getAllByText('Failed to load the chapter list: HTTP 503')).toHaveLength(1);
        });
    });

    describe('status button', () => {
        it.each([
            ['unavailable', 'Chapter is not available'],
            ['offline', 'OFFLINE\nThe chapter is only accessable from the manga directory'],
            ['available', 'AVAILABLE\nClick to download chapter'],
            ['queued', 'QUEUED\nClick to cancel the download'],
            ['downloading', 'DOWNLOADING\nClick to cancel the download'],
            ['completed', 'DOWNLOADED\nClick to delete and re-download chapter'],
            ['failed', 'DOWNLOAD FAILED\nCheck the exclamation mark in the joblist for details\nClick to delete and re-download the chapter'],
            ['not known', 'No tooltip available!'],
            [undefined, 'No tooltip available!']
        ])('should explain a chapter that is %s in the tooltip of its button', async (status, tooltip) => {
            await showManga(mangaWith([{ title: 'Chapter 1', status: status === 'not known' ? 'something else' : status }]));
            expect(statusButtonOf('Chapter 1').getAttribute('title')).toBe(tooltip);
        });

        it('should show the status of every chapter on its own row', async () => {
            await showManga(mangaWith([
                { title: 'Chapter 1', status: 'available' },
                { title: 'Chapter 2', status: 'completed' },
                { title: 'Chapter 3', status: 'failed' }
            ]));
            expect(statusButtonOf('Chapter 1').getAttribute('title')).toMatch(/^AVAILABLE/);
            expect(statusButtonOf('Chapter 2').getAttribute('title')).toMatch(/^DOWNLOADED/);
            expect(statusButtonOf('Chapter 3').getAttribute('title')).toMatch(/^DOWNLOAD FAILED/);
        });

        it.each(['available', 'failed'])('should queue a chapter that is %s, and tell so', async status => {
            const manga = mangaWith([{ title: 'Chapter 1', status }, { title: 'Chapter 2', status: 'available' }]);
            await showManga(manga);
            fireEvent.click(statusButtonOf('Chapter 1'));
            expect(engine.DownloadManager.addDownload).toHaveBeenCalledExactlyOnceWith(manga.chapters[0]);
            expect(toastOf('Queued 1 chapter(s).').className).toMatch(/green/);
            // no question for a chapter that is not on the device yet
            expect(screen.queryByRole('heading')).toBeNull();
        });

        it.each(['unavailable', 'offline', 'something else', undefined])('should say that there is nothing to do for a chapter that is %s', async status => {
            await showManga(mangaWith([{ title: 'Chapter 1', status }]));
            fireEvent.click(statusButtonOf('Chapter 1'));
            expect(screen.getByText('No action available!')).toBeTruthy();
            expect(toastOf('No action available!').className).not.toMatch(/red|green/);
            expect(engine.DownloadManager.addDownload).not.toHaveBeenCalled();
            expect(screen.queryByRole('heading')).toBeNull();
        });

        describe('canceling a download', () => {
            // the chapter is on its way: the engine changes its status in place and announces it, like the manager does
            async function showQueued(status) {
                const manga = mangaWith([{ title: 'Chapter 1', status }, { title: 'Chapter 2', status: 'available' }]);
                await showManga(manga);
                return manga;
            }

            it.each(['queued', 'downloading'])('should cancel the download of a chapter that is %s, and tell so', async status => {
                const manga = await showQueued(status);
                engine.DownloadManager.cancelChapter.mockImplementationOnce(chapter => {
                    chapter.status = 'available';
                    document.dispatchEvent(new CustomEvent(STATUS_CHANGED, { detail: chapter }));
                    return true;
                });
                fireEvent.click(statusButtonOf('Chapter 1'));
                expect(engine.DownloadManager.cancelChapter).toHaveBeenCalledExactlyOnceWith(manga.chapters[0]);
                expect(toastOf('Canceled "Chapter 1".').className).toMatch(/green/);
                // the chapter can be downloaded again, and the other chapters were left alone
                expect(statusButtonOf('Chapter 1').getAttribute('title')).toMatch(/^AVAILABLE/);
                expect(engine.DownloadManager.cancelChapter).toHaveBeenCalledTimes(1);
                expect(engine.DownloadManager.addDownload).not.toHaveBeenCalled();
                expect(screen.queryByRole('heading')).toBeNull();
            });

            it('should say that it is too late when the engine cannot stop the download any more', async () => {
                await showQueued('downloading');
                engine.DownloadManager.cancelChapter.mockReturnValueOnce(false);
                fireEvent.click(statusButtonOf('Chapter 1'));
                expect(toastOf('The download cannot be canceled any more.').className).not.toMatch(/red|green/);
                expect(statusButtonOf('Chapter 1').getAttribute('title')).toMatch(/^DOWNLOADING/);
            });

            it('should report a failure to cancel, and leave the chapter as it was', async () => {
                await showQueued('queued');
                engine.DownloadManager.cancelChapter.mockImplementationOnce(() => {
                    throw new Error('no manager');
                });
                fireEvent.click(statusButtonOf('Chapter 1'));
                expect(toastOf('Cancel failed: no manager').className).toMatch(/red/);
                expect(statusButtonOf('Chapter 1').getAttribute('title')).toMatch(/^QUEUED/);
            });

            it('should not cancel anything for the chapters that are not on their way', async () => {
                await showManga(mangaWith([
                    { title: 'Chapter 1', status: 'available' },
                    { title: 'Chapter 2', status: 'failed' },
                    { title: 'Chapter 3', status: 'unavailable' }
                ]));
                for (const title of ['Chapter 1', 'Chapter 2', 'Chapter 3']) {
                    fireEvent.click(statusButtonOf(title));
                }
                expect(engine.DownloadManager.cancelChapter).not.toHaveBeenCalled();
            });
        });

        it('should ask before it downloads a chapter again that is on the device, and then queue it', async () => {
            const manga = mangaWith([{ title: 'Chapter 1', status: 'completed' }, { title: 'Chapter 2', status: 'completed' }]);
            await showManga(manga);
            fireEvent.click(statusButtonOf('Chapter 2'));
            expect(screen.getByRole('heading').textContent).toBe('Re-download existing chapter?');
            expect(screen.getByText('"Chapter 2" is already downloaded.')).toBeTruthy();
            expect(engine.DownloadManager.addDownload).not.toHaveBeenCalled();
            fireEvent.click(question().getByRole('button', { name: 'Re-download' }));
            expect(engine.DownloadManager.addDownload).toHaveBeenCalledExactlyOnceWith(manga.chapters[1]);
            expect(screen.getByText('Queued 1 chapter(s).')).toBeTruthy();
            expect(screen.queryByRole('heading')).toBeNull();
        });

        it('should leave a chapter that is on the device alone when the question is declined, and not remember it', async () => {
            const manga = mangaWith([{ title: 'Chapter 1', status: 'completed' }, { title: 'Chapter 2', status: 'completed' }]);
            await showManga(manga);
            fireEvent.click(statusButtonOf('Chapter 1'));
            fireEvent.click(question().getByRole('button', { name: 'Cancel' }));
            expect(screen.queryByRole('heading')).toBeNull();
            expect(engine.DownloadManager.addDownload).not.toHaveBeenCalled();
            // the next question is about the next chapter, and queues only that one
            fireEvent.click(statusButtonOf('Chapter 2'));
            expect(screen.getByText('"Chapter 2" is already downloaded.')).toBeTruthy();
            fireEvent.click(question().getByRole('button', { name: 'Re-download' }));
            expect(engine.DownloadManager.addDownload).toHaveBeenCalledExactlyOnceWith(manga.chapters[1]);
        });
    });

    describe('status changes by the engine', () => {
        it('should draw a chapter again when the engine changes its status in place and announces it', async () => {
            const manga = mangaWith([{ title: 'Chapter 1', status: 'available' }, { title: 'Chapter 2', status: 'available' }]);
            await showManga(manga);
            expect(statusButtonOf('Chapter 1').getAttribute('title')).toMatch(/^AVAILABLE/);
            manga.chapters[0].status = 'downloading';
            announceStatus(manga.chapters[0]);
            expect(statusButtonOf('Chapter 1').getAttribute('title')).toBe('DOWNLOADING\nClick to cancel the download');
            expect(statusButtonOf('Chapter 2').getAttribute('title')).toMatch(/^AVAILABLE/);
            manga.chapters[0].status = 'completed';
            announceStatus(manga.chapters[0]);
            expect(statusButtonOf('Chapter 1').getAttribute('title')).toMatch(/^DOWNLOADED/);
        });

        it('should show a chapter as queued as soon as the engine queues it, and then offer to cancel it, not to queue it again', async () => {
            engine.DownloadManager.addDownload.mockImplementation(queueLikeTheEngine);
            const manga = mangaWith([{ title: 'Chapter 1', status: 'available' }]);
            await showManga(manga);
            fireEvent.click(statusButtonOf('Chapter 1'));
            expect(statusButtonOf('Chapter 1').getAttribute('title')).toBe('QUEUED\nClick to cancel the download');
            fireEvent.click(statusButtonOf('Chapter 1'));
            expect(engine.DownloadManager.addDownload).toHaveBeenCalledTimes(1);
            expect(engine.DownloadManager.cancelChapter).toHaveBeenCalledExactlyOnceWith(manga.chapters[0]);
        });

        it('should listen on the document once, and stop listening when it goes away', async () => {
            const add = vi.spyOn(document, 'addEventListener');
            const remove = vi.spyOn(document, 'removeEventListener');
            await showManga(mangaWith(['Chapter 1']));
            const added = add.mock.calls.filter(([type]) => type === STATUS_CHANGED);
            expect(added).toHaveLength(1);
            expect(remove.mock.calls.filter(([type]) => type === STATUS_CHANGED)).toHaveLength(0);
            fireEvent.click(screen.getByRole('button', { name: 'Remove the panel' }));
            const removed = remove.mock.calls.filter(([type]) => type === STATUS_CHANGED);
            expect(removed).toHaveLength(1);
            expect(removed[0][1]).toBe(added[0][1]);
        });

        it('should keep working for the next manga', async () => {
            const first = mangaWith([{ title: 'First 1', status: 'available' }]);
            const second = mangaWith([{ title: 'Second 1', status: 'available' }]);
            const { selection } = await showManga(first);
            await select(selection, second);
            await screen.findByText('Second 1');
            second.chapters[0].status = 'failed';
            announceStatus(second.chapters[0]);
            expect(statusButtonOf('Second 1').getAttribute('title')).toMatch(/^DOWNLOAD FAILED/);
        });
    });

    describe('reader button', () => {
        const searchOf = router => router.state.location.search;

        it.each([
            ['is', true, 2],
            ['is not', false, 0]
        ])('should have a button on every row when the reader %s enabled: %i of them', async (name, readerEnabled, buttons) => {
            await showManga(mangaWith(['Chapter 1', 'Chapter 2']), { readerEnabled });
            expect(rows()).toEqual(['Chapter 1', 'Chapter 2']);
            expect(screen.queryAllByTitle(PREVIEW)).toHaveLength(buttons);
        });

        it('should open the reader with the connector, the manga and the chapter of the row in the address', async () => {
            const { router } = await showManga(mangaWith(['Chapter 1', 'Chapter 2', 'Chapter 3'], { id: 'berserk' }));
            fireEvent.click(within(rowOf('Chapter 2')).getByTitle(PREVIEW));
            await waitFor(() => expect(router.state.location.pathname).toBe('/reader'));
            expect(searchOf(router)).toEqual({ connector: 'site', manga: 'berserk', chapter: 'c2' });
            expect(await screen.findByText('The reader')).toBeTruthy();
        });

        it.each(['12345', '007', '1e3', '-5', '0', 'true', 'null', '[1]'])('should keep the id %s of a chapter and of a manga a string in the address', async id => {
            const { router } = await showManga(mangaWith([{ id, title: 'Chapter 1' }], { id }));
            fireEvent.click(within(rowOf('Chapter 1')).getByTitle(PREVIEW));
            await waitFor(() => expect(router.state.location.pathname).toBe('/reader'));
            expect(searchOf(router)).toEqual({ connector: 'site', manga: id, chapter: id });
        });

        // some connectors hand over numbers as ids (WutopiaComics: parseInt, ShueishaMangaPlus: protobuf), and the route of the
        // reader accepts only text
        it('should hand ids that are numbers to the reader as strings, which is all that its route accepts', async () => {
            const { router } = await showManga(mangaWith([{ id: 12345, title: 'Chapter 1' }], { id: 987 }));
            fireEvent.click(within(rowOf('Chapter 1')).getByTitle(PREVIEW));
            await waitFor(() => expect(router.state.location.pathname).toBe('/reader'));
            expect(searchOf(router)).toEqual({ connector: 'site', manga: '987', chapter: '12345' });
        });

        it('should open the reader under the default connector that the manga panel selected, when the user chose none', async () => {
            engine.Connectors.push(createConnector({ id: 'other', label: 'Other' }));
            mangaWith(['Chapter 1', 'Chapter 2'], { title: 'Berserk' });
            const { router } = await renderRouted(
                <>
                    <MangaPanel readerEnabled />
                    <ChaptersPanel readerEnabled />
                </>,
                { routes: [{ path: '/reader', element: <p>The reader</p> }] }
            );
            fireEvent.click(await screen.findByText('Berserk'));
            await screen.findByText('Chapter 2');
            fireEvent.click(within(rowOf('Chapter 2')).getByTitle(PREVIEW));
            await waitFor(() => expect(router.state.location.pathname).toBe('/reader'));
            expect(searchOf(router)).toEqual({ connector: 'site', manga: 'm1', chapter: 'c2' });
        });

        it.each([
            ['the connector of the manga', 'site'],
            ['the bookmarks, which are not the connector of the manga', 'bookmarks']
        ])('should open the reader under the connector that was selected, %s, so that it finds the list that was loaded here', async (name, connectorId) => {
            const bookmarks = createConnector({ id: 'bookmarks', label: 'Bookmarks' });
            engine.Connectors.push(bookmarks);
            const manga = mangaWith(['Chapter 1', 'Chapter 2']);
            bookmarks.mangas.push(manga);
            const { selection, router } = await mountPanel();
            await select(selection, manga, connectorId);
            await loaded(manga);
            fireEvent.click(within(rowOf('Chapter 2')).getByTitle(PREVIEW));
            await waitFor(() => expect(router.state.location.pathname).toBe('/reader'));
            const { connector, manga: mangaId, chapter } = searchOf(router);
            expect(connector).toBe(connectorId);
            const resolved = await resolveChapter(connector, mangaId, chapter);
            expect(resolved.index).toBe(1);
            expect(resolved.chapters).toBe(manga.chapters);
            expect(manga.getChapters).toHaveBeenCalledTimes(1);
        });
    });

    describe('chapter that is open in the reader', () => {
        const manga = () => mangaWith(['Chapter 1', 'Chapter 2', 'Chapter 3']);

        it('should highlight the chapter of the address, and no other', async () => {
            await showManga(manga(), { url: '/?connector=site&manga=m1&chapter=c2' });
            expect(highlighted()).toEqual(['Chapter 2']);
        });

        it('should highlight nothing when the address names no chapter, or a chapter that is not in the list', async () => {
            const { router } = await showManga(manga(), { url: '/' });
            expect(highlighted()).toEqual([]);
            await act(async () => router.navigate({ to: '/', search: { connector: 'site', manga: 'm1', chapter: 'c99' } }));
            expect(highlighted()).toEqual([]);
        });

        it('should move the highlight when the address changes, and take it away when the chapter leaves the address', async () => {
            const { router } = await showManga(manga(), { url: '/?connector=site&manga=m1&chapter=c2' });
            await act(async () => router.navigate({ to: '/', search: { connector: 'site', manga: 'm1', chapter: 'c3' } }));
            expect(highlighted()).toEqual(['Chapter 3']);
            await act(async () => router.navigate({ to: '/', search: {} }));
            expect(highlighted()).toEqual([]);
        });

        it('should highlight a chapter whose id looks like a number, when the address was made by the router', async () => {
            const { router } = await showManga(mangaWith([{ id: '12345', title: 'Chapter 1' }, { id: '12346', title: 'Chapter 2' }]));
            await act(async () => router.navigate({ to: '/', search: { connector: 'site', manga: 'm1', chapter: '12345' } }));
            expect(highlighted()).toEqual(['Chapter 1']);
        });

        it('should highlight the chapter of the address under the sort order and the filters too', async () => {
            await showManga(manga(), { url: '/?connector=site&manga=m1&chapter=c2' });
            fireEvent.click(sortButton());
            fireEvent.click(sortButton());
            expect(rows()).toEqual(['Chapter 3', 'Chapter 2', 'Chapter 1']);
            expect(highlighted()).toEqual(['Chapter 2']);
            filterBy('chapter 2');
            expect(highlighted()).toEqual(['Chapter 2']);
        });

        // the id of a chapter of another manga (or of another connector) can be the same as the one of the chapter in the reader
        it.each([
            ['another manga of the connector', 'site', 'm2'],
            ['a manga with the same id on another connector', 'other', 'm1']
        ])('should not highlight a chapter of %s that has the id of the chapter in the reader', async (name, connectorId, mangaId) => {
            const other = createConnector({ id: 'other', label: 'Other' });
            engine.Connectors.push(other);
            const open = mangaWith(['Chapter 1', 'Chapter 2', 'Chapter 3'], { id: 'm1' });
            mangaWith(['Chapter 1', 'Chapter 2', 'Chapter 3'], { id: 'm2' });
            mangaWith(['Chapter 1', 'Chapter 2', 'Chapter 3'], { id: 'm1' }, other);
            const shown = [...site.mangas, ...other.mangas].find(entry => entry.connector.id === connectorId && entry.id === mangaId);
            const { selection } = await showManga(open, { url: '/?connector=site&manga=m1&chapter=c2' });
            expect(highlighted()).toEqual(['Chapter 2']);
            await select(selection, shown);
            await screen.findByText('Chapter 3');
            expect(highlighted()).toEqual([]);
        });
    });

    describe('recently read marker', () => {
        const markOf = (manga, chapter) => ({
            connectorID: manga.connector.id,
            mangaID: manga.id,
            chapterID: chapter.id,
            chapterTitle: chapter.title
        });

        it('should offer to mark every chapter when none is marked, and show no stub', async () => {
            await showManga(mangaWith(['Chapter 1', 'Chapter 2']));
            expect(markedRows()).toEqual([]);
            expect(within(rowOf('Chapter 1')).getByTitle(/recently read/).getAttribute('title')).toBe(MARK);
            expect(screen.queryByTitle('Click to remove the marked chapter')).toBeNull();
        });

        it('should mark the chapter whose marker is clicked, and move the marker when another chapter is clicked', async () => {
            const manga = mangaWith(['Chapter 1', 'Chapter 2', 'Chapter 3']);
            await showManga(manga);
            fireEvent.click(within(rowOf('Chapter 2')).getByTitle(MARK));
            expect(engine.ChaptermarkManager.addChaptermark).toHaveBeenCalledExactlyOnceWith(manga.chapters[1]);
            expect(markedRows()).toEqual(['Chapter 2']);
            fireEvent.click(within(rowOf('Chapter 3')).getByTitle(MARK));
            expect(markedRows()).toEqual(['Chapter 3']);
            expect(engine.ChaptermarkManager.chaptermarks).toHaveLength(1);
        });

        it('should remove the marker when the marked chapter is clicked', async () => {
            const manga = mangaWith(['Chapter 1', 'Chapter 2']);
            engine.ChaptermarkManager.chaptermarks.push(markOf(manga, manga.chapters[0]));
            await showManga(manga);
            expect(markedRows()).toEqual(['Chapter 1']);
            fireEvent.click(within(rowOf('Chapter 1')).getByTitle(UNMARK));
            expect(engine.ChaptermarkManager.deleteChaptermark).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chapterID: 'c1' }));
            expect(engine.ChaptermarkManager.addChaptermark).not.toHaveBeenCalled();
            expect(markedRows()).toEqual([]);
        });

        it('should show the marker that the reader sets while the panel is open, and move it with the next one', async () => {
            const manga = mangaWith(['Chapter 1', 'Chapter 2', 'Chapter 3']);
            await showManga(manga);
            act(() => engine.ChaptermarkManager.addChaptermark(manga.chapters[2]));
            expect(markedRows()).toEqual(['Chapter 3']);
            act(() => engine.ChaptermarkManager.addChaptermark(manga.chapters[0]));
            expect(markedRows()).toEqual(['Chapter 1']);
            act(() => engine.ChaptermarkManager.deleteChaptermark(engine.ChaptermarkManager.chaptermarks[0]));
            expect(markedRows()).toEqual([]);
        });

        it('should show the marker only on the manga that it belongs to', async () => {
            const first = mangaWith(['Chapter 1', 'Chapter 2'], { id: 'same' });
            const second = mangaWith(['Chapter 1', 'Chapter 2'], { id: 'other' });
            engine.ChaptermarkManager.chaptermarks.push(markOf(first, first.chapters[1]));
            const { selection } = await showManga(first);
            expect(markedRows()).toEqual(['Chapter 2']);
            await select(selection, second);
            await loaded(second);
            expect(rows()).toEqual(['Chapter 1', 'Chapter 2']);
            expect(markedRows()).toEqual([]);
            expect(screen.queryByTitle('Click to remove the marked chapter')).toBeNull();
        });

        it('should keep the marker when the title filter hides the marked chapter, without drawing a stub for it', async () => {
            const manga = mangaWith(['Chapter 1', 'Chapter 2']);
            engine.ChaptermarkManager.chaptermarks.push(markOf(manga, manga.chapters[0]));
            await showManga(manga);
            filterBy('chapter 2');
            expect(rows()).toEqual(['Chapter 2']);
            expect(screen.queryByTitle('Click to remove the marked chapter')).toBeNull();
            filterBy('');
            expect(markedRows()).toEqual(['Chapter 1']);
        });

        describe('of a chapter that is gone', () => {
            const GONE = { connectorID: 'site', mangaID: 'm1', chapterID: 'gone', chapterTitle: 'Chapter 99' };

            it('should draw a stub row with the title of the chapter and a button to remove the marker', async () => {
                const manga = mangaWith(['Chapter 1', 'Chapter 2']);
                const mark = { ...GONE, mangaID: manga.id };
                engine.ChaptermarkManager.chaptermarks.push(mark);
                await showManga(manga);
                const stub = screen.getByText('Chapter 99');
                expect(stub.getAttribute('title')).toBe('The chapter has been marked as "recently read" but is no longer available\nID: gone');
                expect(markedRows()).toEqual([]);
                expect(rows()).toEqual(['Chapter 1', 'Chapter 2']);
                fireEvent.click(screen.getByTitle('Click to remove the marked chapter'));
                expect(engine.ChaptermarkManager.deleteChaptermark).toHaveBeenCalledExactlyOnceWith(mark);
                expect(screen.queryByText('Chapter 99')).toBeNull();
                expect(engine.ChaptermarkManager.chaptermarks).toEqual([]);
            });

            it('should wait for the list before it decides that the chapter is gone', async () => {
                let answer = null;
                const manga = mangaWith(['Chapter 1'], { getChapters: vi.fn(callback => { answer = callback; }) });
                engine.ChaptermarkManager.chaptermarks.push({ ...GONE, mangaID: manga.id });
                const { selection } = await mountPanel();
                await select(selection, manga);
                expect(screen.queryByText('Chapter 99')).toBeNull();
                await act(async () => answer(null, manga.chapters));
                expect(await screen.findByText('Chapter 99')).toBeTruthy();
            });

            it('should draw no stub for a manga that has no chapter at all', async () => {
                const manga = mangaWith([]);
                engine.ChaptermarkManager.chaptermarks.push({ ...GONE, mangaID: manga.id });
                await showManga(manga);
                expect(screen.queryByText('Chapter 99')).toBeNull();
            });
        });

        it('should listen to the chaptermarks once, and stop listening when it goes away', async () => {
            const add = vi.spyOn(engine.ChaptermarkManager, 'addEventListener');
            const remove = vi.spyOn(engine.ChaptermarkManager, 'removeEventListener');
            await showManga(mangaWith(['Chapter 1']));
            const added = add.mock.calls.filter(([type]) => type === 'changed');
            expect(added).toHaveLength(1);
            fireEvent.click(screen.getByRole('button', { name: 'Remove the panel' }));
            const removed = remove.mock.calls.filter(([type]) => type === 'changed');
            expect(removed).toHaveLength(1);
            expect(removed[0][1]).toBe(added[0][1]);
        });
    });

    describe('folder of a chapter', () => {
        it('should open the folder of the chapter that is double clicked, and not for a single click', async () => {
            const manga = mangaWith(['Chapter 1', 'Chapter 2']);
            await showManga(manga);
            const title = screen.getByText('Chapter 2', { selector: 'span' });
            fireEvent.click(title);
            expect(engine.Storage.showFolderContent).not.toHaveBeenCalled();
            fireEvent.doubleClick(title);
            expect(engine.Storage.showFolderContent).toHaveBeenCalledExactlyOnceWith(manga.chapters[1]);
            expect(screen.queryByText(/^Failed to open/)).toBeNull();
        });

        it('should tell the user when the folder cannot be opened, and go on working', async () => {
            engine.Storage.showFolderContent.mockImplementationOnce(() => {
                throw new Error('no file manager');
            });
            await showManga(mangaWith(['Chapter 1', 'Chapter 2']));
            fireEvent.doubleClick(screen.getByText('Chapter 1', { selector: 'span' }));
            expect(screen.getByText('Failed to open the folder: no file manager')).toBeTruthy();
            expect(toastOf('Failed to open the folder: no file manager').className).toMatch(/red/);
            expect(rows()).toEqual(['Chapter 1', 'Chapter 2']);
            fireEvent.doubleClick(screen.getByText('Chapter 2', { selector: 'span' }));
            expect(engine.Storage.showFolderContent).toHaveBeenCalledTimes(2);
        });
    });
});
