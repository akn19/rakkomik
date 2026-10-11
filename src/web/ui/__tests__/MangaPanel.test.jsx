import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MangaPanel from '../MangaPanel.jsx';
import { queryClient } from '../queries.js';
import { useSelection } from '../selection.jsx';
import { trackListeners } from './support/engineListeners.js';
import { addManga, createConnector, installEngine } from './support/fakeEngine.js';
import { setLayout } from './support/layout.js';
import { renderWithProviders } from './support/render.jsx';
import { createManga, createUpdatableConnector, makeMangas } from './support/updatableConnector.js';

const STAR_NOTHING_SELECTED = 'Please select a manga to use the bookmark feature';
const STAR_ADD = 'Click to add the selected manga to the bookmark list';
const STAR_REMOVE = 'Click to remove the selected manga from the bookmark list';

let engine = null;
let site = null;
let other = null;
// the selection as the neighbours of the panel (the chapter list, the reader) see it
let selection = null;
let consoleError = null;
let expectConsoleErrors = false;

function SelectionProbe() {
    selection = useSelection();
    return null;
}

function mount() {
    return renderWithProviders(
        <>
            <MangaPanel readerEnabled />
            <SelectionProbe />
        </>
    );
}

// the panel with the list of the first connector, which is that of `site` unless the test made another engine
async function mountLoaded(firstTitle = 'Akira') {
    const view = mount();
    await screen.findByText(firstTitle);
    return view;
}

// the bookmark connector of the engine (connectors/system/BookmarkConnector.mjs): its list is made of the bookmarks, each with
// the connector of its website, or a stand-in while that connector is not registered (yet)
function createBookmarksConnector() {
    const list = callback => {
        const mangas = window.Engine.BookmarkManager.bookmarks.map(bookmark => createManga(
            window.Engine.Connectors.find(entry => entry.id === bookmark.key.connector)
                || { id: bookmark.key.connector, label: `${bookmark.key.connector} (unavailable)` },
            bookmark.key.manga,
            bookmark.title.manga
        ));
        mangas.sort((a, b) => (a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1));
        callback(null, mangas);
    };
    return createConnector({ id: 'bookmarks', label: ' 【Bookmarks】', url: undefined, getMangas: vi.fn(list), updateMangas: vi.fn(list) });
}

// the clipboard connector (connectors/system/ClipboardConnector.mjs): it lists what its last update read from the clipboard
function createClipboardConnector(pasted) {
    const connector = createConnector({
        id: 'clipboard',
        label: ' 【Clipboard】',
        url: undefined,
        updateMangas: vi.fn(callback => {
            connector.mangas = pasted;
            callback(null, connector.mangas);
        })
    });
    return connector;
}

const rows = () => screen.queryAllByRole('option').map(row => row.textContent);
const selectedRows = () => screen.queryAllByRole('option').filter(row => row.getAttribute('aria-selected') === 'true').map(row => row.textContent);
const websiteField = () => screen.getByLabelText('Website');
const filterField = () => screen.getByTitle(/to filter the manga list/);
const pasteButton = () => screen.getByTitle('Click to paste manga links from the clipboard');
const refreshButton = () => screen.getAllByTitle(/^Synchronize local manga list/)[0];
const starButton = () => screen.getByRole('button', { name: /bookmark/ });
const spins = button => button.querySelector('svg').classList.contains('animate-spin');
// the status line under the list: its message, and the spinner with the tooltip that names the running task
const footer = () => screen.getByText(/^(Mangas: |Updating…)/).parentElement;
const footerText = () => footer().textContent;
const footerSpinner = () => footer().querySelector('.animate-spin');
const footerSpinnerTitle = () => footer().querySelector('[title]').getAttribute('title');
const toastOf = text => screen.getByText(text).closest('.pointer-events-auto');
// the cards of the connector dialog, found by the label in their tooltip
const cardOf = label => within(screen.getByRole('listbox', { name: 'Connectors' })).getAllByRole('option')
    .find(card => card.getAttribute('title').includes(`Label: ${label}\n`));
// no layout and no style sheet: the check of `pointer-events` has nothing to find, and the pauses between the keys only slow the tests
const typist = () => userEvent.setup({ delay: null, pointerEventsCheck: 0 });
const tick = ms => act(() => {
    vi.advanceTimersByTime(ms);
});

async function pickConnector(user, label) {
    await user.click(websiteField());
    await user.click(cardOf(label));
}

beforeEach(() => {
    expectConsoleErrors = false;
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // the sampling of an update runs on an interval and counts seconds: the tests move that clock, and nothing else
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
    site = createUpdatableConnector({ id: 'site', label: 'Site' });
    ['Akira', 'Berserk', 'Vagabond'].forEach(title => addManga(site, { title }));
    other = createUpdatableConnector({ id: 'other', label: 'Other Site' });
    ['Monster', 'Naruto'].forEach(title => addManga(other, { title }));
    engine = installEngine({ connectors: [site, other] });
});

// React reports act() problems, duplicate keys and failed effects through console.error: none may pass unnoticed. The assertion is
// soft, so that a failure does not keep the hooks of the setup file and of the renderer from cleaning up
afterEach(() => {
    const noise = consoleError.mock.calls.map(call => call.map(String).join(' '));
    consoleError.mockRestore();
    if (!expectConsoleErrors) {
        expect.soft(noise).toEqual([]);
    }
});

