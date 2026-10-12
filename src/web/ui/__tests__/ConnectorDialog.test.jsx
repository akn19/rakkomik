import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConnectorDialog from '../connectors.jsx';
import { queryClient } from '../queries.js';
import { trackListeners } from './support/engineListeners.js';
import { installEngine } from './support/fakeEngine.js';
import { setLayout } from './support/layout.js';
import { renderWithProviders } from './support/render.jsx';
import { createUpdatableConnector, makeMangas } from './support/updatableConnector.js';

let engine = null;
let connectors = null;
let onSelect = null;
let onClose = null;
let openWindow = null;
let consoleError = null;
let observers = [];

// the system connectors and four websites. The labels and the urls are chosen so that a pattern can match one field only
function createConnectors() {
    return [
        createUpdatableConnector({ id: 'bookmarks', label: ' 【Bookmarks】', url: undefined, tags: [] }),
        createUpdatableConnector({ id: 'clipboard', label: ' 【Clipboard】', url: undefined, tags: [] }),
        createUpdatableConnector({
            id: 'mangadex',
            label: 'MangaDex',
            url: 'https://mangadex.org',
            tags: ['manga', 'multi-lingual'],
            links: { login: 'https://mangadex.org/login', donation: 'https://mangadex.org/donate' }
        }),
        createUpdatableConnector({ id: 'webtoons', label: 'Webtoons', url: 'https://webtoons.com', tags: ['webtoon', 'english'] }),
        createUpdatableConnector({
            id: 'toptoon',
            label: 'TOPTOON (탑툰)',
            url: 'https://toptoon.com',
            tags: ['webtoon', 'korean'],
            links: { login: 'https://toptoon.com/login' }
        }),
        createUpdatableConnector({ id: 'kakaopage', label: '카카오페이지', url: 'https://page.kakao.com', tags: ['webtoon', 'korean', 'novel'] })
    ];
}

// the websites that are listed in the connector dialog, in the order of the registry
const ALL_IDS = ['bookmarks', 'clipboard', 'mangadex', 'webtoons', 'toptoon', 'kakaopage'];

function dialog(props = {}) {
    return <ConnectorDialog open selectedId="" onSelect={onSelect} onClose={onClose} {...props} />;
}

function mountDialog(props = {}) {
    return renderWithProviders(dialog(props), { selection: false });
}

// a ResizeObserver that tells what it observes and lets a test deliver a resize
class RecordingObserver {
    constructor(callback) {
        this.callback = callback;
        this.observed = new Set();
        observers.push(this);
    }

    observe(element) {
        this.observed.add(element);
    }

    unobserve(element) {
        this.observed.delete(element);
    }

    disconnect() {
        this.observed.clear();
    }
}

function resizeTo(width) {
    setLayout({ width, height: 600 });
    act(() => {
        observers.filter(observer => observer.observed.size).forEach(observer => observer.callback([]));
    });
}

// the list and its cards are asked for all the time, and the role queries of the testing library are slow on a DOM of this size
const listbox = () => {
    const list = document.querySelector('[role="list"][aria-label="Connectors"]');
    if (!list) {
        throw new Error('The list of connectors is not on the page');
    }
    return list;
};
const cards = () => [...listbox().querySelectorAll('[role="listitem"]')];
// the button of a card that carries the name of the website: the keyboard selects with it
const nameButtonOf = card => within(card).getByTitle('Show the mangas of this website');
const selectedCardIds = () => cards().filter(card => card.querySelector('[aria-current="true"]')).map(idOf);
const idOf = card => /\nID: (.*)\n/.exec(card.getAttribute('title'))[1];
const cardIds = () => cards().map(idOf);
const cardOf = id => cards().find(card => idOf(card) === id);
// how many cards are in each row of the grid
const cardsPerRow = () => {
    const counts = new Map();
    cards().forEach(card => counts.set(card.parentElement, (counts.get(card.parentElement) || 0) + 1));
    return [...counts.values()];
};
const nameField = () => screen.getByTitle(/with a name that matches/);
const mangaField = () => screen.getByTitle(/with a manga that matches/);
const clearButton = () => screen.getByTitle('Reset all filters');
const counter = () => screen.getByText(/ websites/).textContent;
// the tags in the list of the filter: the buttons of the group under the heading "Tags", the cards show theirs as plain text
const tagButtons = () => within(screen.getByRole('group', { name: 'Tags' })).queryAllByRole('button');
const tagNames = () => tagButtons().map(button => button.textContent);
const tagButton = name => tagButtons().find(button => button.textContent === name);
const refreshOf = id => within(cardOf(id)).getByTitle(/^Synchronize local manga list/);
const spins = button => button.querySelector('svg').classList.contains('animate-spin');
const toastOf = text => screen.getByText(text).closest('.pointer-events-auto');
// no layout and no style sheet: the check of `pointer-events` has nothing to find, and the pauses between the keys only slow the tests
const typist = () => userEvent.setup({ delay: null, pointerEventsCheck: 0 });
const tick = ms => act(() => {
    vi.advanceTimersByTime(ms);
});

beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    openWindow = vi.spyOn(window, 'open').mockImplementation(() => null);
    observers = [];
    // the progress of an update is sampled on an interval and counts seconds: the tests move that clock, and nothing else
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
    onSelect = vi.fn();
    onClose = vi.fn();
    connectors = createConnectors();
    engine = installEngine({ connectors });
});

