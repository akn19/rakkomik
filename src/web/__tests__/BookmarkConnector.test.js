// The built-in source that shows the bookmarks of the user as one list of mangas. The manga and the invalid connector are
// real, the storage that is asked for the folders of the mangas is a stand-in (the last test uses the real one).
const fs = require('node:fs');
const path = require('node:path');
const { createEnvironment } = require('./support/storageHarness.js');

let BookmarkConnector = null;
let InvalidConnector = null;
let Manga = null;
let Enums = null;
let Storage = null;
let env = null;

beforeAll(async () => {
    BookmarkConnector = (await import('../mjs/connectors/system/BookmarkConnector.mjs')).default;
    InvalidConnector = (await import('../mjs/connectors/system/InvalidConnector.mjs')).default;
    Manga = (await import('../mjs/engine/Manga.mjs')).default;
    Enums = (await import('../mjs/engine/Enums.mjs')).default;
    Storage = (await import('../mjs/engine/Storage.mjs')).default;
});

afterEach(() => {
    if (env) {
        env.dispose();
        env = null;
    }
    delete globalThis.Engine;
    delete globalThis.document;
    delete globalThis.EventListener;
    vi.restoreAllMocks();
});

const bookmark = (connector, manga, title = manga, connectorTitle = connector) => ({
    title: { connector: connectorTitle, manga: title },
    key: { connector, manga }
});

function site(id, label = id) {
    return { id, label, existingMangas: [] };
}

/**
 * @param {object[]} bookmarks the bookmarks of the manager
 * @param {object[]} connectors the connectors that are registered
 * @param {string[]} onDevice the titles of the mangas (as they are written to the device) that have a folder
 */
function setup(bookmarks, connectors = [], onDevice = []) {
    const storage = {
        sanatizePath: title => title.replace(/[/]/g, ''),
        mangaDirectoryExist: vi.fn(async manga => {
            if (!onDevice.includes(storage.sanatizePath(manga.title))) {
                throw new Error(`ENOENT: no such file or directory, stat '${manga.title}'`);
            }
        })
    };
    globalThis.Engine = { Connectors: connectors, BookmarkManager: { bookmarks }, Storage: storage };
    // what the interface is told about the state of a manga, as it was when it was told
    const events = [];
    globalThis.document = { dispatchEvent: vi.fn(event => events.push([event.type, event.detail.title, event.detail.status])) };
    globalThis.EventListener = Enums.EventListener;
    return { connector: new BookmarkConnector(), storage, events };
}

