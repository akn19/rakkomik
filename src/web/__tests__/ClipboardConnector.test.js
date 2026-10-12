// The built-in source that turns the links in the clipboard into mangas: every line of the text is a link, the
// connector of the website that it belongs to makes the manga of it.
let ClipboardConnector = null;
let Connector = null;

beforeAll(async () => {
    ClipboardConnector = (await import('../mjs/connectors/system/ClipboardConnector.mjs')).default;
    Connector = (await import('../mjs/engine/Connector.mjs')).default;
});

afterEach(() => {
    delete globalThis.window;
    delete globalThis.Engine;
    vi.restoreAllMocks();
});

/** a connector of a website, as the engine knows them (see Connector.canHandleURI), that makes a manga of a link */
function website(url, id = new URL(url).hostname) {
    const connector = new Connector();
    connector.id = id;
    connector.label = id;
    connector.url = url;
    connector.getMangaFromURI = vi.fn(async (uri) => ({
        id: uri.pathname + uri.search,
        title: `${id}${uri.pathname}`,
        connector,
    }));
    return connector;
}

function setup(clipboard, connectors = []) {
    const readText =
        typeof clipboard === 'function' ? vi.fn(clipboard) : vi.fn(async () => clipboard);
    globalThis.window = { hakuneko: { clipboard: { readText } } };
    globalThis.Engine = { Connectors: connectors };
    return { connector: new ClipboardConnector(), readText };
}

const update = (connector) =>
    new Promise((resolve) => connector.updateMangas((...answer) => resolve(answer)));
const settle = () => new Promise((resolve) => setImmediate(resolve));
const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