describe('the connectors', () => {
    it('should say that the connectors are loading, count them while they register, and not offer a refresh', () => {
        engine = installEngine({ connectors: [site], ready: false });
        mount();
        expect(websiteField().value).toBe('Loading connectors … (1)');
        expect(screen.getByRole('button', { name: '' }).disabled).toBe(true);
        expect(footerSpinnerTitle()).toBe('Loading connectors (1)');
        act(() => {
            engine.ConnectorRegistry.list.push(other);
            engine.ConnectorRegistry.emit('registered');
        });
        expect(websiteField().value).toBe('Loading connectors … (2)');
        expect(footerSpinnerTitle()).toBe('Loading connectors (2)');
        expect(rows()).toEqual([]);
    });

    it('should not load a list before the connectors are ready, and then show the list of the connector that ends up first', async () => {
        // the registry keeps its list sorted: a connector that registers late can be the first one
        const aardvark = createConnector({ id: 'aardvark', label: 'Aardvark Scans' });
        addManga(aardvark, { title: 'Zebra' });
        engine = installEngine({ connectors: [site], ready: false });
        mount();
        act(() => {
            engine.ConnectorRegistry.list.push(aardvark);
            engine.ConnectorRegistry.list.sort((a, b) => (a.label < b.label ? -1 : 1));
            engine.ConnectorRegistry.emit('registered');
        });
        expect(rows()).toEqual([]);
        expect(site.getMangas).not.toHaveBeenCalled();
        expect(aardvark.getMangas).not.toHaveBeenCalled();
        expect(selection.connectorId).toBe('');
        act(() => {
            engine.ConnectorRegistry.isReady = true;
            engine.ConnectorRegistry.emit('ready');
        });
        expect(await screen.findByText('Zebra')).toBeTruthy();
        expect(websiteField().value).toBe('Aardvark Scans');
        expect(aardvark.getMangas).toHaveBeenCalledTimes(1);
        expect(site.getMangas).not.toHaveBeenCalled();
        expect(footerSpinner()).toBeNull();
    });

    it('should show the default connector in the selection once it is known, because the chapter list and the reader read it there', async () => {
        await mountLoaded();
        expect(selection.connectorId).toBe('site');
        expect(selection.manga).toBeNull();
    });

    it('should keep the connector that was chosen, and not put the default one over it', async () => {
        const user = typist();
        await mountLoaded();
        await pickConnector(user, 'Other Site');
        expect(selection.connectorId).toBe('other');
        await screen.findByText('Monster');
        expect(selection.connectorId).toBe('other');
    });

    it('should show an empty field, and select and list nothing, when there is no connector at all', () => {
        engine = installEngine({ connectors: [] });
        mount();
        expect(websiteField().value).toBe('');
        expect(screen.getByRole('button', { name: '' }).disabled).toBe(true);
        expect(selection.connectorId).toBe('');
        expect(rows()).toEqual([]);
        expect(screen.queryByText(/Manga list is loading or empty/)).toBeNull();
        expect(footerText()).toBe('Mangas: 0 / 0');
    });

    it('should not spin when there is no connector to load a list for', () => {
        engine = installEngine({ connectors: [] });
        mount();
        expect(footerSpinner()).toBeNull();
    });
});

describe('listening to the engine', () => {
    it('should leave no listener on the engine behind when the panel is gone', async () => {
        const live = trackListeners([engine.BookmarkManager, engine.ConnectorRegistry]);
        const { unmount } = await mountLoaded();
        expect(live.length).toBeGreaterThan(0);
        unmount();
        expect(live).toEqual([]);
    });

    it('should not pile up listeners each time the bookmarks are shown again, and leave none behind when it is gone', async () => {
        const user = typist();
        engine = installEngine({ connectors: [createBookmarksConnector(), site, other] });
        const live = trackListeners([engine.BookmarkManager, engine.ConnectorRegistry]);
        const { unmount } = mount();
        await waitFor(() => expect(footerSpinner()).toBeNull());
        const whileBookmarks = live.length;
        await pickConnector(user, 'Site');
        await screen.findByText('Akira');
        await pickConnector(user, ' 【Bookmarks】');
        await waitFor(() => expect(footerText()).toBe('Mangas: 0 / 0'));
        await pickConnector(user, 'Site');
        await screen.findByText('Akira');
        await pickConnector(user, ' 【Bookmarks】');
        expect(live).toHaveLength(whileBookmarks);
        unmount();
        expect(live).toEqual([]);
    });
});