const getMangas = connector => new Promise(resolve => connector.getMangas((...answer) => resolve(answer)));
// the folders are looked up while the list is on its way
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('BookmarkConnector', () => {
    it('should present itself as the source of the bookmarks, with a label that sorts it first', () => {
        const { connector } = setup([]);
        expect(connector.id).toBe('bookmarks');
        expect(connector.label).toBe(' 【Bookmarks】');
        expect(connector.icon).toBe('/img/connectors/bookmarks');
        expect(connector.tags).toEqual([]);
        expect(connector.isLocked).toBe(false);
        expect(connector.url).toBeUndefined();
        expect(connector.config).toBeUndefined();
        // a space sorts it before the websites
        expect(connector.label < 'A').toBe(true);
    });

    it('should answer without an error, and at once, once', () => {
        const { connector } = setup([bookmark('site', '/m/1', 'One')], [site('site')]);
        for (const ask of [callback => connector.getMangas(callback), callback => connector.updateMangas(callback)]) {
            const callback = vi.fn();
            ask(callback);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback.mock.calls[0][0]).toBeNull();
            expect(callback.mock.calls[0][1]).toHaveLength(1);
        }
    });

    it('should answer with no mangas when there are no bookmarks', async () => {
        const { connector, storage } = setup([], [site('site')]);
        await expect(getMangas(connector)).resolves.toEqual([null, []]);
        expect(storage.mangaDirectoryExist).not.toHaveBeenCalled();
    });

    it('should make a manga of each bookmark, of the connector that its key names', async () => {
        const west = site('west', 'West');
        const east = site('east', 'East');
        const { connector } = setup([bookmark('west', '/w/1', 'West One'), bookmark('east', '/e/1', 'East One')], [west, east]);
        const [error, mangas] = await getMangas(connector);
        expect(error).toBeNull();
        expect(mangas.map(manga => [manga.id, manga.title, manga.connector])).toEqual([['/e/1', 'East One', east], ['/w/1', 'West One', west]]);
        expect(mangas.every(manga => manga instanceof Manga)).toBe(true);
    });

    it('should put a bookmark of a connector that is gone with an invalid connector, that is named after it', async () => {
        const { connector } = setup([bookmark('retired', '/r/1', 'Retired One', 'Retired Site')], [site('west')]);
        const [, [manga]] = await getMangas(connector);
        expect(manga.connector).toBeInstanceOf(InvalidConnector);
        expect(manga.connector.id).toBe('retired');
        expect(manga.connector.label).toBe('retired (unavailable)');
        expect(manga.id).toBe('/r/1');
        expect(manga.title).toBe('Retired One');
    });

    it('should look for the connector among those that are registered when it is asked, not when it was created', async () => {
        const connectors = [];
        const { connector } = setup([bookmark('late', '/l/1', 'Late One')], connectors);
        expect((await getMangas(connector))[1][0].connector).toBeInstanceOf(InvalidConnector);
        const late = site('late');
        connectors.push(late);
        expect((await getMangas(connector))[1][0].connector).toBe(late);
    });

    it('should show the bookmarks as they are when it is asked', async () => {
        const bookmarks = [bookmark('site', '/m/1', 'One')];
        const { connector } = setup(bookmarks, [site('site')]);
        expect((await getMangas(connector))[1]).toHaveLength(1);
        bookmarks.push(bookmark('site', '/m/2', 'Two'));
        expect((await getMangas(connector))[1].map(manga => manga.title)).toEqual(['One', 'Two']);
        bookmarks.splice(0, 1);
        expect((await getMangas(connector))[1].map(manga => manga.title)).toEqual(['Two']);
    });

    it('should list the mangas by title, whatever the case, and leave the bookmarks in their order', async () => {
        const bookmarks = [
            bookmark('site', '/3', 'cherry'),
            bookmark('site', '/1', 'Banana'),
            bookmark('site', '/4', 'Date'),
            bookmark('site', '/2', 'apple'),
            bookmark('site', '/5', 'banana 2')
        ];
        const { connector } = setup(bookmarks, [site('site')]);
        const [, mangas] = await getMangas(connector);
        expect(mangas.map(manga => manga.title)).toEqual(['apple', 'Banana', 'banana 2', 'cherry', 'Date']);
        expect(bookmarks.map(entry => entry.key.manga)).toEqual(['/3', '/1', '/4', '/2', '/5']);
    });

    it('should list the bookmarks of the same title, of different connectors, each', async () => {
        const west = site('west');
        const east = site('east');
        const { connector } = setup([bookmark('west', '/1', 'Same'), bookmark('east', '/9', 'Same')], [west, east]);
        const [, mangas] = await getMangas(connector);
        expect(mangas.map(manga => manga.connector.id).sort()).toEqual(['east', 'west']);
    });

    // NOTE: the titles are compared by their characters, not by the rules of a language, so that "élan" comes after "zebra"
    it('should list a title that starts with an accent after the rest', async () => {
        const { connector } = setup([bookmark('site', '/1', 'élan'), bookmark('site', '/2', 'zebra'), bookmark('site', '/3', 'apple')], [site('site')]);
        expect((await getMangas(connector))[1].map(manga => manga.title)).toEqual(['apple', 'zebra', 'élan']);
    });

    it('should keep the titles of any script as they are', async () => {
        const { connector } = setup([bookmark('site', '/1', '日本語 マンガ 😀'), bookmark('site', '/2', 'Fate/Zero: <1>')], [site('site')]);
        expect((await getMangas(connector))[1].map(manga => manga.title).sort()).toEqual(['Fate/Zero: <1>', '日本語 マンガ 😀']);
    });

    describe('the state of the manga on the device', () => {
        it('should be available for a manga that has no folder', async () => {
            const west = site('west');
            const { connector, storage } = setup([bookmark('west', '/w/1', 'One')], [west]);
            const [, [manga]] = await getMangas(connector);
            await settle();
            expect(storage.mangaDirectoryExist).toHaveBeenCalledTimes(1);
            expect(storage.mangaDirectoryExist).toHaveBeenCalledWith(manga);
            expect(manga.status).toBe('available');
            expect(west.existingMangas).toEqual([]);
        });

        it('should be completed for a manga that has a folder, and the connector should know the folder', async () => {
            const west = site('west');
            const { connector } = setup([bookmark('west', '/w/1', 'One'), bookmark('west', '/w/2', 'Two')], [west], ['Two']);
            const [, mangas] = await getMangas(connector);
            await settle();
            expect(mangas.map(manga => [manga.title, manga.status])).toEqual([['One', 'available'], ['Two', 'completed']]);
            expect(Object.keys(west.existingMangas)).toEqual(['Two']);
            expect(west.existingMangas.Two).toBe(true);
        });

        it('should look for the folder by the name that the title has on the device', async () => {
            const west = site('west');
            const { connector } = setup([bookmark('west', '/w/1', 'Fate/Zero')], [west], ['FateZero']);
            const [, [manga]] = await getMangas(connector);
            await settle();
            expect(manga.status).toBe('completed');
            expect(west.existingMangas.FateZero).toBe(true);
        });

        it('should tell the interface about the state of each manga', async () => {
            const { connector, events } = setup([bookmark('west', '/w/1', 'One'), bookmark('west', '/w/2', 'Two')], [site('west')], ['Two']);
            await getMangas(connector);
            await settle();
            expect(events).toEqual([
                ['onMangaStatusChanged', 'One', 'available'],
                ['onMangaStatusChanged', 'Two', 'available'],
                ['onMangaStatusChanged', 'Two', 'completed']
            ]);
        });

        it.each([
            ['the folder is not there', new Error('ENOENT: no such file or directory')],
            ['the folder cannot be read', new Error('EACCES: permission denied')],
            ['the answer is no error at all', undefined]
        ])('should stay available, and not fail, when %s', async (name, error) => {
            const west = site('west');
            const { connector, storage } = setup([bookmark('west', '/w/1', 'One')], [west]);
            storage.mangaDirectoryExist.mockImplementation(() => Promise.reject(error));
            const answer = await getMangas(connector);
            await settle();
            expect(answer[0]).toBeNull();
            expect(answer[1][0].status).toBe('available');
            expect(west.existingMangas).toEqual([]);
        });

        it('should be told to the connector of the manga only', async () => {
            const west = site('west');
            const east = site('east');
            const { connector } = setup([bookmark('west', '/w/1', 'One'), bookmark('east', '/e/1', 'Other')], [west, east], ['One']);
            await getMangas(connector);
            await settle();
            expect(Object.keys(west.existingMangas)).toEqual(['One']);
            expect(Object.keys(east.existingMangas)).toEqual([]);
        });

        it('should be completed too for a manga whose connector is gone, when its folder is there', async () => {
            const { connector } = setup([bookmark('retired', '/r/1', 'One')], [], ['One']);
            const [, [manga]] = await getMangas(connector);
            await settle();
            expect(manga.connector.existingMangas.One).toBe(true);
            expect(manga.status).toBe('completed');
        });
    });

    describe('with the storage of the engine', () => {
        it('should find the folder of a manga where the engine puts it, below the folder of its website when the user wants one', async () => {
            env = createEnvironment(Storage, { settings: { useSubdirectory: true } });
            const west = site('west', 'West/Site');
            fs.mkdirSync(path.join(env.mangas, 'WestSite', 'FateZero'), { recursive: true });
            fs.mkdirSync(path.join(env.mangas, 'Other', 'Elsewhere'), { recursive: true });
            globalThis.Engine.Connectors = [west];
            globalThis.Engine.BookmarkManager = { bookmarks: [bookmark('west', '/w/1', 'Fate/Zero'), bookmark('west', '/w/2', 'Elsewhere')] };
            globalThis.document = { dispatchEvent: vi.fn() };
            globalThis.EventListener = Enums.EventListener;
            const [, mangas] = await getMangas(new BookmarkConnector());
            await env.idle();
            await settle();
            expect(mangas.map(manga => [manga.title, manga.status])).toEqual([['Elsewhere', 'available'], ['Fate/Zero', 'completed']]);
            expect(Object.keys(west.existingMangas)).toEqual(['FateZero']);
        });
    });
});
