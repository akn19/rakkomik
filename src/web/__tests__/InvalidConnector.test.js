// The stand-in for a connector that is gone: a bookmark of a website that is not supported any more still has to
// show up, and everything that asks it for mangas, chapters or pages is told why it has none.
let Connector = null;
let InvalidConnector = null;

beforeAll(async () => {
    Connector = (await import('../mjs/engine/Connector.mjs')).default;
    InvalidConnector = (await import('../mjs/connectors/system/InvalidConnector.mjs')).default;
});

afterEach(() => {
    vi.restoreAllMocks();
});

const gone = () => new InvalidConnector('oldsite', 'oldsite (unavailable)');

describe('InvalidConnector', () => {
    it('should be a connector with the ID and the label that it was given', () => {
        const connector = gone();
        expect(connector).toBeInstanceOf(Connector);
        expect(connector.id).toBe('oldsite');
        expect(connector.label).toBe('oldsite (unavailable)');
    });

    it('should not share what it was given with the next one', () => {
        const first = new InvalidConnector('a', 'A');
        const second = new InvalidConnector('b', 'B');
        expect([first.id, first.label, second.id, second.label]).toEqual(['a', 'A', 'b', 'B']);
        expect(first.tags).not.toBe(second.tags);
        expect(first.existingMangas).not.toBe(second.existingMangas);
    });

    it('should look like a connector that is not in use: no site, no state, no settings, an icon by its ID', () => {
        const connector = gone();
        expect(connector.url).toBeUndefined();
        expect(connector.config).toBeUndefined();
        expect(connector.tags).toEqual([]);
        expect(connector.isLocked).toBe(false);
        expect(connector.initialized).toBe(false);
        expect(connector.isUpdating).toBe(false);
        expect(connector.mangaCache).toBeUndefined();
        expect(connector.existingMangas).toEqual([]);
        expect(connector.icon).toBe('/img/connectors/oldsite');
    });

    it.each([
        ['the manga list', (connector, callback) => connector._getMangaList(callback)],
        [
            'the chapter list',
            (connector, callback) => connector._getChapterList({ id: 'm' }, callback),
        ],
        [
            'the page list',
            (connector, callback) => connector._getPageList({ id: 'm' }, { id: 'c' }, callback),
        ],
    ])(
        'should answer %s at once, once, with the error that it is gone and an empty list',
        (name, ask) => {
            const callback = vi.fn();
            ask(gone(), callback);
            expect(callback).toHaveBeenCalledTimes(1);
            const [error, list, ...rest] = callback.mock.calls[0];
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toBe('oldsite (unavailable) is no longer available!');
            expect(list).toEqual([]);
            expect(rest).toEqual([]);
        },
    );

    it('should name itself in the error, as it is written', async () => {
        const connector = new InvalidConnector('x', '<b>Site & Co</b> (unavailable)');
        const error = await new Promise((resolve) => connector._getMangaList(resolve));
        expect(error.message).toBe('<b>Site & Co</b> (unavailable) is no longer available!');
    });

    it('should answer with a list of its own every time', async () => {
        const connector = gone();
        const [first, second] = await Promise.all(
            [1, 2].map(
                () =>
                    new Promise((resolve) =>
                        connector._getMangaList((error, list) => resolve(list)),
                    ),
            ),
        );
        expect(first).toEqual([]);
        first.push('changed');
        expect(second).toEqual([]);
    });

    it('should not take the way of the connectors of the websites to get its lists', () => {
        for (const method of ['_getMangaList', '_getChapterList', '_getPageList']) {
            expect(Object.hasOwn(InvalidConnector.prototype, method), method).toBe(true);
            expect(InvalidConnector.prototype[method]).not.toBe(Connector.prototype[method]);
        }
    });

    it('should end an update of its list of mangas with an error and no list', async () => {
        const connector = gone();
        const [error, mangas] = await new Promise((resolve) =>
            connector.updateMangas((...answer) => resolve(answer)),
        );
        expect(error).toBeInstanceOf(Error);
        expect(mangas).toBeUndefined();
        expect(connector.isUpdating).toBe(false);
    });

    it('should tell that it is gone, and not that its address is invalid, when its list of mangas is updated', async () => {
        const [error] = await new Promise((resolve) =>
            gone().updateMangas((...answer) => resolve(answer)),
        );
        expect(error.message).toBe('oldsite (unavailable) is no longer available!');
    });
});