describe('the manga list', () => {
    it('should list the mangas of the first connector, with the website in the tooltip of each', async () => {
        await mountLoaded();
        expect(websiteField().value).toBe('Site');
        expect(rows()).toEqual(['Akira', 'Berserk', 'Vagabond']);
        expect(screen.getByText('Berserk').getAttribute('title')).toBe('Berserk\nSite');
        expect(site.getMangas).toHaveBeenCalledTimes(1);
        expect(other.getMangas).not.toHaveBeenCalled();
        expect(selectedRows()).toEqual([]);
    });

    it('should select the manga that is clicked, and only that one', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(screen.getByText('Berserk'));
        expect(selection.manga).toBe(site.mangas[1]);
        expect(selectedRows()).toEqual(['Berserk']);
        await user.click(screen.getByText('Vagabond'));
        expect(selection.manga).toBe(site.mangas[2]);
        expect(selectedRows()).toEqual(['Vagabond']);
        await user.click(screen.getByText('Vagabond'));
        expect(selection.manga).toBe(site.mangas[2]);
        expect(selectedRows()).toEqual(['Vagabond']);
    });

    it('should not carry the selected manga over to another connector, whose mangas may have the same ids', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(screen.getByText('Berserk'));
        expect(site.mangas[1].id).toBe(other.mangas[1].id);
        await pickConnector(user, 'Other Site');
        await screen.findByText('Naruto');
        expect(selection.manga).toBeNull();
        expect(selectedRows()).toEqual([]);
        expect(starButton().title).toBe(STAR_NOTHING_SELECTED);
    });

    it('should keep the list of a connector, and not read it again, when the user comes back to it', async () => {
        const user = typist();
        await mountLoaded();
        await pickConnector(user, 'Other Site');
        await screen.findByText('Monster');
        await pickConnector(user, 'Site');
        expect(await screen.findByText('Akira')).toBeTruthy();
        expect(rows()).toEqual(['Akira', 'Berserk', 'Vagabond']);
        expect(site.getMangas).toHaveBeenCalledTimes(1);
        expect(other.getMangas).toHaveBeenCalledTimes(1);
    });

    describe('with many mangas', () => {
        let big = null;

        beforeEach(() => {
            big = createConnector({ id: 'big', label: 'Big Site' });
            for (let number = 1; number <= 500; number++) {
                addManga(big, { title: `Title ${String(number).padStart(3, '0')}` });
            }
            engine = installEngine({ connectors: [big] });
        });

        it('should draw only the rows that fit in the list, and count all of the mangas', async () => {
            setLayout({ width: 900, height: 220 });
            await mountLoaded('Title 001');
            expect(rows().length).toBeGreaterThan(10);
            expect(rows().length).toBeLessThan(100);
            expect(rows()[0]).toBe('Title 001');
            expect(footerText()).toBe('Mangas: 500 / 500');
        });

        it('should draw more rows when the list is taller', async () => {
            setLayout({ width: 900, height: 220 });
            const { unmount } = await mountLoaded('Title 001');
            const small = rows().length;
            unmount();
            setLayout({ width: 900, height: 2200 });
            await mountLoaded('Title 001');
            expect(rows().length).toBeGreaterThan(small);
            expect(rows().length).toBeLessThan(500);
        });

        it('should draw the rows that the list is scrolled to, and let go of those it left behind', async () => {
            setLayout({ width: 900, height: 220 });
            await mountLoaded('Title 001');
            const list = screen.getByRole('listbox', { name: 'Manga list' });
            expect(screen.queryByText('Title 500')).toBeNull();
            // the end of what the list holds: its content is as high as all of the rows together
            list.scrollTop = parseInt(list.lastElementChild.style.height, 10);
            fireEvent.scroll(list);
            expect(await screen.findByText('Title 500')).toBeTruthy();
            expect(screen.queryByText('Title 001')).toBeNull();
            expect(rows().length).toBeLessThan(100);
        });

        it('should select a manga in the middle of the list that was scrolled to', async () => {
            const user = typist();
            setLayout({ width: 900, height: 220 });
            await mountLoaded('Title 001');
            const list = screen.getByRole('listbox', { name: 'Manga list' });
            list.scrollTop = parseInt(list.lastElementChild.style.height, 10) / 2;
            fireEvent.scroll(list);
            await user.click(await screen.findByText('Title 250'));
            expect(selection.manga).toBe(big.mangas[249]);
            expect(selectedRows()).toEqual(['Title 250']);
        });
    });

    describe('when it is empty', () => {
        it.each([
            ['show', 'a website', 'site', true],
            ['show', 'the clipboard', 'clipboard', true],
            ['not show', 'the bookmarks', 'bookmarks', false]
        ])('should %s the hint of an empty list for %s', async (_verb, _subject, id, hinted) => {
            const empty = createConnector({ id, label: `Empty ${id}` });
            engine = installEngine({ connectors: [empty] });
            mount();
            await waitFor(() => expect(footerSpinner()).toBeNull());
            expect(!!screen.queryByText(/Manga list is loading or empty/)).toBe(hinted);
        });

        it('should show the hint while the list is loading, and take it away with the list', async () => {
            let answer = null;
            site.getMangas = vi.fn(callback => {
                answer = callback;
            });
            mount();
            expect(screen.getByText(/Manga list is loading or empty/)).toBeTruthy();
            expect(footerSpinnerTitle()).toBe('Loading manga list (Site)');
            await act(async () => {
                answer(null, site.mangas);
            });
            expect(await screen.findByText('Akira')).toBeTruthy();
            expect(screen.queryByText(/Manga list is loading or empty/)).toBeNull();
            expect(footerSpinner()).toBeNull();
        });

        it('should keep the hint, and show no spinner, when the list cannot be loaded', async () => {
            site.getMangas = vi.fn(callback => callback(new Error('the list is corrupt')));
            mount();
            await waitFor(() => expect(footerSpinner()).toBeNull());
            expect(footerText()).toBe('Mangas: 0 / 0');
            expect(screen.getByText(/Manga list is loading or empty/)).toBeTruthy();
            expect(rows()).toEqual([]);
        });

        it('should keep the hint when the engine answers without a list', async () => {
            site.getMangas = vi.fn(callback => callback(null, undefined));
            mount();
            await waitFor(() => expect(footerSpinner()).toBeNull());
            expect(footerText()).toBe('Mangas: 0 / 0');
            expect(screen.getByText(/Manga list is loading or empty/)).toBeTruthy();
        });

        it('should offer a refresh button in the hint that updates the list like the one above the list', async () => {
            const user = typist();
            const empty = createUpdatableConnector({ id: 'empty', label: 'Empty Site' });
            engine = installEngine({ connectors: [empty] });
            mount();
            await screen.findByText(/Manga list is loading or empty/);
            const buttons = screen.getAllByTitle('Synchronize local manga list with online list from <Empty Site>');
            expect(buttons).toHaveLength(2);
            await user.click(buttons[1]);
            expect(empty.updateMangas).toHaveBeenCalledTimes(1);
            expect(spins(buttons[0])).toBe(true);
            expect(spins(buttons[1])).toBe(true);
        });

        it('should not show the hint when the list has mangas, also when the filter hides all of them', async () => {
            const user = typist();
            await mountLoaded();
            expect(screen.queryByText(/Manga list is loading or empty/)).toBeNull();
            await user.type(filterField(), 'nothing like it');
            expect(rows()).toEqual([]);
            expect(footerText()).toBe('Mangas: 0 / 3');
            expect(screen.queryByText(/Manga list is loading or empty/)).toBeNull();
        });
    });
});

