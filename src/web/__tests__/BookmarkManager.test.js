// The bookmarks of the user: a list sorted by the title of the manga, kept in the bookmark storage under 'bookmarks', with
// events for the UI (added, removed, changed) and the import of the favorites of FMD with a page of the results.
let BookmarkManager = null;
let Bookmark = null;

beforeAll(async () => {
    BookmarkManager = (await import('../mjs/engine/BookmarkManager.mjs')).default;
    Bookmark = (await import('../mjs/engine/Bookmark.mjs')).default;
});

afterEach(() => {
    delete globalThis.Engine;
    delete globalThis.window;
    vi.restoreAllMocks();
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function once(target, type) {
    return new Promise(resolve => target.addEventListener(type, resolve, { once: true }));
}

function deferred() {
    let resolve = null;
    const promise = new Promise(done => {
        resolve = done;
    });
    return { promise, resolve };
}

// the bookmark storage keeps JSON files: whatever is saved or loaded is a copy
function storage(files = {}) {
    const stored = new Map(Object.entries(files));
    return {
        stored,
        saveBookmarks: vi.fn(async (key, value) => {
            stored.set(key, JSON.parse(JSON.stringify(value)));
        }),
        loadBookmarks: vi.fn(async key => {
            if (!stored.has(key)) {
                throw new Error(`ENOENT: no such file or directory, open '${key}'`);
            }
            return JSON.parse(JSON.stringify(stored.get(key)));
        })
    };
}

function setup({ files, connectors = [{ id: 'site' }, { id: 'other' }] } = {}) {
    const engineStorage = storage(files);
    globalThis.Engine = { Connectors: connectors, Storage: engineStorage };
    globalThis.window = { open: vi.fn() };
    const settings = new EventTarget();
    const importer = { importBookmarks: vi.fn(async () => []) };
    return { manager: new BookmarkManager(settings, importer), settings, importer, storage: engineStorage };
}

function manga(id, title, connectorId = 'site') {
    return { id, title, connector: { id: connectorId, label: `Label of ${connectorId}` } };
}

// what the importer of FMD (BookmarkImporter) hands over
function favorite(connector, id, connectorTitle, mangaTitle) {
    return { key: { connector, manga: id }, title: { connector: connectorTitle, manga: mangaTitle } };
}

function titles(manager) {
    return manager.bookmarks.map(bookmark => bookmark.title.manga);
}

describe('addBookmark', () => {
    it('should bookmark a manga and tell about it before and after the list is saved', async () => {
        const { manager, storage: files } = setup();
        const order = [];
        manager.addEventListener('added', () => order.push('added'));
        manager.addEventListener('changed', () => order.push('changed'));
        const saved = once(manager, 'changed');

        expect(manager.addBookmark(manga('/m/1', 'One Piece'))).toBe(true);
        expect(order).toEqual(['added']);
        await saved;

        expect(order).toEqual(['added', 'changed']);
        expect(manager.bookmarks).toHaveLength(1);
        expect(manager.bookmarks[0]).toBeInstanceOf(Bookmark);
        expect(manager.bookmarks[0]).toEqual({
            title: { connector: 'Label of site', manga: 'One Piece' },
            key: { connector: 'site', manga: '/m/1' }
        });
        expect(files.saveBookmarks).toHaveBeenCalledTimes(1);
        expect(files.saveBookmarks).toHaveBeenCalledWith('bookmarks', manager.bookmarks, 2);
    });

    it('should give the new bookmark to the listeners of the added event', () => {
        const { manager } = setup();
        const added = vi.fn();
        manager.addEventListener('added', added);
        manager.addBookmark(manga('/m/1', 'One Piece'));
        expect(added.mock.calls[0][0].detail).toBe(manager.bookmarks[0]);
    });

    it('should keep the list sorted by the title of the manga, whatever its case', () => {
        const { manager } = setup();
        for (const title of ['beta', 'Gamma', 'alpha', 'Delta', 'ALPHA 2']) {
            manager.addBookmark(manga(`/m/${title}`, title));
        }
        expect(titles(manager)).toEqual(['alpha', 'ALPHA 2', 'beta', 'Delta', 'Gamma']);
    });

    it('should save the bookmarks that are added one right after the other, all of them', async () => {
        const { manager, storage: files } = setup();
        manager.addBookmark(manga('/m/1', 'Alpha'));
        manager.addBookmark(manga('/m/2', 'Beta'));
        manager.addBookmark(manga('/m/3', 'Gamma'));
        await flush();
        expect(files.stored.get('bookmarks').map(bookmark => bookmark.title.manga)).toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    it('should not bookmark a manga twice', async () => {
        const { manager, storage: files } = setup();
        manager.addBookmark(manga('/m/1', 'One Piece'));
        await flush();
        files.saveBookmarks.mockClear();
        const added = vi.fn();
        const changed = vi.fn();
        manager.addEventListener('added', added);
        manager.addEventListener('changed', changed);

        expect(manager.addBookmark(manga('/m/1', 'One Piece (a new title)'))).toBe(false);
        await flush();

        expect(manager.bookmarks).toHaveLength(1);
        expect(manager.bookmarks[0].title.manga).toBe('One Piece');
        expect(added).not.toHaveBeenCalled();
        expect(changed).not.toHaveBeenCalled();
        expect(files.saveBookmarks).not.toHaveBeenCalled();
    });

    it('should tell mangas apart by the connector and by the id', () => {
        const { manager } = setup();
        expect(manager.addBookmark(manga('/m/1', 'Same', 'site'))).toBe(true);
        expect(manager.addBookmark(manga('/m/1', 'Same', 'other'))).toBe(true);
        expect(manager.addBookmark(manga('/m/2', 'Same', 'site'))).toBe(true);
        expect(manager.bookmarks.map(bookmark => `${bookmark.key.connector}${bookmark.key.manga}`).sort()).toEqual(['other/m/1', 'site/m/1', 'site/m/2']);
    });

    it.each([
        ['nothing', undefined],
        ['null', null],
        ['a manga without a connector', { id: '/m/1', title: 'One Piece' }],
        ['a manga whose connector is null', { id: '/m/1', title: 'One Piece', connector: null }]
    ])('should refuse %s', async (name, value) => {
        const { manager, storage: files } = setup();
        const added = vi.fn();
        manager.addEventListener('added', added);
        expect(manager.addBookmark(value)).toBe(false);
        await flush();
        expect(manager.bookmarks).toEqual([]);
        expect(added).not.toHaveBeenCalled();
        expect(files.saveBookmarks).not.toHaveBeenCalled();
    });

    it('should be saved in the form that the bookmark files have always had', async () => {
        const { manager, storage: files } = setup();
        manager.addBookmark(manga('/m/1', '進撃の巨人'));
        await flush();
        expect(JSON.stringify(files.stored.get('bookmarks'))).toBe('[{"title":{"connector":"Label of site","manga":"進撃の巨人"},"key":{"connector":"site","manga":"/m/1"}}]');
    });

    it('should keep the bookmark when the list cannot be saved, and say so in the log', async () => {
        const { manager, storage: files } = setup();
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        files.saveBookmarks.mockRejectedValueOnce(new Error('disk full'));
        const changed = vi.fn();
        manager.addEventListener('changed', changed);
        expect(manager.addBookmark(manga('/m/1', 'One Piece'))).toBe(true);
        await flush();
        expect(manager.bookmarks).toHaveLength(1);
        expect(log).toHaveBeenCalledWith('Failed to save bookmarks:', 'disk full');
        expect(changed).not.toHaveBeenCalled();
    });
});

describe('deleteBookmark', () => {
    function withBookmarks() {
        const context = setup();
        context.manager.bookmarks = [favorite('site', '/m/1', 'Site', 'Alpha'), favorite('site', '/m/2', 'Site', 'Beta'), favorite('other', '/m/1', 'Other', 'Gamma')];
        return context;
    }

    it('should remove the bookmark and tell about it before and after the list is saved', async () => {
        const { manager, storage: files } = withBookmarks();
        const order = [];
        manager.addEventListener('removed', () => order.push('removed'));
        manager.addEventListener('changed', () => order.push('changed'));
        const saved = once(manager, 'changed');
        const bookmark = manager.bookmarks[1];

        expect(manager.deleteBookmark(bookmark)).toBe(true);
        expect(order).toEqual(['removed']);
        await saved;

        expect(order).toEqual(['removed', 'changed']);
        expect(titles(manager)).toEqual(['Alpha', 'Gamma']);
        expect(files.saveBookmarks).toHaveBeenCalledWith('bookmarks', manager.bookmarks, 2);
    });

    it('should give the bookmark that was asked for to the listeners of the removed event', () => {
        const { manager } = withBookmarks();
        const removed = vi.fn();
        manager.addEventListener('removed', removed);
        const copy = favorite('site', '/m/2', 'Site', 'Beta');
        manager.deleteBookmark(copy);
        expect(removed.mock.calls[0][0].detail).toBe(copy);
    });

    it('should recognise the bookmark by its keys, not by the object', () => {
        const { manager } = withBookmarks();
        expect(manager.deleteBookmark({ key: { connector: 'other', manga: '/m/1' }, title: { connector: 'x', manga: 'other title' } })).toBe(true);
        expect(titles(manager)).toEqual(['Alpha', 'Beta']);
    });

    it.each([
        ['a manga that is not bookmarked', favorite('site', '/m/404', 'Site', 'Nope')],
        ['a manga of another connector', favorite('elsewhere', '/m/1', 'Site', 'Alpha')]
    ])('should refuse %s', async (name, bookmark) => {
        const { manager, storage: files } = withBookmarks();
        const removed = vi.fn();
        manager.addEventListener('removed', removed);
        expect(manager.deleteBookmark(bookmark)).toBe(false);
        await flush();
        expect(manager.bookmarks).toHaveLength(3);
        expect(removed).not.toHaveBeenCalled();
        expect(files.saveBookmarks).not.toHaveBeenCalled();
    });

    it('should leave the bookmark of the same manga id at another connector', () => {
        const { manager } = withBookmarks();
        manager.deleteBookmark(favorite('site', '/m/1', 'Site', 'Alpha'));
        expect(manager.bookmarks.map(bookmark => `${bookmark.key.connector}${bookmark.key.manga}`)).toEqual(['site/m/2', 'other/m/1']);
    });
});

describe('loadProfile', () => {
    it('should take over the stored bookmarks, sorted, and tell about it', async () => {
        const { manager, storage: files } = setup({ files: { bookmarks: [favorite('site', '/m/2', 'Site', 'beta'), favorite('site', '/m/1', 'Site', 'Alpha')] } });
        const changed = once(manager, 'changed');
        const callback = vi.fn();
        manager.loadProfile('default', callback);
        const event = await changed;
        expect(files.loadBookmarks).toHaveBeenCalledWith('bookmarks');
        expect(titles(manager)).toEqual(['Alpha', 'beta']);
        expect(event.detail).toBe(manager.bookmarks);
        expect(callback).toHaveBeenCalledWith(null);
    });

    // NOTE: a stored list without bookmarks is "invalid" here, ChaptermarkManager accepts it; the manager starts with an empty list anyway
    it.each([
        ['null', null],
        ['an empty list', []],
        ['an empty object', {}]
    ])('should refuse %s and keep the list that it has', async (name, stored) => {
        const { manager } = setup({ files: { bookmarks: stored } });
        manager.bookmarks = [favorite('site', '/m/1', 'Site', 'Alpha')];
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const changed = vi.fn();
        manager.addEventListener('changed', changed);
        const callback = vi.fn();
        manager.loadProfile('default', callback);
        await flush();
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0][0].message).toBe('Invalid bookmark list!');
        expect(log).toHaveBeenCalledWith('Failed to load bookmarks:', 'Invalid bookmark list!');
        expect(titles(manager)).toEqual(['Alpha']);
        expect(changed).not.toHaveBeenCalled();
    });

    it('should pass on the error of the storage, as it is on the first start when there is no file yet', async () => {
        const { manager } = setup();
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const callback = vi.fn();
        manager.loadProfile('default', callback);
        await flush();
        expect(callback.mock.calls[0][0].message).toMatch(/ENOENT/);
        expect(manager.bookmarks).toEqual([]);
        expect(log).not.toHaveBeenCalled();
    });

    it('should work without a callback', async () => {
        const { manager } = setup({ files: { bookmarks: [favorite('site', '/m/1', 'Site', 'Alpha')] } });
        const changed = once(manager, 'changed');
        manager.loadProfile('default', undefined);
        await changed;
        expect(titles(manager)).toEqual(['Alpha']);
    });

    it.each([
        ['a storage that fails', undefined],
        ['an invalid list', []]
    ])('should work without a callback for %s', async (name, stored) => {
        const { manager } = setup(stored ? { files: { bookmarks: stored } } : undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(() => manager.loadProfile('default', undefined)).not.toThrow();
        await flush();
        expect(manager.bookmarks).toEqual([]);
    });

    it.each([
        ['a text', 'not a list'],
        ['a number', 42],
        ['an object with a length', { length: 3 }],
        ['true', true]
    ])('should refuse a stored value that is %s, and keep an array as the list', async (name, stored) => {
        const { manager } = setup({ files: { bookmarks: stored } });
        manager.bookmarks = [favorite('site', '/m/1', 'Site', 'Alpha')];
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const changed = vi.fn();
        manager.addEventListener('changed', changed);
        const callback = vi.fn();
        manager.loadProfile('default', callback);
        await flush();
        expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(callback.mock.calls[0][0].message).toBe('Invalid bookmark list!');
        expect(titles(manager)).toEqual(['Alpha']);
        expect(changed).not.toHaveBeenCalled();
        expect(manager.addBookmark(manga('/m/2', 'Beta'))).toBe(true);
        expect(titles(manager)).toEqual(['Alpha', 'Beta']);
    });
});

describe('saveProfile', () => {
    it('should save the bookmarks, tell about it and call back', async () => {
        const { manager, storage: files } = setup();
        manager.bookmarks = [favorite('site', '/m/1', 'Site', 'Alpha')];
        const changed = once(manager, 'changed');
        const callback = vi.fn();
        manager.saveProfile('default', callback);
        const event = await changed;
        expect(files.saveBookmarks).toHaveBeenCalledWith('bookmarks', manager.bookmarks, 2);
        expect(event.detail).toBe(manager.bookmarks);
        expect(callback).toHaveBeenCalledWith(null);
    });

    it('should call back with the error and write it to the log when the save fails', async () => {
        const { manager, storage: files } = setup();
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const failure = new Error('disk full');
        files.saveBookmarks.mockRejectedValueOnce(failure);
        const changed = vi.fn();
        manager.addEventListener('changed', changed);
        const callback = vi.fn();
        manager.saveProfile('default', callback);
        await flush();
        expect(callback).toHaveBeenCalledWith(failure);
        expect(log).toHaveBeenCalledWith('Failed to save bookmarks:', 'disk full');
        expect(changed).not.toHaveBeenCalled();
    });

    it.each([['no callback', undefined], ['a callback that is no function', 'callback']])('should work with %s', async (name, callback) => {
        const { manager, storage: files } = setup();
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        manager.saveProfile('default', callback);
        files.saveBookmarks.mockRejectedValueOnce(new Error('disk full'));
        manager.saveProfile('default', callback);
        await flush();
        expect(files.saveBookmarks).toHaveBeenCalledTimes(2);
        expect(log).toHaveBeenCalledTimes(1);
    });
});

describe('the settings of the application', () => {
    it('should save the bookmarks again when the settings are saved, for the case that the bookmark directory changed', async () => {
        const { manager, settings, storage: files } = setup();
        manager.bookmarks = [favorite('site', '/m/1', 'Site', 'Alpha')];
        const changed = once(manager, 'changed');
        settings.dispatchEvent(new CustomEvent('saved'));
        await changed;
        expect(files.saveBookmarks).toHaveBeenCalledWith('bookmarks', manager.bookmarks, 2);
    });

    it('should not save when the settings are only loaded', async () => {
        const { settings, storage: files } = setup();
        settings.dispatchEvent(new CustomEvent('loaded'));
        await flush();
        expect(files.saveBookmarks).not.toHaveBeenCalled();
    });
});

describe('compareBookmarks', () => {
    it('should order by the title of the manga without looking at the case', () => {
        const { manager } = setup();
        const a = favorite('site', '/1', 'S', 'apple');
        const b = favorite('site', '/2', 'S', 'Banana');
        expect(manager.compareBookmarks(a, b)).toBeLessThan(0);
        expect(manager.compareBookmarks(b, a)).toBeGreaterThan(0);
        expect(manager.compareBookmarks(favorite('s', '/3', 'S', 'ABC'), favorite('s', '/4', 'S', 'abd'))).toBeLessThan(0);
    });

    it('should sort a long list, whatever the order it comes in', () => {
        const { manager } = setup();
        const words = Array.from({ length: 120 }, (value, index) => `${String.fromCharCode(97 + (index * 7) % 26)}${(index * 31) % 97}`);
        const sorted = [...words].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
        const list = words.map((word, index) => favorite('site', `/${index}`, 'S', index % 2 ? word.toUpperCase() : word));
        list.sort(manager.compareBookmarks);
        expect(list.map(bookmark => bookmark.title.manga.toLowerCase())).toEqual(sorted);
    });

    it('should keep bookmarks with the same title in the order they were added', () => {
        const { manager } = setup();
        const list = [favorite('c', '/1', 'C', 'Same'), favorite('a', '/2', 'A', 'same'), favorite('b', '/3', 'B', 'SAME'), favorite('d', '/4', 'D', 'Before')];
        list.sort(manager.compareBookmarks);
        expect(list.map(bookmark => bookmark.key.connector)).toEqual(['d', 'c', 'a', 'b']);
    });
});

describe('importBookmarks', () => {
    const file = { name: 'favorites.db' };

    // the page of the results is opened as a data URL, its three sections are split by their anchors
    function results() {
        expect(window.open).toHaveBeenCalledTimes(1);
        const [url, target, features] = window.open.mock.calls[0];
        expect(url.startsWith('data:text/html;utf8,')).toBe(true);
        const html = decodeURIComponent(url.slice('data:text/html;utf8,'.length));
        const at = name => html.indexOf(`<a name="${name}">`);
        const rows = section => [...section.matchAll(/<tr><td[^>]*>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g)].map(match => [match[1], match[2]]);
        const sections = { dropped: html.slice(at('dropped'), at('exists')), exists: html.slice(at('exists'), at('added')), added: html.slice(at('added')) };
        return {
            html,
            target,
            features,
            sections,
            dropped: rows(sections.dropped),
            exists: rows(sections.exists),
            added: rows(sections.added)
        };
    }

    it('should add the favorites of the connectors that are there, sorted, and save the list', async () => {
        const { manager, importer, storage: files } = setup();
        importer.importBookmarks.mockResolvedValue([
            favorite('site', '/m/2', 'Site', 'zeta'),
            favorite('other', '/m/1', 'Other', 'Alpha'),
            favorite('site', '/m/3', 'Site', 'Beta')
        ]);
        const changed = once(manager, 'changed');
        await manager.importBookmarks(file);
        await changed;
        expect(importer.importBookmarks).toHaveBeenCalledWith(file);
        expect(titles(manager)).toEqual(['Alpha', 'Beta', 'zeta']);
        expect(files.saveBookmarks).toHaveBeenCalledTimes(1);
        expect(files.saveBookmarks).toHaveBeenCalledWith('bookmarks', manager.bookmarks, 2);
    });

    it('should report what was added, what exists already and what was dropped', async () => {
        const { manager, importer } = setup();
        manager.bookmarks = [favorite('site', '/m/1', 'Site', 'Known')];
        importer.importBookmarks.mockResolvedValue([
            favorite('site', '/m/1', 'Site', 'Known'),
            favorite('site', '/m/2', 'Site', 'New'),
            favorite('gone', '/m/3', 'Gone Site', 'Lost')
        ]);
        await manager.importBookmarks(file);
        const page = results();
        expect(page.added).toEqual([['Site', 'New']]);
        expect(page.exists).toEqual([['Site', 'Known']]);
        expect(page.dropped).toEqual([['Gone Site', 'Lost']]);
        expect(titles(manager)).toEqual(['Known', 'New']);
        expect(page.html).toContain('Bookmark Import Results');
    });

    it('should open the report in a window of its own', async () => {
        const { manager, importer } = setup();
        importer.importBookmarks.mockResolvedValue([favorite('site', '/m/1', 'Site', 'Alpha')]);
        await manager.importBookmarks(file);
        const page = results();
        expect(page.target).toBe('_blank');
        expect(page.features).toContain('width=800');
        expect(page.features).toContain('height=600');
    });

    it('should show titles in any script in the report', async () => {
        const { manager, importer } = setup();
        importer.importBookmarks.mockResolvedValue([favorite('site', '/m/1', 'サイト', '進撃の巨人 😀 Ünï')]);
        await manager.importBookmarks(file);
        expect(results().added).toEqual([['サイト', '進撃の巨人 😀 Ünï']]);
    });

    it('should add a manga that is twice in the file once', async () => {
        const { manager, importer } = setup();
        importer.importBookmarks.mockResolvedValue([favorite('site', '/m/1', 'Site', 'Alpha'), favorite('site', '/m/1', 'Site', 'Alpha again')]);
        await manager.importBookmarks(file);
        const page = results();
        expect(titles(manager)).toEqual(['Alpha']);
        expect(page.added).toEqual([['Site', 'Alpha']]);
        expect(page.exists).toEqual([['Site', 'Alpha again']]);
    });

    it('should import the favorites of a connector for each id on its own', async () => {
        const { manager, importer } = setup();
        manager.bookmarks = [favorite('site', '/m/1', 'Site', 'Alpha')];
        importer.importBookmarks.mockResolvedValue([favorite('other', '/m/1', 'Other', 'Alpha'), favorite('site', '/m/2', 'Site', 'Alpha 2')]);
        await manager.importBookmarks(file);
        expect(manager.bookmarks).toHaveLength(3);
        expect(results().exists).toEqual([]);
    });

    // NOTE: the two checks are independent, so a favorite of a connector that is gone, which is in the list already, is in both sections
    it('should list a favorite that is both unsupported and known in the two sections', async () => {
        const { manager, importer } = setup();
        manager.bookmarks = [favorite('gone', '/m/1', 'Gone Site', 'Lost')];
        importer.importBookmarks.mockResolvedValue([favorite('gone', '/m/1', 'Gone Site', 'Lost')]);
        await manager.importBookmarks(file);
        const page = results();
        expect(page.dropped).toEqual([['Gone Site', 'Lost']]);
        expect(page.exists).toEqual([['Gone Site', 'Lost']]);
        expect(page.added).toEqual([]);
        expect(manager.bookmarks).toHaveLength(1);
    });

    it('should open an empty report for a file without favorites', async () => {
        const { manager } = setup();
        await manager.importBookmarks(file);
        const page = results();
        expect([page.added, page.exists, page.dropped]).toEqual([[], [], []]);
        expect(manager.bookmarks).toEqual([]);
    });

    it('should reject, and neither save nor open anything, when the file cannot be imported', async () => {
        const { manager, importer, storage: files } = setup();
        manager.bookmarks = [favorite('site', '/m/1', 'Site', 'Alpha')];
        importer.importBookmarks.mockRejectedValue(new Error("File type 'text/plain' is not supported!"));
        await expect(manager.importBookmarks(file)).rejects.toThrow('not supported');
        expect(titles(manager)).toEqual(['Alpha']);
        expect(files.saveBookmarks).not.toHaveBeenCalled();
        expect(window.open).not.toHaveBeenCalled();
    });

    // the titles are the text of a file of a user: a title in angle brackets must not vanish as an unknown tag, markup in it is
    // not interpreted and a script in it does not run, in whichever section of the report it is
    it('should show the titles in the report as the text that they are', async () => {
        const decode = text => text.replace(/&(?:amp|lt|gt|quot|apos|#39|#x27);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' }[entity] || '\''));
        const { manager, importer } = setup();
        manager.bookmarks = [favorite('site', '/m/3', 'Known <i>', '<Known> &amp; Co')];
        importer.importBookmarks.mockResolvedValue([
            favorite('site', '/m/1', 'Site <b>', '<img src=x onerror=alert(1)> & <Overlord> "quoted" \'single\''),
            favorite('site', '/m/3', 'Known <i>', '<Known> &amp; Co'),
            favorite('gone', '/m/2', 'Gone </td><td>', '</td></tr><script>alert(1)</script>')
        ]);

        await manager.importBookmarks(file);

        const page = results();
        const text = row => row.map(decode);
        expect(page.added.map(text)).toEqual([['Site <b>', '<img src=x onerror=alert(1)> & <Overlord> "quoted" \'single\'']]);
        expect(page.exists.map(text)).toEqual([['Known <i>', '<Known> &amp; Co']]);
        expect(page.dropped.map(text)).toEqual([['Gone </td><td>', '</td></tr><script>alert(1)</script>']]);
        // none of it is markup of the page, and no title opened a cell of its own: three rows of two cells
        expect(page.html).not.toMatch(/<(?:img|script|b|i|Overlord|Known)\b/);
        expect(page.html.match(/<td/g)).toHaveLength(6);
    });

    // the connectors register in the background after the UI is shown (Engine.ConnectorsReady)
    it('should wait for the connectors to be registered before it drops a favorite as unsupported', async () => {
        const connectors = [];
        const ready = deferred();
        const { manager, importer } = setup({ connectors });
        Object.assign(globalThis.Engine, { ConnectorsReady: ready.promise });
        importer.importBookmarks.mockResolvedValue([favorite('late', '/m/1', 'Late Site', 'Alpha'), favorite('never', '/m/2', 'Never Site', 'Beta')]);

        const importing = manager.importBookmarks(file);
        await flush();
        expect(window.open).not.toHaveBeenCalled();
        connectors.push({ id: 'late' });
        ready.resolve(connectors);
        await importing;

        expect(titles(manager)).toEqual(['Alpha']);
        const page = results();
        expect(page.added).toEqual([['Late Site', 'Alpha']]);
        expect(page.dropped).toEqual([['Never Site', 'Beta']]);
    });

    it('should refuse a file that cannot be imported at once, without waiting for the connectors', async () => {
        const { manager, importer } = setup();
        Object.assign(globalThis.Engine, { ConnectorsReady: new Promise(() => undefined) });
        importer.importBookmarks.mockRejectedValue(new Error("File type 'text/plain' is not supported!"));
        await expect(manager.importBookmarks(file)).rejects.toThrow('not supported');
    });
});