// React reports act() problems and failed effects through console.error: none may pass unnoticed. The assertion is soft, so
// that a failure does not keep the hooks of the setup file and of the renderer from cleaning up
afterEach(() => {
    const noise = consoleError.mock.calls.map(call => call.map(String).join(' '));
    consoleError.mockRestore();
    openWindow.mockRestore();
    vi.unstubAllGlobals();
    expect.soft(noise).toEqual([]);
});

describe('opening and closing', () => {
    it('should draw nothing while it is closed', () => {
        mountDialog({ open: false });
        expect(screen.queryByRole('list')).toBeNull();
        expect(screen.queryByTitle('Click to cancel the website selection')).toBeNull();
        expect(screen.queryByTitle('Reset all filters')).toBeNull();
        expect(screen.queryByText(/ websites/)).toBeNull();
    });

    it('should show the filters, the counter, the cards and the close button when it is open', () => {
        mountDialog();
        expect(nameField()).toBeTruthy();
        expect(mangaField()).toBeTruthy();
        expect(clearButton()).toBeTruthy();
        expect(screen.getByTitle('Click to cancel the website selection')).toBeTruthy();
        expect(counter()).toBe('6 / 6 websites');
        expect(cardIds()).toEqual(ALL_IDS);
    });

    it('should put the focus in the name field when it opens', () => {
        mountDialog();
        expect(document.activeElement).toBe(nameField());
    });

    // the dialog stays mounted while it is closed, so the filters outlive it; selecting the text on opening only makes sense for that
    it('should select the text of the name field when it opens again, so that typing replaces what was entered', async () => {
        const user = typist();
        const { rerender } = mountDialog();
        await user.type(nameField(), 'kakao');
        rerender(dialog({ open: false }));
        expect(screen.queryByTitle('Reset all filters')).toBeNull();
        rerender(dialog());
        expect(nameField().value).toBe('kakao');
        expect(document.activeElement).toBe(nameField());
        expect([nameField().selectionStart, nameField().selectionEnd]).toEqual([0, 5]);
        expect(cardIds()).toEqual(['kakaopage']);
    });

    it('should close with Escape, once, and only with that key', async () => {
        const user = typist();
        mountDialog();
        await user.keyboard('abc');
        await user.keyboard('{Enter}{Tab}{ArrowDown}');
        expect(onClose).not.toHaveBeenCalled();
        await user.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('should close with its button, without selecting anything', async () => {
        const user = typist();
        mountDialog({ selectedId: 'webtoons' });
        await user.click(screen.getByTitle('Click to cancel the website selection'));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('should not listen for Escape while it is closed', () => {
        mountDialog({ open: false });
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('should stop listening for Escape when it closes', () => {
        const { rerender } = mountDialog();
        rerender(dialog({ open: false }));
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('should stop listening for Escape when it is gone', () => {
        const { unmount } = mountDialog();
        unmount();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('should call the function that it was given last when Escape is pressed, and that one alone', () => {
        const { rerender } = mountDialog();
        const second = vi.fn();
        rerender(dialog({ onClose: second }));
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(second).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('should leave the focus and the selection alone when its parent renders again with a new onClose', async () => {
        const user = typist();
        const { rerender } = mountDialog();
        await user.type(nameField(), 'kakao');
        rerender(dialog({ onClose: vi.fn() }));
        expect([nameField().selectionStart, nameField().selectionEnd]).toEqual([5, 5]);
        await user.click(mangaField());
        rerender(dialog({ onClose: vi.fn() }));
        expect(document.activeElement).toBe(mangaField());
    });

    it('should leave no listener on the engine behind, however often it is opened and closed, when it is gone', () => {
        const live = trackListeners([engine.ConnectorRegistry]);
        const { rerender, unmount } = mountDialog();
        const whileOpen = live.length;
        expect(whileOpen).toBeGreaterThan(0);
        rerender(dialog({ open: false }));
        rerender(dialog());
        expect(live).toHaveLength(whileOpen);
        unmount();
        expect(live).toEqual([]);
    });

    it('should listen for Escape again when it is opened again', () => {
        const { rerender } = mountDialog();
        rerender(dialog({ open: false }));
        rerender(dialog());
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('the cards', () => {
    it('should show the name and the tags of each website', () => {
        mountDialog();
        const card = cardOf('toptoon');
        expect(within(card).getByText('TOPTOON (탑툰)')).toBeTruthy();
        expect(within(card).getByText('webtoon')).toBeTruthy();
        expect(within(card).getByText('korean')).toBeTruthy();
        expect(card.getAttribute('title')).toBe(
            'Click to show mangas from this website\n\nLabel: TOPTOON (탑툰)\nID: toptoon\nURL: https://toptoon.com'
        );
        // a connector that has no tags shows its name only
        expect(cardOf('bookmarks').textContent).toBe(' 【Bookmarks】');
    });

    it('should list a connector that has no tags, and no links, and leave it out when a tag is selected', async () => {
        const user = typist();
        const plain = createUpdatableConnector({ id: 'plain', label: 'Plain Site', tags: undefined, links: undefined });
        connectors.push(plain);
        mountDialog();
        expect(cardIds()).toContain('plain');
        expect(tagNames()).toEqual(['english', 'korean', 'manga', 'multi-lingual', 'novel', 'webtoon']);
        for (const title of ['Click to open the login page', 'Click to open the donation page']) {
            expect(within(cardOf('plain')).getByTitle(title).disabled).toBe(true);
        }
        await user.click(tagButton('webtoon'));
        expect(cardIds()).toEqual(['webtoons', 'toptoon', 'kakaopage']);
    });

    it('should mark the card of the selected website, and follow the selection', () => {
        const { rerender } = mountDialog({ selectedId: 'webtoons' });
        expect(selectedCardIds()).toEqual(['webtoons']);
        rerender(dialog({ selectedId: 'toptoon' }));
        expect(selectedCardIds()).toEqual(['toptoon']);
        rerender(dialog({ selectedId: 'unknown' }));
        expect(selectedCardIds()).toEqual([]);
    });

    it('should select the website of the card that is clicked', async () => {
        const user = typist();
        mountDialog();
        await user.click(cardOf('webtoons'));
        expect(onSelect).toHaveBeenCalledExactlyOnceWith('webtoons');
        expect(onClose).not.toHaveBeenCalled();
    });

    it.each([['Enter', '{Enter}'], ['Space', ' ']])('should select the website whose name has the focus when %s is pressed', async (name, key) => {
        const user = typist();
        mountDialog();
        const button = nameButtonOf(cardOf('toptoon'));
        expect(button.textContent).toBe('TOPTOON (탑툰)');
        button.focus();
        await user.keyboard(key);
        expect(onSelect).toHaveBeenCalledExactlyOnceWith('toptoon');
    });

    it('should not select anything for the other keys', async () => {
        const user = typist();
        mountDialog();
        nameButtonOf(cardOf('toptoon')).focus();
        await user.keyboard('a{ArrowDown}');
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('should show the icon of the website, and the default icon when that cannot be loaded', () => {
        mountDialog();
        const image = cardOf('mangadex').querySelector('img');
        expect(image.getAttribute('src')).toBe('/img/connectors/mangadex');
        fireEvent.error(image);
        expect(image.getAttribute('src')).toBe('/img/connectors/default');
        expect(cardOf('webtoons').querySelector('img').getAttribute('src')).toBe('/img/connectors/webtoons');
    });
});

describe('the buttons of a card', () => {
    it.each([
        ['mangadex', true, true, true],
        ['toptoon', true, false, true],
        ['webtoons', false, false, true],
        ['bookmarks', false, false, false]
    ])('should enable the buttons of %s for the links that exist: login %s, donation %s, website %s', (id, login, donation, website) => {
        mountDialog();
        const card = within(cardOf(id));
        expect(!card.getByTitle('Click to open the login page').disabled).toBe(login);
        expect(!card.getByTitle('Click to open the donation page').disabled).toBe(donation);
        expect(!card.getByTitle(/^Click to open the website in a new window/).disabled).toBe(website);
    });

    it.each([
        ['Click to open the login page', 'https://mangadex.org/login'],
        ['Click to open the donation page', 'https://mangadex.org/donate'],
        [/^Click to open the website in a new window/, 'https://mangadex.org']
    ])('should open the link of the button "%s" in a new window, and not select the card', async (title, url) => {
        const user = typist();
        mountDialog();
        await user.click(within(cardOf('mangadex')).getByTitle(title));
        expect(openWindow).toHaveBeenCalledExactlyOnceWith(url, '_blank', 'nodeIntegration=no');
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('should open nothing when a button without a link is clicked, and not select the card', async () => {
        const user = typist();
        mountDialog();
        await user.click(within(cardOf('webtoons')).getByTitle('Click to open the login page'));
        await user.click(within(cardOf('bookmarks')).getByTitle(/^Click to open the website in a new window/));
        expect(openWindow).not.toHaveBeenCalled();
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('should not select the card when Enter is pressed on one of its buttons', () => {
        mountDialog();
        fireEvent.keyDown(within(cardOf('mangadex')).getByTitle('Click to open the login page'), { key: 'Enter' });
        expect(onSelect).not.toHaveBeenCalled();
    });
});

describe('the name filter', () => {
    it.each([
        ['the id', 'kakaopage', ['kakaopage']],
        ['the label', '카카오', ['kakaopage']],
        ['the url', 'page.kakao.com', ['kakaopage']],
        ['no case', 'MANGADEX', ['mangadex']],
        ['a part of the label', 'toon', ['webtoons', 'toptoon']],
        ['the label of a system connector', 'bookmarks', ['bookmarks']],
        ['nothing', 'no such website', []],
        ['an empty pattern', '', ALL_IDS]
    ])('should match %s: "%s"', async (_what, pattern, expected) => {
        const user = typist();
        mountDialog();
        if (pattern) {
            await user.type(nameField(), pattern);
        }
        expect(cardIds()).toEqual(expected);
        expect(counter()).toBe(`${expected.length} / 6 websites`);
    });

    it('should show all of the websites again when the pattern is cleared', async () => {
        const user = typist();
        mountDialog();
        await user.type(nameField(), 'toon');
        expect(cardIds()).toEqual(['webtoons', 'toptoon']);
        await user.clear(nameField());
        expect(cardIds()).toEqual(ALL_IDS);
    });

    it('should not match the word "undefined" with the websites that have no url', async () => {
        const user = typist();
        mountDialog();
        await user.type(nameField(), 'undefined');
        expect(cardIds()).toEqual([]);
    });
});

describe('the tags', () => {
    it('should list every tag once, in alphabetical order', () => {
        mountDialog();
        expect(tagNames()).toEqual(['english', 'korean', 'manga', 'multi-lingual', 'novel', 'webtoon']);
    });

    it('should show only the websites that have the tag that is selected, and all of them again when it is selected again', async () => {
        const user = typist();
        mountDialog();
        await user.click(tagButton('korean'));
        expect(cardIds()).toEqual(['toptoon', 'kakaopage']);
        expect(counter()).toBe('2 / 6 websites');
        await user.click(tagButton('korean'));
        expect(cardIds()).toEqual(ALL_IDS);
    });

    it('should mark the tags that are selected', async () => {
        const user = typist();
        mountDialog();
        expect(tagButton('korean').className).not.toMatch(/tag-selected/);
        await user.click(tagButton('korean'));
        expect(tagButton('korean').className).toMatch(/tag-selected/);
        expect(tagButton('manga').className).not.toMatch(/tag-selected/);
        await user.click(tagButton('korean'));
        expect(tagButton('korean').className).not.toMatch(/tag-selected/);
    });

    it('should show only the websites that have all of the tags that are selected', async () => {
        const user = typist();
        mountDialog();
        await user.click(tagButton('webtoon'));
        expect(cardIds()).toEqual(['webtoons', 'toptoon', 'kakaopage']);
        await user.click(tagButton('korean'));
        expect(cardIds()).toEqual(['toptoon', 'kakaopage']);
        await user.click(tagButton('novel'));
        expect(cardIds()).toEqual(['kakaopage']);
        await user.click(tagButton('manga'));
        expect(cardIds()).toEqual([]);
        expect(counter()).toBe('0 / 6 websites');
        await user.click(tagButton('manga'));
        await user.click(tagButton('novel'));
        expect(cardIds()).toEqual(['toptoon', 'kakaopage']);
    });

    it('should combine the tags with the name pattern', async () => {
        const user = typist();
        mountDialog();
        await user.click(tagButton('webtoon'));
        await user.type(nameField(), 'top');
        expect(cardIds()).toEqual(['toptoon']);
        await user.click(tagButton('manga'));
        expect(cardIds()).toEqual([]);
    });

    it('should list a tag of a website that registers while the dialog is open', () => {
        mountDialog();
        act(() => {
            connectors.push(createUpdatableConnector({ id: 'newcomer', label: 'Newcomer', tags: ['yaoi'] }));
            engine.ConnectorRegistry.emit('registered');
        });
        expect(tagNames()).toEqual(['english', 'korean', 'manga', 'multi-lingual', 'novel', 'webtoon', 'yaoi']);
    });
});

describe('the manga filter', () => {
    const lists = {
        mangadex: [{ id: '1', title: 'Berserk' }, { id: '2', title: 'Akira' }],
        webtoons: [{ id: '3', title: 'Tower of God' }],
        toptoon: [{ id: '4', title: 'Berserk of Gluttony' }],
        kakaopage: []
        // the system connectors have no synchronized list: the engine rejects for them
    };

    function installLists(held) {
        const loadMangaList = vi.fn(async id => {
            if (held) {
                await held;
            }
            if (!(id in lists)) {
                throw new Error(`no manga list for "${id}"`);
            }
            return lists[id];
        });
        engine = installEngine({ connectors, engine: { Storage: { loadMangaList } } });
        return loadMangaList;
    }

    it('should search the local manga lists when Enter is pressed, and show the websites that have a matching manga', async () => {
        const user = typist();
        const loadMangaList = installLists();
        mountDialog();
        await user.type(mangaField(), 'berserk');
        expect(loadMangaList).not.toHaveBeenCalled();
        expect(cardIds()).toEqual(ALL_IDS);
        await user.keyboard('{Enter}');
        await waitFor(() => expect(cardIds()).toEqual(['mangadex', 'toptoon']));
        expect(counter()).toBe('2 / 6 websites');
        // every list is searched, also those of the system connectors that have none
        expect(loadMangaList.mock.calls.map(([id]) => id).sort()).toEqual([...ALL_IDS].sort());
    });

    it('should ignore case and the spaces around the pattern', async () => {
        const user = typist();
        installLists();
        mountDialog();
        await user.type(mangaField(), '  TOWER OF god  {Enter}');
        await waitFor(() => expect(cardIds()).toEqual(['webtoons']));
    });

    it('should show no website when no list has a matching manga', async () => {
        const user = typist();
        installLists();
        mountDialog();
        await user.type(mangaField(), 'nothing like it{Enter}');
        await waitFor(() => expect(counter()).toBe('0 / 6 websites'));
        expect(cardIds()).toEqual([]);
    });

    it('should search again for another pattern, and not keep the result of the first', async () => {
        const user = typist();
        installLists();
        mountDialog();
        await user.type(mangaField(), 'berserk{Enter}');
        await waitFor(() => expect(cardIds()).toEqual(['mangadex', 'toptoon']));
        await user.clear(mangaField());
        await user.type(mangaField(), 'tower{Enter}');
        await waitFor(() => expect(cardIds()).toEqual(['webtoons']));
    });

    it('should combine the result with the name pattern and the tags', async () => {
        const user = typist();
        installLists();
        mountDialog();
        await user.type(mangaField(), 'berserk{Enter}');
        await waitFor(() => expect(cardIds()).toEqual(['mangadex', 'toptoon']));
        await user.type(nameField(), 'dex');
        expect(cardIds()).toEqual(['mangadex']);
        await user.clear(nameField());
        await user.click(tagButton('korean'));
        expect(cardIds()).toEqual(['toptoon']);
    });

    it.each([[''], ['   ']])('should clear the search, and search nothing, when Enter is pressed with the pattern "%s"', async blank => {
        const user = typist();
        const loadMangaList = installLists();
        mountDialog();
        await user.type(mangaField(), 'berserk{Enter}');
        await waitFor(() => expect(cardIds()).toEqual(['mangadex', 'toptoon']));
        const searches = loadMangaList.mock.calls.length;
        await user.clear(mangaField());
        if (blank) {
            await user.type(mangaField(), blank);
        }
        await user.keyboard('{Enter}');
        expect(cardIds()).toEqual(ALL_IDS);
        expect(loadMangaList).toHaveBeenCalledTimes(searches);
    });

    it('should not take the other keys for a search', async () => {
        const user = typist();
        const loadMangaList = installLists();
        mountDialog();
        await user.type(mangaField(), 'berserk{Tab}{ArrowLeft}{Escape}');
        expect(loadMangaList).not.toHaveBeenCalled();
    });

    it('should not let the field be changed while the search runs, and open it again afterwards', async () => {
        const user = typist();
        let release = null;
        installLists(new Promise(resolve => {
            release = resolve;
        }));
        mountDialog();
        await user.type(mangaField(), 'berserk{Enter}');
        expect(mangaField().disabled).toBe(true);
        expect(cardIds()).toEqual(ALL_IDS);
        await act(async () => {
            release();
        });
        await waitFor(() => expect(cardIds()).toEqual(['mangadex', 'toptoon']));
        expect(mangaField().disabled).toBe(false);
    });

    it('should tell that the search failed, and leave the list as it was', async () => {
        const user = typist();
        installLists();
        mountDialog();
        await user.type(nameField(), 'toon');
        Object.defineProperty(engine, 'Connectors', {
            configurable: true,
            get() {
                throw new Error('the engine is not there');
            }
        });
        await user.type(mangaField(), 'berserk{Enter}');
        expect(await screen.findByText('Manga search failed: the engine is not there')).toBeTruthy();
        expect(toastOf('Manga search failed: the engine is not there').className).toMatch(/red/);
        expect(mangaField().disabled).toBe(false);
        expect(cardIds()).toEqual(['webtoons', 'toptoon']);
    });

    it('should not apply the result of a search to a list whose filters were reset meanwhile', async () => {
        const user = typist();
        let release = null;
        installLists(new Promise(resolve => {
            release = resolve;
        }));
        mountDialog();
        await user.type(mangaField(), 'berserk{Enter}');
        await user.click(clearButton());
        await act(async () => {
            release();
        });
        await waitFor(() => expect(mangaField().disabled).toBe(false));
        expect(counter()).toBe('6 / 6 websites');
    });
});

describe('the reset button', () => {
    it('should clear the name pattern, the manga search and the tags at once', async () => {
        const user = typist();
        engine = installEngine({
            connectors,
            engine: { Storage: { loadMangaList: vi.fn(async id => (id === 'toptoon' ? [{ id: '4', title: 'Berserk' }] : [])) } }
        });
        mountDialog();
        await user.type(nameField(), 'toon');
        await user.type(mangaField(), 'berserk{Enter}');
        await user.click(tagButton('korean'));
        await waitFor(() => expect(cardIds()).toEqual(['toptoon']));
        await user.click(clearButton());
        expect(nameField().value).toBe('');
        expect(mangaField().value).toBe('');
        expect(tagButton('korean').className).not.toMatch(/tag-selected/);
        expect(cardIds()).toEqual(ALL_IDS);
        expect(counter()).toBe('6 / 6 websites');
    });

    it('should leave a dialog without filters as it is', async () => {
        const user = typist();
        mountDialog();
        await user.click(clearButton());
        expect(cardIds()).toEqual(ALL_IDS);
        expect(onSelect).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('the counter', () => {
    it('should count the websites that are shown and all of them', async () => {
        const user = typist();
        mountDialog();
        expect(counter()).toBe('6 / 6 websites');
        await user.click(tagButton('novel'));
        expect(counter()).toBe('1 / 6 websites');
    });

    it('should say that the websites are still loading, count the ones that register, and say no more when they are all there', () => {
        engine = installEngine({ connectors, ready: false });
        mountDialog();
        expect(counter()).toBe('6 / 6 websites (still loading …)');
        act(() => {
            connectors.push(createUpdatableConnector({ id: 'newcomer', label: 'Newcomer' }));
            engine.ConnectorRegistry.emit('registered');
        });
        expect(counter()).toBe('7 / 7 websites (still loading …)');
        expect(cardIds()).toContain('newcomer');
        act(() => {
            engine.ConnectorRegistry.isReady = true;
            engine.ConnectorRegistry.emit('ready');
        });
        expect(counter()).toBe('7 / 7 websites');
    });

    it('should show no website and no cards when there is none', () => {
        engine = installEngine({ connectors: [] });
        mountDialog();
        expect(counter()).toBe('0 / 0 websites');
        expect(cards()).toEqual([]);
        expect(tagButtons()).toEqual([]);
    });
});

describe('the grid of cards', () => {
    function manyConnectors(count) {
        const list = Array.from({ length: count }, (_, index) => createUpdatableConnector({
            id: `site-${String(index + 1).padStart(3, '0')}`,
            label: `Site ${index + 1}`
        }));
        engine = installEngine({ connectors: list });
        return list;
    }

    it.each([
        [0, [1, 1, 1, 1, 1, 1, 1]],
        [399, [1, 1, 1, 1, 1, 1, 1]],
        [400, [1, 1, 1, 1, 1, 1, 1]],
        [799, [1, 1, 1, 1, 1, 1, 1]],
        [800, [2, 2, 2, 1]],
        [1250, [3, 3, 1]],
        [1600, [4, 3]],
        [2800, [7]]
    ])('should put the cards in rows as wide as the list allows: %i pixels', (width, expected) => {
        manyConnectors(7);
        setLayout({ width, height: 600 });
        mountDialog();
        expect(cardsPerRow()).toEqual(expected);
        expect(cards()).toHaveLength(7);
    });

    it('should keep the order of the websites along the rows', () => {
        manyConnectors(5);
        setLayout({ width: 1250, height: 600 });
        mountDialog();
        expect(cardIds()).toEqual(['site-001', 'site-002', 'site-003', 'site-004', 'site-005']);
        expect(cards().map(card => card.parentElement.children.length)).toEqual([3, 3, 3, 2, 2]);
    });

    it('should follow the width of the list when it changes', () => {
        vi.stubGlobal('ResizeObserver', RecordingObserver);
        manyConnectors(7);
        setLayout({ width: 800, height: 600 });
        mountDialog();
        expect(cardsPerRow()).toEqual([2, 2, 2, 1]);
        resizeTo(1250);
        expect(cardsPerRow()).toEqual([3, 3, 1]);
        resizeTo(300);
        expect(cardsPerRow()).toEqual([1, 1, 1, 1, 1, 1, 1]);
    });

    it('should measure the list again when the dialog is opened again', () => {
        manyConnectors(7);
        setLayout({ width: 800, height: 600 });
        const { rerender } = mountDialog();
        expect(cardsPerRow()).toEqual([2, 2, 2, 1]);
        rerender(dialog({ open: false }));
        setLayout({ width: 1250, height: 600 });
        rerender(dialog());
        expect(cardsPerRow()).toEqual([3, 3, 1]);
    });

    it('should let go of the list that it observes when it closes and when it is gone', () => {
        vi.stubGlobal('ResizeObserver', RecordingObserver);
        const { rerender, unmount } = mountDialog();
        expect(observers.some(observer => observer.observed.has(listbox()))).toBe(true);
        rerender(dialog({ open: false }));
        expect(observers.every(observer => observer.observed.size === 0)).toBe(true);
        rerender(dialog());
        expect(observers.some(observer => observer.observed.size > 0)).toBe(true);
        unmount();
        expect(observers.every(observer => observer.observed.size === 0)).toBe(true);
    });

    it('should show one column, and fail on nothing, where the browser cannot tell when the list changes its size', () => {
        vi.stubGlobal('ResizeObserver', undefined);
        manyConnectors(4);
        mountDialog();
        expect(cardsPerRow()).toEqual([1, 1, 1, 1]);
    });

    it('should draw only the rows of cards that fit in the list, and those that it is scrolled to', async () => {
        manyConnectors(300);
        mountDialog();
        expect(cards().length).toBeGreaterThan(2);
        expect(cards().length).toBeLessThan(60);
        expect(cardIds()[0]).toBe('site-001');
        expect(cardOf('site-300')).toBeUndefined();
        const list = listbox();
        list.scrollTop = parseInt(list.lastElementChild.style.height, 10);
        fireEvent.scroll(list);
        await waitFor(() => expect(cardOf('site-300')).toBeTruthy());
        expect(cardOf('site-001')).toBeUndefined();
        expect(cards().length).toBeLessThan(60);
    });

    it('should select a website of a row that was scrolled to', async () => {
        const user = typist();
        manyConnectors(300);
        mountDialog();
        const list = listbox();
        list.scrollTop = parseInt(list.lastElementChild.style.height, 10);
        fireEvent.scroll(list);
        await waitFor(() => expect(cardOf('site-300')).toBeTruthy());
        await user.click(cardOf('site-300'));
        expect(onSelect).toHaveBeenCalledExactlyOnceWith('site-300');
    });
});

describe('the refresh button of a card', () => {
    it('should update the manga list of that website only, and show it while it runs', async () => {
        const user = typist();
        mountDialog();
        const button = refreshOf('mangadex');
        expect(spins(button)).toBe(false);
        await user.click(button);
        expect(connectors[2].updateMangas).toHaveBeenCalledTimes(1);
        for (const other of connectors.filter(connector => connector.id !== 'mangadex')) {
            expect(other.updateMangas).not.toHaveBeenCalled();
        }
        expect(spins(refreshOf('mangadex'))).toBe(true);
        expect(refreshOf('mangadex').disabled).toBe(true);
        expect(within(cardOf('mangadex')).getByText('Updating…')).toBeTruthy();
        // the tags make room for the message, and the other cards show theirs
        expect(within(cardOf('mangadex')).queryByText('manga')).toBeNull();
        expect(within(cardOf('webtoons')).getByText('webtoon')).toBeTruthy();
        expect(spins(refreshOf('webtoons'))).toBe(false);
    });

    it('should not select the card, and not close the dialog', async () => {
        const user = typist();
        mountDialog();
        await user.click(refreshOf('mangadex'));
        expect(onSelect).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('should tell how many titles the update brought, and keep them in the cache of the website', async () => {
        const user = typist();
        mountDialog();
        await user.click(refreshOf('mangadex'));
        const fresh = makeMangas(connectors[2], ['Akira', 'Berserk']);
        await act(async () => {
            connectors[2].finishUpdate(fresh);
        });
        expect(await screen.findByText('Updated MangaDex (2 titles).')).toBeTruthy();
        expect(toastOf('Updated MangaDex (2 titles).').className).toMatch(/green/);
        expect(queryClient.getQueryData(['mangas', 'mangadex']).map(manga => manga.title)).toEqual(['Akira', 'Berserk']);
        expect(queryClient.getQueryData(['mangas', 'webtoons'])).toBeUndefined();
        // the card is ready for the next update, and shows its tags again
        tick(500);
        expect(spins(refreshOf('mangadex'))).toBe(false);
        expect(refreshOf('mangadex').disabled).toBe(false);
        expect(within(cardOf('mangadex')).getByText('manga')).toBeTruthy();
        expect(within(cardOf('mangadex')).queryByText(/Updating/)).toBeNull();
    });

    it.each([
        ['with the reason of the engine', new Error('HTTP 503'), 'Failed to update manga list for MangaDex\nHTTP 503'],
        ['without a reason', undefined, 'Failed to update manga list for MangaDex\nFailed to update manga list for "MangaDex"!']
    ])('should tell that the update failed, %s, and be ready for another try', async (_name, error, message) => {
        const user = typist();
        mountDialog();
        await user.click(refreshOf('mangadex'));
        await act(async () => {
            connectors[2].failUpdate(error);
        });
        const toast = await screen.findByText(/^Failed to update manga list for MangaDex/);
        expect(toast.textContent).toBe(message);
        expect(toastOf(/^Failed to update manga list for MangaDex/).className).toMatch(/red/);
        expect(queryClient.getQueryData(['mangas', 'mangadex'])).toBeUndefined();
        tick(500);
        expect(refreshOf('mangadex').disabled).toBe(false);
        expect(spins(refreshOf('mangadex'))).toBe(false);
        await user.click(refreshOf('mangadex'));
        expect(connectors[2].updateMangas).toHaveBeenCalledTimes(2);
    });

    it('should run an update once, however often the button is clicked', async () => {
        const user = typist();
        mountDialog();
        await user.click(refreshOf('mangadex'));
        await user.click(refreshOf('mangadex'));
        fireEvent.click(refreshOf('mangadex'));
        expect(connectors[2].updateMangas).toHaveBeenCalledTimes(1);
    });

    it('should update several websites at the same time, each with its own state', async () => {
        const user = typist();
        mountDialog();
        await user.click(refreshOf('mangadex'));
        await user.click(refreshOf('toptoon'));
        expect(connectors[2].updateMangas).toHaveBeenCalledTimes(1);
        expect(connectors[4].updateMangas).toHaveBeenCalledTimes(1);
        expect(spins(refreshOf('mangadex'))).toBe(true);
        expect(spins(refreshOf('toptoon'))).toBe(true);
        await act(async () => {
            connectors[2].finishUpdate(makeMangas(connectors[2], ['Akira', 'Berserk']));
        });
        await screen.findByText('Updated MangaDex (2 titles).');
        tick(500);
        expect(spins(refreshOf('mangadex'))).toBe(false);
        expect(spins(refreshOf('toptoon'))).toBe(true);
        expect(refreshOf('toptoon').disabled).toBe(true);
        await act(async () => {
            connectors[4].failUpdate(new Error('timeout'));
        });
        await screen.findByText(/^Failed to update manga list for TOPTOON/);
        tick(500);
        expect(spins(refreshOf('toptoon'))).toBe(false);
    });

    it('should count the requests and the time of the update in the card', async () => {
        const user = typist();
        mountDialog();
        await user.click(refreshOf('mangadex'));
        connectors[2].updateProgress.requests = 12;
        tick(65_000);
        expect(within(cardOf('mangadex')).getByText('Updating… 12 requests · 1:05')).toBeTruthy();
        connectors[2].updateProgress.requests = 13;
        tick(500);
        expect(within(cardOf('mangadex')).getByText('Updating… 13 requests · 1:05')).toBeTruthy();
    });

    it.each([
        [1, 5, 'Updating… 1 request · 0:05'],
        [0, 5, 'Updating… 0:05']
    ])('should show an update that was started elsewhere, %i requests after %i seconds, and not allow another', (requests, seconds, message) => {
        connectors[3].updateProgress = { requests, startedAt: Date.now() - seconds * 1000 };
        mountDialog();
        expect(within(cardOf('webtoons')).getByText(message)).toBeTruthy();
        expect(spins(refreshOf('webtoons'))).toBe(true);
        expect(refreshOf('webtoons').disabled).toBe(true);
        expect(spins(refreshOf('mangadex'))).toBe(false);
        fireEvent.click(refreshOf('webtoons'));
        expect(connectors[3].updateMangas).not.toHaveBeenCalled();
        // and its end is noticed
        connectors[3].updateProgress = undefined;
        tick(500);
        expect(spins(refreshOf('webtoons'))).toBe(false);
        expect(refreshOf('webtoons').disabled).toBe(false);
        expect(within(cardOf('webtoons')).getByText('webtoon')).toBeTruthy();
    });

    it('should go on, and tell the result, when the dialog is closed meanwhile', async () => {
        const user = typist();
        const { rerender } = mountDialog();
        await user.click(refreshOf('mangadex'));
        rerender(dialog({ open: false }));
        await act(async () => {
            connectors[2].finishUpdate(makeMangas(connectors[2], ['Akira', 'Berserk', 'Claymore']));
        });
        expect(await screen.findByText('Updated MangaDex (3 titles).')).toBeTruthy();
        expect(queryClient.getQueryData(['mangas', 'mangadex'])).toHaveLength(3);
        rerender(dialog());
        expect(spins(refreshOf('mangadex'))).toBe(false);
        expect(refreshOf('mangadex').disabled).toBe(false);
    });

    it('should show the update that is running when the dialog is opened again', async () => {
        const user = typist();
        const { rerender } = mountDialog();
        await user.click(refreshOf('mangadex'));
        rerender(dialog({ open: false }));
        rerender(dialog());
        expect(spins(refreshOf('mangadex'))).toBe(true);
        expect(refreshOf('mangadex').disabled).toBe(true);
        expect(within(cardOf('mangadex')).getByText('Updating… 0:00')).toBeTruthy();
    });

    it('should stop sampling the engine for the cards that are gone', () => {
        const { unmount } = mountDialog();
        expect(vi.getTimerCount()).toBeGreaterThan(0);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('the dialog for the keyboard and the screen reader', () => {
    it('should be a modal dialog with its filters labelled and its parts under headings', () => {
        mountDialog();
        const dialog = screen.getByRole('dialog', { name: 'Select a website' });
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(screen.getByLabelText('Website')).toBe(nameField());
        expect(screen.getByLabelText('Manga')).toBe(mangaField());
        expect(screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)).toEqual(['Tags', 'Connectors']);
        expect(screen.getByRole('group', { name: 'Tags' })).toBeTruthy();
        expect(screen.getByRole('list', { name: 'Connectors' })).toBe(listbox());
        expect(screen.getByRole('button', { name: 'Close the website selection' })).toBeTruthy();
        expect(screen.getByRole('status').textContent).toBe('6 / 6 websites');
    });

    it('should say which tags are pressed', async () => {
        const user = typist();
        mountDialog();
        expect(tagButton('korean').getAttribute('aria-pressed')).toBe('false');
        await user.click(tagButton('korean'));
        expect(tagButton('korean').getAttribute('aria-pressed')).toBe('true');
        expect(tagButton('webtoon').getAttribute('aria-pressed')).toBe('false');
    });

    it('should name the buttons of a card after the website, and the card itself as a list item', () => {
        mountDialog({ selectedId: 'mangadex' });
        const card = within(cardOf('mangadex'));
        expect(card.getByRole('button', { name: 'Login page of MangaDex' })).toBeTruthy();
        expect(card.getByRole('button', { name: 'Donation page of MangaDex' })).toBeTruthy();
        expect(card.getByRole('button', { name: 'Open MangaDex in a new window' })).toBeTruthy();
        expect(card.getByRole('button', { name: 'Update the manga list of MangaDex' })).toBeTruthy();
        expect(card.getByRole('button', { name: 'MangaDex' }).getAttribute('aria-current')).toBe('true');
        expect(within(cardOf('webtoons')).getByRole('button', { name: 'Webtoons' }).getAttribute('aria-current')).toBeNull();
    });

    it('should keep Tab inside, and give the focus back to the element that opened it when it closes', async () => {
        const user = typist();
        const opener = document.createElement('button');
        opener.textContent = 'Open';
        document.body.appendChild(opener);
        opener.focus();
        const { rerender } = mountDialog();
        expect(document.activeElement).toBe(nameField());
        // the close button comes first in the dialog; from there Shift+Tab goes round to the last control, the refresh
        // button of the last card, and Tab from that one comes back to the close button
        await user.tab({ shift: true });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close the website selection' }));
        await user.tab({ shift: true });
        expect(document.activeElement).toBe(within(cardOf('kakaopage')).getByTitle(/^Synchronize local manga list/));
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close the website selection' }));
        rerender(dialog({ open: false }));
        expect(document.activeElement).toBe(opener);
        opener.remove();
    });
});