describe('the title filter', () => {
    const titles = [
        'Akira', 'Berserk', 'Berserker', 'Bleach', '20th Century Boys', 'École',
        '東京喰種', '東京ラブ', '進撃の巨人',
        'Re:Zero', 'Re:Monster', 'One Piece (2)', 'x.y', 'xzy'
    ];

    beforeEach(() => {
        const library = createConnector({ id: 'library', label: 'Library' });
        titles.forEach(title => addManga(library, { title }));
        engine = installEngine({ connectors: [library] });
    });

    it.each([
        // latin characters and digits: a pattern needs three of them
        ['ber', ['Berserk', 'Berserker']],
        ['BER', ['Berserk', 'Berserker']],
        ['be', titles],
        ['b', titles],
        ['20', titles],
        ['20t', ['20th Century Boys']],
        // everything else needs two
        ['東京', ['東京喰種', '東京ラブ']],
        ['東', titles],
        ['re:', ['Re:Zero', 'Re:Monster']],
        [':z', ['Re:Zero']],
        ['écol', ['École']],
        ['ÉCOL', ['École']],
        // the pattern is text, not a regular expression
        ['(2)', ['One Piece (2)']],
        ['x.y', ['x.y']],
        ['.*', []],
        ['no such manga', []]
    ])('should show the mangas for the pattern "%s"', async (pattern, expected) => {
        const user = typist();
        mount();
        await screen.findByText('Akira');
        await user.type(filterField(), pattern);
        expect(rows()).toEqual(expected);
        expect(footerText()).toBe(`Mangas: ${expected.length} / ${titles.length}`);
    });

    it('should start to filter with the third latin character, and stop when the pattern is shortened again', async () => {
        const user = typist();
        mount();
        await screen.findByText('Akira');
        await user.type(filterField(), 'ber');
        expect(rows()).toEqual(['Berserk', 'Berserker']);
        await user.type(filterField(), '{Backspace}');
        expect(rows()).toEqual(titles);
        await user.clear(filterField());
        expect(rows()).toEqual(titles);
        expect(footerText()).toBe(`Mangas: ${titles.length} / ${titles.length}`);
    });

    it('should also match the website of a manga, which tells the mangas of a mixed list apart', async () => {
        const user = typist();
        const alpha = createConnector({ id: 'alpha', label: 'Alpha Scans' });
        const beta = createConnector({ id: 'beta', label: 'Beta Comics' });
        const bookmarks = createBookmarksConnector();
        engine = installEngine({ connectors: [bookmarks, alpha, beta] });
        engine.BookmarkManager.addBookmark(addManga(alpha, { id: 'alpha-1', title: 'Akira' }));
        engine.BookmarkManager.addBookmark(addManga(alpha, { id: 'alpha-2', title: 'Berserk' }));
        engine.BookmarkManager.addBookmark(addManga(beta, { id: 'beta-1', title: 'Monster' }));
        mount();
        await screen.findByText('Monster');
        await user.type(filterField(), 'scans');
        expect(rows()).toEqual(['Akira', 'Berserk']);
        await user.clear(filterField());
        await user.type(filterField(), 'comics');
        expect(rows()).toEqual(['Monster']);
        // the title and the website are alternatives
        await user.clear(filterField());
        await user.type(filterField(), 'monster');
        expect(rows()).toEqual(['Monster']);
        expect(footerText()).toBe('Mangas: 1 / 3');
    });

    // NOTE: a characterisation, unsure whether the text is meant to survive a change of connector (it lets a title be looked for
    // on one website after the other)
    it('should keep the pattern when another connector is chosen, and apply it to that list', async () => {
        const user = typist();
        engine = installEngine({ connectors: [site, other] });
        mount();
        await screen.findByText('Akira');
        await user.type(filterField(), 'mon');
        expect(rows()).toEqual([]);
        await pickConnector(user, 'Other Site');
        await screen.findByText('Monster');
        expect(filterField().value).toBe('mon');
        expect(rows()).toEqual(['Monster']);
        expect(footerText()).toBe('Mangas: 1 / 2');
    });

    it('should keep the selected manga when the filter hides it', async () => {
        const user = typist();
        engine = installEngine({ connectors: [site, other] });
        mount();
        await user.click(await screen.findByText('Berserk'));
        await user.type(filterField(), 'vag');
        expect(rows()).toEqual(['Vagabond']);
        expect(selection.manga).toBe(site.mangas[1]);
        expect(starButton().title).toBe(STAR_ADD);
    });
});

describe('the status line', () => {
    it('should count the mangas that are shown and all of them', async () => {
        await mountLoaded();
        expect(footerText()).toBe('Mangas: 3 / 3');
        expect(footerSpinner()).toBeNull();
    });

    it('should show a spinner that names the website while its list is loading', async () => {
        let answer = null;
        site.getMangas = vi.fn(callback => {
            answer = callback;
        });
        mount();
        expect(footerText()).toBe('Mangas: 0 / 0');
        expect(footerSpinnerTitle()).toBe('Loading manga list (Site)');
        await act(async () => {
            answer(null, site.mangas);
        });
        expect(await screen.findByText('Mangas: 3 / 3')).toBeTruthy();
        expect(footerSpinner()).toBeNull();
    });

    it('should keep the spinner while the connectors are loading, also when a list is there', async () => {
        const user = typist();
        engine = installEngine({ connectors: [site, other], ready: false });
        mount();
        // a connector that was chosen before the end of the loading shows its list at once
        await user.click(websiteField());
        await user.click(cardOf('Other Site'));
        await screen.findByText('Monster');
        expect(footerSpinnerTitle()).toBe('Loading connectors (2)');
        act(() => {
            engine.ConnectorRegistry.isReady = true;
            engine.ConnectorRegistry.emit('ready');
        });
        expect(footerSpinner()).toBeNull();
    });
});