describe('ClipboardConnector', () => {
    it('should present itself as the source of the links in the clipboard', () => {
        const { connector, readText } = setup('');
        expect(connector.id).toBe('clipboard');
        expect(connector.label).toBe(' 【Clipboard】');
        expect(connector.icon).toBe('/img/connectors/clipboard');
        expect(connector.tags).toEqual([]);
        expect(connector.url).toBeUndefined();
        expect(connector.isUpdating).toBeUndefined();
        // it does not look at the clipboard before it is asked to
        expect(readText).not.toHaveBeenCalled();
    });

    it('should not take part in the matching of links itself', () => {
        const { connector } = setup('');
        expect(connector.canHandleURI).toBeUndefined();
        expect(connector.url).toBeUndefined();
    });

    describe('getMangas', () => {
        it('should provide an empty manga list on initialization, without looking at the clipboard', () => {
            const { connector, readText } = setup('http://mangadex.org/a/b');
            const callback = vi.fn();
            connector.getMangas(callback);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith(null, []);
            expect(readText).not.toHaveBeenCalled();
        });

        it('should provide the cached manga list, without looking at the clipboard', () => {
            const { connector, readText } = setup('http://mangadex.org/a/b');
            const cache = [1, 2, 3];
            connector.mangaCache = cache;
            const callback = vi.fn();
            connector.getMangas(callback);
            expect(callback).toHaveBeenCalledWith(null, cache);
            expect(callback.mock.calls[0][1]).toBe(cache);
            expect(readText).not.toHaveBeenCalled();
        });

        it('should not share the cache with another connector', () => {
            const first = setup('').connector;
            const second = setup('').connector;
            expect(first.mangaCache).not.toBe(second.mangaCache);
        });
    });

    describe('updateMangas', () => {
        it('should make a manga of each link in the clipboard, with the connector of its website, and keep them', async () => {
            const west = website('https://west.example');
            const east = website('https://east.example');
            const { connector, readText } = setup(
                'https://west.example/manga/1\nhttps://east.example/series/2?lang=en',
                [west, east],
            );
            const [error, mangas] = await update(connector);
            expect(error).toBeNull();
            expect(mangas.map((manga) => [manga.id, manga.connector])).toEqual([
                ['/manga/1', west],
                ['/series/2?lang=en', east],
            ]);
            expect(readText).toHaveBeenCalledTimes(1);
            expect(connector.mangaCache).toBe(mangas);
            // the same list is there for the next one that asks
            const callback = vi.fn();
            connector.getMangas(callback);
            expect(callback).toHaveBeenCalledWith(null, mangas);
            expect(readText).toHaveBeenCalledTimes(1);
        });

        it('should hand the link to the connector as an address', async () => {
            const west = website('https://west.example');
            const { connector } = setup('https://west.example/manga/1?x=a b#top', [west]);
            await update(connector);
            const [uri] = west.getMangaFromURI.mock.calls[0];
            expect(uri).toBeInstanceOf(URL);
            expect(uri.href).toBe('https://west.example/manga/1?x=a%20b#top');
        });

        it('should be busy while it reads, and ready again afterwards', async () => {
            const { connector } = setup('https://west.example/manga/1', [
                website('https://west.example'),
            ]);
            const callback = vi.fn();
            connector.updateMangas(callback);
            expect(connector.isUpdating).toBe(true);
            await settle();
            expect(connector.isUpdating).toBe(false);
            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('should replace the manga list of the last update', async () => {
            const west = website('https://west.example');
            let text = 'https://west.example/manga/1';
            const { connector, readText } = setup(async () => text, [west]);
            expect((await update(connector))[1].map((manga) => manga.id)).toEqual(['/manga/1']);
            text = 'https://west.example/manga/2\nhttps://west.example/manga/3';
            expect((await update(connector))[1].map((manga) => manga.id)).toEqual([
                '/manga/2',
                '/manga/3',
            ]);
            text = '';
            expect((await update(connector))[1]).toEqual([]);
            expect(readText).toHaveBeenCalledTimes(3);
        });

        it('should answer the update that runs, once, when another one is asked for meanwhile', async () => {
            let release;
            const { connector, readText } = setup(
                () =>
                    new Promise((resolve) => {
                        release = resolve;
                    }),
                [website('https://west.example')],
            );
            const first = vi.fn();
            connector.updateMangas(first);
            connector.updateMangas(vi.fn());
            release('https://west.example/manga/1');
            await settle();
            expect(first).toHaveBeenCalledTimes(1);
            expect(first.mock.calls[0][1].map((manga) => manga.id)).toEqual(['/manga/1']);
            expect(readText).toHaveBeenCalledTimes(1);
        });

        it('should answer an update that is asked for while another one runs', async () => {
            let release;
            const { connector } = setup(
                () =>
                    new Promise((resolve) => {
                        release = resolve;
                    }),
                [website('https://west.example')],
            );
            const second = vi.fn();
            connector.updateMangas(vi.fn());
            connector.updateMangas(second);
            release('https://west.example/manga/1');
            await settle();
            expect(second).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['nothing', ''],
            ['nothing at all', undefined],
            ['null', null],
            ['blanks', '   \n\t\n  '],
        ])('should give no mangas when the clipboard holds %s', async (name, text) => {
            quiet();
            const { connector } = setup(text, [website('https://west.example')]);
            await expect(update(connector)).resolves.toEqual([null, []]);
        });

        it.each([
            ['lines that end with \\n', 'https://west.example/1\nhttps://west.example/2\n'],
            ['lines that end with \\r\\n', 'https://west.example/1\r\nhttps://west.example/2\r\n'],
            [
                'links with blanks around them',
                '  https://west.example/1  \n\thttps://west.example/2\t',
            ],
            ['empty lines between the links', 'https://west.example/1\n\n\nhttps://west.example/2'],
        ])('should find the links in %s', async (name, text) => {
            quiet();
            const { connector } = setup(text, [website('https://west.example')]);
            const [, mangas] = await update(connector);
            expect(mangas.map((manga) => manga.id)).toEqual(['/1', '/2']);
        });

        it('should skip a line that is no link, say so, and go on with the others', async () => {
            const warn = quiet();
            const { connector } = setup(
                'hello there\nhttps://west.example/1\n/just/a/path\nhttps://west.example/2',
                [website('https://west.example')],
            );
            const [error, mangas] = await update(connector);
            expect(error).toBeNull();
            expect(mangas.map((manga) => manga.id)).toEqual(['/1', '/2']);
            expect(warn).toHaveBeenCalledTimes(2);
            expect(warn.mock.calls.map((call) => [call[0], call[1]])).toEqual([
                ['CLIPBOARD:', 'hello there'],
                ['CLIPBOARD:', '/just/a/path'],
            ]);
            expect(warn.mock.calls[0][2]).toBeInstanceOf(TypeError);
        });

        it('should keep the order of the lines, whichever website answers first', async () => {
            const west = website('https://west.example');
            const resolvers = new Map();
            west.getMangaFromURI = vi.fn(
                (uri) =>
                    new Promise((resolve) => {
                        resolvers.set(uri.pathname, () => resolve({ id: uri.pathname }));
                    }),
            );
            const { connector } = setup(
                'https://west.example/1\nhttps://west.example/2\nhttps://west.example/3',
                [west],
            );
            const pending = update(connector);
            await settle();
            expect(resolvers.size).toBe(3);
            resolvers.get('/3')();
            resolvers.get('/1')();
            resolvers.get('/2')();
            expect((await pending)[1].map((manga) => manga.id)).toEqual(['/1', '/2', '/3']);
        });

        it('should skip a link that its connector cannot make a manga of, say so, and keep the others', async () => {
            const warn = quiet();
            const west = website('https://west.example');
            const failure = new Error('The site is down');
            west.getMangaFromURI.mockImplementation(async (uri) => {
                if (uri.pathname === '/2') {
                    throw failure;
                }
                return { id: uri.pathname };
            });
            const { connector } = setup(
                'https://west.example/1\nhttps://west.example/2\nhttps://west.example/3',
                [west],
            );
            const [error, mangas] = await update(connector);
            expect(error).toBeNull();
            expect(mangas.map((manga) => manga.id)).toEqual(['/1', '/3']);
            expect(warn).toHaveBeenCalledExactlyOnceWith(
                'CLIPBOARD:',
                'https://west.example/2',
                failure,
            );
        });

        it('should skip a link that its connector makes nothing of', async () => {
            const west = website('https://west.example');
            west.getMangaFromURI.mockResolvedValue(undefined);
            const { connector } = setup('https://west.example/1', [west]);
            await expect(update(connector)).resolves.toEqual([null, []]);
        });

        it('should make a manga of the same link each time it is there', async () => {
            const { connector } = setup('https://west.example/1\nhttps://west.example/1', [
                website('https://west.example'),
            ]);
            expect((await update(connector))[1]).toHaveLength(2);
        });

        it('should end the update, and answer, when the clipboard cannot be read', async () => {
            const { connector } = setup(
                () => Promise.reject(new Error('clipboard is not available')),
                [],
            );
            // observe the rejection, so that the run does not stop at it
            const original = connector._getMangaList.bind(connector);
            connector._getMangaList = (callback) => {
                const promise = original(callback);
                promise.catch(() => undefined);
                return promise;
            };
            const callback = vi.fn();
            connector.updateMangas(callback);
            await settle();
            expect(callback).toHaveBeenCalledTimes(1);
            expect(connector.isUpdating).toBe(false);
        });
    });

    describe('the connector of a link', () => {
        const link = (connectors, text) => {
            const { connector } = setup(text, connectors);
            return update(connector);
        };

        it('should be the one that says it handles the link, by the address of its website', async () => {
            const west = website('https://west.example');
            const east = website('https://east.example');
            const [, mangas] = await link([west, east], 'https://east.example/a');
            expect(mangas.map((manga) => manga.connector)).toEqual([east]);
            expect(west.getMangaFromURI).not.toHaveBeenCalled();
        });

        it('should be the one that says it does, even when it is not the only one that holds the host', async () => {
            const main = website('https://example.org', 'main');
            const mirror = website('https://mirror.example.org', 'mirror');
            main.url = 'https://example.org';
            const [, mangas] = await link([mirror, main], 'https://example.org/a');
            expect(mangas.map((manga) => manga.connector)).toEqual([main]);
        });

        it('should be the one that holds the host of the link, when none says it handles the link', async () => {
            const west = website('https://www.west.example');
            const east = website('https://east.example');
            const [, mangas] = await link([west, east], 'https://west.example/a');
            expect(mangas.map((manga) => manga.connector)).toEqual([west]);
        });

        it('should not be the connector of a website whose host only ends like the host of the link', async () => {
            const warn = quiet();
            const mangadex = website('https://mangadex.org');
            const [, mangas] = await link([mangadex], 'https://dex.org/title/1');
            expect(mangas).toEqual([]);
            expect(mangadex.getMangaFromURI).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledTimes(1);
        });

        it('should be chosen among those that hold the host by the path of the link', async () => {
            const english = website('https://site.example/en', 'english');
            const german = website('https://site.example/de', 'german');
            const [, mangas] = await link(
                [english, german],
                'https://site.example/de/manga/1\nhttps://site.example/en/manga/2',
            );
            expect(mangas.map((manga) => manga.connector.id)).toEqual(['german', 'english']);
        });

        it('should be one that has a handler of its own for links', async () => {
            const west = website('https://west.example');
            west.canHandleURI = (uri) => uri.hostname.endsWith('.cdn.example');
            const [, mangas] = await link([west], 'https://a.cdn.example/manga/1');
            expect(mangas.map((manga) => manga.connector)).toEqual([west]);
        });

        it('should be none for a website that no connector knows, which is said, and the rest goes on', async () => {
            const warn = quiet();
            const west = website('https://west.example');
            const [error, mangas] = await link(
                [west],
                'https://unknown.example/a b\nhttps://west.example/1',
            );
            expect(error).toBeNull();
            expect(mangas.map((manga) => manga.id)).toEqual(['/1']);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][1]).toBe('https://unknown.example/a b');
            expect(warn.mock.calls[0][2].message).toBe(
                'No matching connector found for URL https://unknown.example/a%20b',
            );
        });

        it('should be none when it takes too many to choose, which is said', async () => {
            const warn = quiet();
            const first = website('https://site.example', 'first');
            const second = website('https://site.example', 'second');
            const [, mangas] = await link([first, second], 'https://site.example/a');
            expect(mangas).toEqual([]);
            expect(first.getMangaFromURI).not.toHaveBeenCalled();
            expect(second.getMangaFromURI).not.toHaveBeenCalled();
            expect(warn.mock.calls[0][2].message).toBe(
                'To many matching connectors found for URL https://site.example/a',
            );
        });

        it('should not be a connector without an address, nor the engine sources', async () => {
            quiet();
            const sources = [
                { id: 'bookmarks', label: 'Bookmarks' },
                { id: 'folder', label: 'Folder', url: undefined },
                { id: 'clipboard', label: 'Clipboard', url: undefined, canHandleURI: undefined },
            ];
            const west = website('https://west.example');
            const [, mangas] = await link([...sources, west], 'https://west.example/1');
            expect(mangas.map((manga) => manga.connector)).toEqual([west]);
        });

        it('should not be found when the connectors are none', async () => {
            quiet();
            await expect(link([], 'https://west.example/1')).resolves.toEqual([null, []]);
        });

        it('should be taken from the connectors that are registered when the update runs', async () => {
            quiet();
            const connectors = [];
            const { connector } = setup('https://west.example/1', connectors);
            await expect(update(connector)).resolves.toEqual([null, []]);
            connectors.push(website('https://west.example'));
            expect((await update(connector))[1]).toHaveLength(1);
        });
    });
});