describe('the refresh button', () => {
    it('should update the list of the connector, show what the update brings and tell how many titles that are', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(refreshButton());
        expect(site.updateMangas).toHaveBeenCalledTimes(1);
        expect(other.updateMangas).not.toHaveBeenCalled();
        // while it runs: the button spins, a bar is shown, the status line says what is going on
        expect(spins(refreshButton())).toBe(true);
        expect(screen.getByRole('progressbar', { name: 'Updating manga list' }).getAttribute('aria-valuetext')).toBe('Updating');
        expect(footerText()).toBe('Updating…');
        expect(footerSpinnerTitle()).toBe('Updating manga list (Site): waiting for the website');
        const fresh = makeMangas(site, ['Berserk', 'Claymore', 'Dorohedoro', 'Eden']);
        await act(async () => {
            site.finishUpdate(fresh);
        });
        expect(await screen.findByText('Manga list updated (4 titles).')).toBeTruthy();
        expect(toastOf('Manga list updated (4 titles).').className).toMatch(/green/);
        expect(rows()).toEqual(['Berserk', 'Claymore', 'Dorohedoro', 'Eden']);
        expect(footerText()).toBe('Mangas: 4 / 4');
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(spins(refreshButton())).toBe(false);
        // the cache of the connector holds the new list: it is not read from the disk again
        expect(queryClient.getQueryData(['mangas', 'site']).map(manga => manga.title)).toEqual(['Berserk', 'Claymore', 'Dorohedoro', 'Eden']);
        expect(site.getMangas).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['with the reason of the engine', new Error('HTTP 503'), 'Failed to update manga list for Site\nHTTP 503'],
        [
            'without a reason, as the engine does when the website had no mangas',
            undefined,
            'Failed to update manga list for Site\nFailed to update manga list for "Site"!'
        ]
    ])('should tell that the update failed, %s, and leave the list as it was', async (_name, error, message) => {
        const user = typist();
        await mountLoaded();
        await user.click(refreshButton());
        await act(async () => {
            site.failUpdate(error);
        });
        const toast = await screen.findByText(/^Failed to update manga list for Site/);
        expect(toast.textContent).toBe(message);
        expect(toastOf(/^Failed to update manga list for Site/).className).toMatch(/red/);
        expect(rows()).toEqual(['Akira', 'Berserk', 'Vagabond']);
        expect(footerText()).toBe('Mangas: 3 / 3');
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(spins(refreshButton())).toBe(false);
    });

    it('should be ready for another update after one failed', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(refreshButton());
        await act(async () => {
            site.failUpdate(new Error('HTTP 503'));
        });
        await screen.findByText(/^Failed to update manga list for Site/);
        await user.click(refreshButton());
        expect(site.updateMangas).toHaveBeenCalledTimes(2);
        await act(async () => {
            site.finishUpdate(makeMangas(site, ['Akira', 'Claymore']));
        });
        expect(await screen.findByText('Manga list updated (2 titles).')).toBeTruthy();
        expect(rows()).toEqual(['Akira', 'Claymore']);
    });

    it('should run one update at a time: a second click while it runs asks the engine for nothing', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(refreshButton());
        await user.click(refreshButton());
        await user.click(refreshButton());
        expect(site.updateMangas).toHaveBeenCalledTimes(1);
        await act(async () => {
            site.finishUpdate(makeMangas(site, ['Akira', 'Berserk']));
        });
        await screen.findByText('Manga list updated (2 titles).');
        await user.click(refreshButton());
        expect(site.updateMangas).toHaveBeenCalledTimes(2);
    });

    it('should file the new list under the connector that was updated, also when another one is shown by then', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(refreshButton());
        await pickConnector(user, 'Other Site');
        await screen.findByText('Monster');
        await act(async () => {
            site.finishUpdate(makeMangas(site, ['Claymore', 'Dorohedoro']));
        });
        expect(await screen.findByText('Manga list updated (2 titles).')).toBeTruthy();
        expect(rows()).toEqual(['Monster', 'Naruto']);
        expect(queryClient.getQueryData(['mangas', 'site']).map(manga => manga.title)).toEqual(['Claymore', 'Dorohedoro']);
        expect(queryClient.getQueryData(['mangas', 'other']).map(manga => manga.title)).toEqual(['Monster', 'Naruto']);
        await pickConnector(user, 'Site');
        expect(await screen.findByText('Claymore')).toBeTruthy();
        expect(rows()).toEqual(['Claymore', 'Dorohedoro']);
    });

    it('should not show another connector as updating while only the one that was refreshed runs an update', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(refreshButton());
        await pickConnector(user, 'Other Site');
        await screen.findByText('Monster');
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(spins(refreshButton())).toBe(false);
        expect(footerText()).toBe('Mangas: 2 / 2');
    });

    describe('when an update was started elsewhere', () => {
        it.each([
            [0, 5, '0:05'],
            [1, 5, '1 request · 0:05'],
            [12, 65, '12 requests · 1:05']
        ])('should show its progress, %i requests after %i seconds', async (requests, seconds, text) => {
            site.updateProgress = { requests, startedAt: Date.now() - seconds * 1000 };
            await mountLoaded();
            expect(footerText()).toBe(`Updating… ${text}`);
            expect(footerSpinnerTitle()).toBe(`Updating manga list (Site): ${text}`);
            expect(screen.getByRole('progressbar', { name: 'Updating manga list' }).getAttribute('aria-valuetext')).toBe(text);
            expect(spins(refreshButton())).toBe(true);
            // the list is there all the same
            expect(rows()).toEqual(['Akira', 'Berserk', 'Vagabond']);
        });

        it('should follow the update twice a second, and show the end of it', async () => {
            await mountLoaded();
            expect(footerText()).toBe('Mangas: 3 / 3');
            // another part of the application (the connector dialog) starts the update
            site.updateProgress = { requests: 0, startedAt: Date.now() };
            tick(500);
            expect(footerText()).toBe('Updating… 0:00');
            site.updateProgress.requests = 3;
            tick(500);
            expect(footerText()).toBe('Updating… 3 requests · 0:01');
            site.updateProgress.requests = 9;
            tick(2000);
            expect(footerText()).toBe('Updating… 9 requests · 0:03');
            expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('9 requests · 0:03');
            // and it is over
            site.updateProgress = undefined;
            tick(500);
            expect(footerText()).toBe('Mangas: 3 / 3');
            expect(footerSpinner()).toBeNull();
            expect(screen.queryByRole('progressbar')).toBeNull();
            expect(spins(refreshButton())).toBe(false);
        });

        it('should show the progress of the connector that is shown, and none for the others', async () => {
            const user = typist();
            other.updateProgress = { requests: 4, startedAt: Date.now() };
            await mountLoaded();
            expect(footerText()).toBe('Mangas: 3 / 3');
            await pickConnector(user, 'Other Site');
            await screen.findByText('Monster');
            expect(footerText()).toBe('Updating… 4 requests · 0:00');
            await pickConnector(user, 'Site');
            await screen.findByText('Akira');
            expect(footerText()).toBe('Mangas: 3 / 3');
        });

        it('should stop sampling the engine when the panel is gone', async () => {
            const { unmount } = await mountLoaded();
            const timers = vi.getTimerCount();
            expect(timers).toBeGreaterThan(0);
            unmount();
            expect(vi.getTimerCount()).toBe(0);
        });

        it('should show the update of a card of the connector dialog, and the list that it brings, after the dialog is closed', async () => {
            const user = typist();
            await mountLoaded();
            await user.click(websiteField());
            await user.click(within(cardOf('Site')).getByTitle('Synchronize local manga list with online list from <Site>'));
            expect(site.updateMangas).toHaveBeenCalledTimes(1);
            await user.keyboard('{Escape}');
            expect(screen.queryByRole('listbox', { name: 'Connectors' })).toBeNull();
            // the card did not select its connector: it was the one that was shown already, and the selection stays
            expect(selection.connectorId).toBe('site');
            tick(500);
            expect(footerText()).toBe('Updating… 0:00');
            await act(async () => {
                site.finishUpdate(makeMangas(site, ['Claymore', 'Dorohedoro']));
            });
            tick(500);
            expect(await screen.findByText('Claymore')).toBeTruthy();
            expect(rows()).toEqual(['Claymore', 'Dorohedoro']);
            expect(footerText()).toBe('Mangas: 2 / 2');
            expect(screen.getByText('Updated Site (2 titles).')).toBeTruthy();
        });

        it('should be idle again when the update that was started elsewhere ends, also after the button was clicked meanwhile', async () => {
            site.updateProgress = { requests: 4, startedAt: Date.now() };
            await mountLoaded();
            fireEvent.click(refreshButton());
            site.updateProgress = undefined;
            tick(500);
            expect(screen.queryByRole('progressbar')).toBeNull();
            expect(footerText()).toBe('Mangas: 3 / 3');
        });
    });
});

describe('the paste button', () => {
    it('should switch to the clipboard connector, read the clipboard and show the mangas of the links in it', async () => {
        const user = typist();
        const pasted = makeMangas(site, ['Berserk', 'Pasted Manga']);
        const clipboard = createClipboardConnector(pasted);
        engine = installEngine({ connectors: [site, other, clipboard] });
        await mountLoaded();
        await user.click(screen.getByText('Akira'));
        expect(selection.manga).toBe(site.mangas[0]);
        await user.click(pasteButton());
        expect(clipboard.updateMangas).toHaveBeenCalledTimes(1);
        expect(selection.connectorId).toBe('clipboard');
        expect(selection.manga).toBeNull();
        expect(websiteField().value).toBe(' 【Clipboard】');
        expect(await screen.findByText('Pasted Manga')).toBeTruthy();
        expect(rows()).toEqual(['Berserk', 'Pasted Manga']);
        expect(screen.getByText('Manga list updated (2 titles).')).toBeTruthy();
        expect(footerText()).toBe('Mangas: 2 / 2');
        // what was read is filed under the clipboard, and the list of the website that was shown before is not touched
        expect(queryClient.getQueryData(['mangas', 'clipboard']).map(manga => manga.title)).toEqual(['Berserk', 'Pasted Manga']);
        expect(queryClient.getQueryData(['mangas', 'site']).map(manga => manga.title)).toEqual(['Akira', 'Berserk', 'Vagabond']);
    });

    it('should show the hint of an empty list when the clipboard holds no link that a website knows', async () => {
        const user = typist();
        const clipboard = createClipboardConnector([]);
        engine = installEngine({ connectors: [site, clipboard] });
        await mountLoaded();
        await user.click(pasteButton());
        expect(await screen.findByText('Manga list updated (0 titles).')).toBeTruthy();
        expect(screen.getByText(/Manga list is loading or empty/)).toBeTruthy();
        expect(websiteField().value).toBe(' 【Clipboard】');
    });

    it('should do nothing when there is no clipboard connector', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(screen.getByText('Berserk'));
        await user.click(pasteButton());
        expect(websiteField().value).toBe('Site');
        expect(selection.connectorId).toBe('site');
        expect(selection.manga).toBe(site.mangas[1]);
        expect(site.updateMangas).not.toHaveBeenCalled();
        expect(other.updateMangas).not.toHaveBeenCalled();
        expect(screen.queryByText(/Manga list updated/)).toBeNull();
        expect(rows()).toEqual(['Akira', 'Berserk', 'Vagabond']);
    });

    it('should report a clipboard that cannot be read like any other failed update', async () => {
        const user = typist();
        const clipboard = createClipboardConnector([]);
        clipboard.updateMangas = vi.fn(callback => callback(new Error('clipboard is locked')));
        engine = installEngine({ connectors: [site, clipboard] });
        await mountLoaded();
        await user.click(pasteButton());
        const toast = await screen.findByText(/^Failed to update manga list for/);
        expect(toast.textContent).toBe('Failed to update manga list for  【Clipboard】\nclipboard is locked');
        expect(websiteField().value).toBe(' 【Clipboard】');
        expect(footerText()).toBe('Mangas: 0 / 0');
    });

    // the update of a website is the business of that website: the clipboard is read all the same
    it('should switch to the clipboard and read it while the update of another connector is running', async () => {
        const user = typist();
        const clipboard = createClipboardConnector(makeMangas(site, ['Pasted Manga']));
        engine = installEngine({ connectors: [site, clipboard] });
        await mountLoaded();
        await user.click(refreshButton());
        await user.click(pasteButton());
        expect(websiteField().value).toBe(' 【Clipboard】');
        expect(clipboard.updateMangas).toHaveBeenCalledTimes(1);
        expect(await screen.findByText('Pasted Manga')).toBeTruthy();
    });
});

describe('the bookmark star', () => {
    it('should ask for a manga while none is selected, and do nothing when it is clicked', async () => {
        const user = typist();
        await mountLoaded();
        expect(starButton().title).toBe(STAR_NOTHING_SELECTED);
        await user.click(starButton());
        expect(engine.BookmarkManager.addBookmark).not.toHaveBeenCalled();
        expect(engine.BookmarkManager.deleteBookmark).not.toHaveBeenCalled();
        expect(screen.queryByText(/Bookmark failed/)).toBeNull();
    });

    it('should add the selected manga to the bookmarks, and remove it when it is clicked again', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(screen.getByText('Berserk'));
        expect(starButton().title).toBe(STAR_ADD);
        await user.click(starButton());
        expect(engine.BookmarkManager.addBookmark).toHaveBeenCalledExactlyOnceWith(site.mangas[1]);
        expect(engine.BookmarkManager.bookmarks.map(bookmark => bookmark.key)).toEqual([{ connector: 'site', manga: 'm2' }]);
        expect(starButton().title).toBe(STAR_REMOVE);
        await user.click(starButton());
        expect(engine.BookmarkManager.deleteBookmark).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ key: { connector: 'site', manga: 'm2' } })
        );
        expect(engine.BookmarkManager.bookmarks).toEqual([]);
        expect(starButton().title).toBe(STAR_ADD);
    });

    it('should show for each manga that is selected whether it is bookmarked', async () => {
        const user = typist();
        engine.BookmarkManager.addBookmark(site.mangas[2]);
        await mountLoaded();
        await user.click(screen.getByText('Vagabond'));
        expect(starButton().title).toBe(STAR_REMOVE);
        await user.click(screen.getByText('Akira'));
        expect(starButton().title).toBe(STAR_ADD);
    });

    it('should not take a bookmark of another website with the same manga id for the selected manga', async () => {
        const user = typist();
        engine.BookmarkManager.addBookmark(other.mangas[1]);
        await mountLoaded();
        await user.click(screen.getByText('Berserk'));
        expect(site.mangas[1].id).toBe(other.mangas[1].id);
        expect(starButton().title).toBe(STAR_ADD);
    });

    it('should follow a bookmark that the engine adds or removes while the panel is open', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(screen.getByText('Berserk'));
        expect(starButton().title).toBe(STAR_ADD);
        act(() => {
            engine.BookmarkManager.addBookmark(site.mangas[1]);
        });
        expect(starButton().title).toBe(STAR_REMOVE);
        act(() => {
            engine.BookmarkManager.deleteBookmark(engine.BookmarkManager.bookmarks[0]);
        });
        expect(starButton().title).toBe(STAR_ADD);
    });

    it('should follow a bookmark list that is replaced as a whole, as loading the bookmarks does', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(screen.getByText('Berserk'));
        act(() => {
            engine.BookmarkManager.bookmarks = [{ key: { connector: 'site', manga: 'm2' }, title: { connector: 'Site', manga: 'Berserk' } }];
            engine.BookmarkManager.emit('changed', engine.BookmarkManager.bookmarks);
        });
        expect(starButton().title).toBe(STAR_REMOVE);
        act(() => {
            engine.BookmarkManager.bookmarks = [];
            engine.BookmarkManager.emit('changed', engine.BookmarkManager.bookmarks);
        });
        expect(starButton().title).toBe(STAR_ADD);
    });

    it('should tell why a bookmark could not be added, and stay usable', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(screen.getByText('Berserk'));
        engine.BookmarkManager.addBookmark.mockImplementationOnce(() => {
            throw new Error('disk full');
        });
        await user.click(starButton());
        expect(toastOf('Bookmark failed: disk full').className).toMatch(/red/);
        expect(starButton().title).toBe(STAR_ADD);
        expect(engine.BookmarkManager.bookmarks).toEqual([]);
        await user.click(starButton());
        expect(starButton().title).toBe(STAR_REMOVE);
    });

    it('should tell why a bookmark could not be removed', async () => {
        const user = typist();
        engine.BookmarkManager.addBookmark(site.mangas[1]);
        await mountLoaded();
        await user.click(screen.getByText('Berserk'));
        engine.BookmarkManager.deleteBookmark.mockImplementationOnce(() => {
            throw new Error('file is locked');
        });
        await user.click(starButton());
        expect(toastOf('Bookmark failed: file is locked').className).toMatch(/red/);
        expect(starButton().title).toBe(STAR_REMOVE);
    });

    it('should work for a manga that was selected elsewhere, such as the reader does for a link', async () => {
        const user = typist();
        const abroad = createManga(other, 'x1', 'Abroad');
        await mountLoaded();
        act(() => {
            selection.selectManga(abroad);
        });
        expect(selectedRows()).toEqual([]);
        expect(starButton().title).toBe(STAR_ADD);
        await user.click(starButton());
        expect(engine.BookmarkManager.addBookmark).toHaveBeenCalledExactlyOnceWith(abroad);
        expect(starButton().title).toBe(STAR_REMOVE);
    });
});

describe('the bookmarks connector', () => {
    let bookmarks = null;

    beforeEach(() => {
        bookmarks = createBookmarksConnector();
        engine = installEngine({ connectors: [bookmarks, site, other] });
    });

    it('should be the first list, and show the bookmarks with their websites', async () => {
        engine.BookmarkManager.addBookmark(site.mangas[1]);
        engine.BookmarkManager.addBookmark(other.mangas[0]);
        mount();
        expect(await screen.findByText('Berserk')).toBeTruthy();
        expect(websiteField().value).toBe(' 【Bookmarks】');
        expect(rows()).toEqual(['Berserk', 'Monster']);
        expect(screen.getByText('Monster').getAttribute('title')).toBe('Monster\nOther Site');
        expect(footerText()).toBe('Mangas: 2 / 2');
    });

    it('should not show the hint of an empty list when there are no bookmarks', async () => {
        mount();
        expect(await screen.findByText('Mangas: 0 / 0')).toBeTruthy();
        expect(screen.queryByText(/Manga list is loading or empty/)).toBeNull();
    });

    it('should reload its list when a bookmark is added or removed', async () => {
        engine.BookmarkManager.addBookmark(site.mangas[1]);
        mount();
        await screen.findByText('Berserk');
        act(() => {
            engine.BookmarkManager.addBookmark(other.mangas[0]);
        });
        expect(await screen.findByText('Monster')).toBeTruthy();
        expect(rows()).toEqual(['Berserk', 'Monster']);
        act(() => {
            engine.BookmarkManager.deleteBookmark(engine.BookmarkManager.bookmarks[0]);
        });
        await waitFor(() => expect(rows()).toEqual(['Monster']));
        expect(footerText()).toBe('Mangas: 1 / 1');
    });

    it('should reload its list when the bookmarks are replaced as a whole', async () => {
        mount();
        await screen.findByText('Mangas: 0 / 0');
        act(() => {
            engine.BookmarkManager.bookmarks = [{ key: { connector: 'other', manga: 'm2' }, title: { connector: 'Other Site', manga: 'Naruto' } }];
            engine.BookmarkManager.emit('changed', engine.BookmarkManager.bookmarks);
        });
        expect(await screen.findByText('Naruto')).toBeTruthy();
    });

    it('should update its list with the refresh button, from the bookmarks', async () => {
        const user = typist();
        engine.BookmarkManager.addBookmark(site.mangas[1]);
        mount();
        await screen.findByText('Berserk');
        engine.BookmarkManager.bookmarks.push({ key: { connector: 'other', manga: 'm1' }, title: { connector: 'Other Site', manga: 'Monster' } });
        await user.click(refreshButton());
        expect(bookmarks.updateMangas).toHaveBeenCalledTimes(1);
        expect(await screen.findByText('Manga list updated (2 titles).')).toBeTruthy();
        expect(rows()).toEqual(['Berserk', 'Monster']);
    });

    it('should show a bookmark of a website that registers late with its website, when the connectors are ready', async () => {
        const late = createConnector({ id: 'late', label: 'Late Site' });
        const lateManga = addManga(late, { title: 'Late Manga' });
        engine = installEngine({ connectors: [bookmarks, site], ready: false });
        engine.BookmarkManager.addBookmark(lateManga);
        mount();
        act(() => {
            selection.selectConnector('bookmarks');
        });
        expect(await screen.findByText('Late Manga')).toBeTruthy();
        // the website is not registered yet: the bookmark has a stand-in for it
        expect(screen.getByText('Late Manga').getAttribute('title')).toBe('Late Manga\nlate (unavailable)');
        act(() => {
            engine.ConnectorRegistry.list.push(late);
            engine.ConnectorRegistry.emit('registered');
        });
        act(() => {
            engine.ConnectorRegistry.isReady = true;
            engine.ConnectorRegistry.emit('ready');
        });
        await waitFor(() => expect(screen.getByText('Late Manga').getAttribute('title')).toBe('Late Manga\nLate Site'));
        expect(rows()).toEqual(['Late Manga']);
    });

    it('should show the bookmarks of late websites with their websites, also when another list was shown at that time', async () => {
        const user = typist();
        const late = createConnector({ id: 'late', label: 'Late Site' });
        const lateManga = addManga(late, { title: 'Late Manga' });
        engine = installEngine({ connectors: [bookmarks, site], ready: false });
        engine.BookmarkManager.addBookmark(lateManga);
        mount();
        act(() => {
            selection.selectConnector('bookmarks');
        });
        await screen.findByText('Late Manga');
        await pickConnector(user, 'Site');
        await screen.findByText('Akira');
        act(() => {
            engine.ConnectorRegistry.list.push(late);
            engine.ConnectorRegistry.isReady = true;
            engine.ConnectorRegistry.emit('ready');
        });
        await pickConnector(user, ' 【Bookmarks】');
        await waitFor(() => expect(screen.getByText('Late Manga').getAttribute('title')).toBe('Late Manga\nLate Site'));
    });

    it('should show a bookmark that was added while the list of another website was shown', async () => {
        const user = typist();
        mount();
        await waitFor(() => expect(footerSpinner()).toBeNull());
        await pickConnector(user, 'Site');
        await screen.findByText('Berserk');
        act(() => {
            engine.BookmarkManager.addBookmark(site.mangas[1]);
        });
        await pickConnector(user, ' 【Bookmarks】');
        expect(await screen.findByText('Berserk', {}, { timeout: 100 })).toBeTruthy();
    });

    it('should select only the bookmark that is clicked when two bookmarks of different websites have the same manga id', async () => {
        expectConsoleErrors = true;
        const user = typist();
        const sameId = '/manga/solo-leveling';
        engine.BookmarkManager.addBookmark(createManga(site, sameId, 'Solo Leveling'));
        engine.BookmarkManager.addBookmark(createManga(other, sameId, 'Solo Leveling'));
        mount();
        await screen.findAllByText('Solo Leveling');
        await user.click(screen.getAllByText('Solo Leveling')[0]);
        expect(selectedRows()).toHaveLength(1);
    });
});

describe('the connector picker', () => {
    it('should not replace what was typed in the name field when the panel renders again meanwhile', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(websiteField());
        await user.keyboard('toon');
        site.updateProgress = { requests: 1, startedAt: Date.now() };
        tick(500);
        await user.keyboard('s');
        expect(screen.getByTitle(/with a name that matches/).value).toBe('toons');
    });

    it('should be closed to begin with', async () => {
        await mountLoaded();
        expect(screen.queryByRole('listbox', { name: 'Connectors' })).toBeNull();
    });

    it('should open with a click on the website field', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(websiteField());
        expect(screen.getByRole('listbox', { name: 'Connectors' })).toBeTruthy();
    });

    it.each([['Enter'], [' ']])('should open with the key "%s" on the website field, which then does not type or scroll', async key => {
        await mountLoaded();
        const notPrevented = fireEvent.keyDown(websiteField(), { key });
        expect(notPrevented).toBe(false);
        expect(screen.getByRole('listbox', { name: 'Connectors' })).toBeTruthy();
    });

    it.each([['a'], ['Tab'], ['Escape'], ['ArrowDown']])('should not open with the key "%s"', async key => {
        await mountLoaded();
        fireEvent.keyDown(websiteField(), { key });
        expect(screen.queryByRole('listbox', { name: 'Connectors' })).toBeNull();
    });

    it('should have the name field ready for typing when it opens, and narrow the websites down with what is typed', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(websiteField());
        const field = screen.getByTitle(/with a name that matches/);
        expect(document.activeElement).toBe(field);
        await user.keyboard('other');
        expect(field.value).toBe('other');
        expect(within(screen.getByRole('listbox', { name: 'Connectors' })).getAllByRole('option')).toHaveLength(1);
        expect(cardOf('Other Site')).toBeTruthy();
    });

    it('should show the connector of the list as the selected card', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(websiteField());
        expect(cardOf('Site').getAttribute('aria-selected')).toBe('true');
        expect(cardOf('Other Site').getAttribute('aria-selected')).toBe('false');
    });

    it('should show the list of the connector that is chosen, and close', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(screen.getByText('Berserk'));
        await user.click(websiteField());
        await user.click(cardOf('Other Site'));
        expect(screen.queryByRole('listbox', { name: 'Connectors' })).toBeNull();
        expect(websiteField().value).toBe('Other Site');
        expect(selection.connectorId).toBe('other');
        expect(selection.manga).toBeNull();
        expect(await screen.findByText('Monster')).toBeTruthy();
        expect(rows()).toEqual(['Monster', 'Naruto']);
        expect(footerText()).toBe('Mangas: 2 / 2');
    });

    it('should close with Escape and with its close button, and leave the connector as it was', async () => {
        const user = typist();
        await mountLoaded();
        await user.click(websiteField());
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('listbox', { name: 'Connectors' })).toBeNull();
        await user.click(websiteField());
        await user.click(screen.getByTitle('Click to cancel the website selection'));
        expect(screen.queryByRole('listbox', { name: 'Connectors' })).toBeNull();
        expect(websiteField().value).toBe('Site');
        expect(selection.connectorId).toBe('site');
        expect(rows()).toEqual(['Akira', 'Berserk', 'Vagabond']);
    });
});

// what is browsed is shown by the Discord presence, which listens for these events on the document
describe('announcing the selection', () => {
    function listenFor(name) {
        const seen = [];
        const stop = new AbortController();
        document.addEventListener(name, event => seen.push(event.detail), { signal: stop.signal });
        return { seen, stop: () => stop.abort() };
    }

    it('should announce the connector that is shown, also the default one, and the manga that is selected', async () => {
        const user = typist();
        const connectors = listenFor('onSelectConnector');
        const mangas = listenFor('onSelectManga');
        try {
            await mountLoaded();
            expect(connectors.seen).toEqual([site]);
            expect(mangas.seen).toEqual([]);
            await user.click(screen.getByText('Berserk'));
            expect(mangas.seen).toEqual([site.mangas[1]]);
            await pickConnector(user, 'Other Site');
            expect(connectors.seen).toEqual([site, other]);
            await user.click(await screen.findByText('Monster'));
            expect(mangas.seen).toEqual([site.mangas[1], other.mangas[0]]);
        } finally {
            connectors.stop();
            mangas.stop();
        }
    });

    it('should announce a connector once, however often the panel is drawn again', async () => {
        const user = typist();
        const connectors = listenFor('onSelectConnector');
        try {
            await mountLoaded();
            await user.type(screen.getByTitle(/Enter a pattern/), 'ber');
            expect(connectors.seen).toEqual([site]);
        } finally {
            connectors.stop();
        }
    });
});
