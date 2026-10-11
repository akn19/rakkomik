// The base class of the connectors of the websites: its life cycle (initialization, the list of mangas that is updated,
// cached and loaded from the storage), the helpers for links and for the connector:// addresses of images, and the
// defaults that a connector overrides. The fetch helpers are covered by ConnectorFetch.test.js, the ones that need a
// DOM by ConnectorDOM.test.js and the progress of an update by ConnectorProgress.test.js.
const { createEngine, installPage, directoryListing, exactly } = require('./support/coreFakes.js');

let Connector = null;
let Manga = null;
let Enums = null;
let Storage = null;

let engine = null;

beforeAll(async () => {
    Connector = (await import('../mjs/engine/Connector.mjs')).default;
    Manga = (await import('../mjs/engine/Manga.mjs')).default;
    Enums = (await import('../mjs/engine/Enums.mjs')).default;
    Storage = (await import('../mjs/engine/Storage.mjs')).default;
});

beforeEach(() => {
    engine = createEngine({ Storage });
    installPage({ engine, EventListener: Enums.EventListener });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function createSite() {
    const site = new Connector();
    site.id = 'site';
    site.label = 'Site';
    site.url = 'https://site.test';
    site.initialized = true; // no browser window for the initialization
    return site;
}

function deferred() {
    const result = {};
    result.promise = new Promise((resolve, reject) => Object.assign(result, { resolve, reject }));
    return result;
}

// lets everything that waits for resolved promises run
function settle() {
    return new Promise(resolve => setImmediate(resolve));
}

function updateMangas(connector) {
    return new Promise(resolve => connector.updateMangas((error, mangas) => resolve({ error, mangas })));
}

function getMangas(connector) {
    return new Promise(resolve => connector.getMangas((error, mangas) => resolve({ error, mangas })));
}

function stored(...mangas) {
    return engine.Storage.saveMangaList('site', mangas);
}

function titles(mangas) {
    return mangas.map(manga => manga.title);
}

describe('a connector', () => {
    it('should start idle, without mangas and not initialized', () => {
        const connector = new Connector();
        expect(connector).toMatchObject({ label: '', tags: [], isLocked: false, initialized: false, isUpdating: false, existingMangas: [] });
        expect(connector.updateProgress).toBeUndefined();
        expect(connector.mangaCache).toBeUndefined();
    });

    it('should have an id of its own until a connector chooses one', () => {
        const [first, second] = [new Connector(), new Connector()];
        expect(typeof first.id).toBe('symbol');
        expect(first.id).not.toBe(second.id);
    });

    it('should ask for what a browser asks for', () => {
        const { requestOptions } = new Connector();
        expect(requestOptions).toMatchObject({ method: 'GET', mode: 'cors', redirect: 'follow', credentials: 'same-origin' });
        expect(requestOptions.headers).toBeInstanceOf(Headers);
        // what a browser asks for when it navigates
        expect(requestOptions.headers.get('accept')).toBe('text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9');
    });

    it('should not share its request options, tags and directory with other connectors', () => {
        const [first, second] = [new Connector(), new Connector()];
        first.requestOptions.headers.set('x-referer', 'https://site.test/');
        first.tags.push('manga');
        first.existingMangas['Title'] = true;
        expect(second.requestOptions.headers.has('x-referer')).toBe(false);
        expect(second.tags).toEqual([]);
        expect(second.existingMangas.Title).toBeUndefined();
    });

    it('should have the address of its icon below the id of the connector', () => {
        const connector = createSite();
        expect(connector.icon).toBe('/img/connectors/site');
    });

    it.each([
        'https://site.test/manga/1?page=2',
        'https://site.test/'
    ])('should handle the address %s', address => {
        expect(createSite().canHandleURI(new URL(address))).toBe(true);
    });

    it.each([
        'http://site.test/manga/1',
        'https://www.site.test/manga/1',
        'https://site.test:8443/manga/1',
        'https://other.test/manga/1'
    ])('should not handle the address %s, which has another origin', address => {
        expect(createSite().canHandleURI(new URL(address))).toBe(false);
    });

    it('should not handle anything when it has no address', () => {
        const connector = new Connector();
        expect(connector.canHandleURI(new URL('https://site.test/'))).toBe(false);
    });
});

describe('initialize', () => {
    it('should run the initialization of the connector once, however often it is asked for', async () => {
        const connector = createSite();
        connector.initialized = false;
        connector._initializeConnector = vi.fn(async () => undefined);
        await connector.initialize();
        await connector.initialize();
        expect(connector._initializeConnector).toHaveBeenCalledTimes(1);
        expect(connector.initialized).toBe(true);
    });

    it('should not initialize a connector that is initialized', async () => {
        const connector = createSite();
        connector._initializeConnector = vi.fn(async () => undefined);
        await connector.initialize();
        expect(connector._initializeConnector).not.toHaveBeenCalled();
    });

    it('should fail with the error of the initialization and try again the next time', async () => {
        const connector = createSite();
        connector.initialized = false;
        const failure = new Error('Failed to load "https://site.test/" within the given timeout of 60 seconds!');
        connector._initializeConnector = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
        await expect(connector.initialize()).rejects.toBe(failure);
        expect(connector.initialized).toBe(false);
        await connector.initialize();
        expect(connector._initializeConnector).toHaveBeenCalledTimes(2);
        expect(connector.initialized).toBe(true);
    });

    it('should go on when the computer is offline, and try again the next time', async () => {
        const connector = createSite();
        connector.initialized = false;
        const offline = new Error('offline');
        offline.stack = 'ERR_INTERNET_DISCONNECTED https://site.test/';
        connector._initializeConnector = vi.fn().mockRejectedValueOnce(offline).mockResolvedValueOnce(undefined);
        await expect(connector.initialize()).resolves.toBeUndefined();
        expect(connector.initialized).toBe(false);
        await connector.initialize();
        expect(connector.initialized).toBe(true);
    });

    it('should go on when the fetch window reports that the computer is offline', async () => {
        const connector = createSite();
        connector.initialized = false;
        connector._initializeConnector = async () => {
            throw new Error('Error invoking remote method \'rakkomik:fetch\': Error: ERR_INTERNET_DISCONNECTED https://site.test/');
        };
        await expect(connector.initialize()).resolves.toBeUndefined();
    });

    it('should fail with what the initialization threw, even when it is not an Error', async () => {
        const connector = createSite();
        connector.initialized = false;
        connector._initializeConnector = async () => {
            throw 'no connection';
        };
        await expect(connector.initialize()).rejects.toBe('no connection');
    });

    it('should initialize once for two callers who ask at the same time', async () => {
        const connector = createSite();
        connector.initialized = false;
        const window = deferred();
        connector._initializeConnector = vi.fn(() => window.promise);
        const callers = [connector.initialize(), connector.initialize()];
        window.resolve();
        await Promise.all(callers);
        expect(connector._initializeConnector).toHaveBeenCalledTimes(1);
    });
});

describe('lock', () => {
    it('should hand out a key, and no second one while it is locked', () => {
        const connector = createSite();
        const key = connector.lock();
        expect(key).toEqual(expect.any(Symbol));
        expect(connector.isLocked).toBe(key);
        expect(connector.lock()).toBeNull();
        expect(connector.isLocked).toBe(key);
    });

    it('should be unlocked by the owner of the key only', () => {
        const connector = createSite();
        const key = connector.lock();
        connector.unlock(Symbol());
        connector.unlock(undefined);
        connector.unlock(false);
        expect(connector.isLocked).toBe(key);
        connector.unlock(key);
        expect(connector.isLocked).toBe(false);
    });

    it('should be locked again with a new key, which the previous owner cannot use', () => {
        const connector = createSite();
        const first = connector.lock();
        connector.unlock(first);
        const second = connector.lock();
        expect(second).not.toBe(first);
        connector.unlock(first);
        expect(connector.isLocked).toBe(second);
    });

    it('should stay unlocked when it is unlocked without being locked', () => {
        const connector = createSite();
        connector.unlock(undefined);
        connector.unlock(false);
        expect(connector.isLocked).toBe(false);
    });
});

describe('wait', () => {
    it('should resolve after the given time', async () => {
        vi.useFakeTimers();
        const connector = createSite();
        const done = vi.fn();
        connector.wait(500).then(done);
        await vi.advanceTimersByTimeAsync(499);
        expect(done).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(done).toHaveBeenCalledTimes(1);
    });
});

describe('findMatchingManga', () => {
    it('should find the first manga of the list that has the text in its title, whatever the case', async () => {
        await stored({ id: '/1', title: 'Bleach' }, { id: '/2', title: 'Naruto Shippuden' }, { id: '/3', title: 'Naruto' });
        await expect(createSite().findMatchingManga('NARUTO')).resolves.toEqual({ id: '/2', title: 'Naruto Shippuden' });
        await expect(createSite().findMatchingManga('lea')).resolves.toEqual({ id: '/1', title: 'Bleach' });
    });

    it('should find nothing when no title has the text', async () => {
        await stored({ id: '/1', title: 'Bleach' });
        await expect(createSite().findMatchingManga('naruto')).resolves.toBeUndefined();
    });

    it('should find nothing when the list of the manga is not there', async () => {
        await expect(createSite().findMatchingManga('naruto')).resolves.toBeUndefined();
    });

    it('should only look into the list of its own', async () => {
        await engine.Storage.saveMangaList('other', [{ id: '/1', title: 'Naruto' }]);
        await expect(createSite().findMatchingManga('naruto')).resolves.toBeUndefined();
    });

    it('should find a title that has unicode or special characters', async () => {
        await stored({ id: '/1', title: '漫画 (2nd season) [v2]' });
        await expect(createSite().findMatchingManga('(2nd season) [v2]')).resolves.toEqual({ id: '/1', title: '漫画 (2nd season) [v2]' });
    });
});

describe('getMangas', () => {
    it('should load the list from the storage as mangas of the connector', async () => {
        await stored({ id: '/1', title: 'Bleach' }, { id: '/2', title: 'Naruto' });
        const connector = createSite();
        const { error, mangas } = await getMangas(connector);
        expect(error).toBeNull();
        expect(mangas).toHaveLength(2);
        for (const manga of mangas) {
            expect(manga).toBeInstanceOf(Manga);
            expect(manga.connector).toBe(connector);
        }
        expect(mangas.map(manga => [manga.id, manga.title])).toEqual([['/1', 'Bleach'], ['/2', 'Naruto']]);
        expect(connector.mangaCache).toBe(mangas);
    });

    it('should hand out the list as a promise as well', async () => {
        await stored({ id: '/1', title: 'Bleach' });
        const callback = vi.fn();
        const mangas = await createSite().getMangas(callback);
        expect(titles(mangas)).toEqual(['Bleach']);
        expect(callback).toHaveBeenCalledWith(null, mangas);
    });

    it('should keep the list and not load it again', async () => {
        await stored({ id: '/1', title: 'Bleach' });
        const connector = createSite();
        const first = await getMangas(connector);
        const second = await getMangas(connector);
        expect(engine.Storage.loadMangaList).toHaveBeenCalledTimes(1);
        expect(second.mangas).toBe(first.mangas);
        expect(second.mangas[0]).toBe(first.mangas[0]);
    });

    it('should look at the directory again every time, and at the status of every manga that it keeps', async () => {
        await stored({ id: '/1', title: 'Bleach' }, { id: '/2', title: 'Naruto' });
        const connector = createSite();
        const { mangas } = await getMangas(connector);
        for (const manga of mangas) {
            vi.spyOn(manga, 'updateStatus');
        }
        await getMangas(connector);
        expect(engine.Storage.getExistingMangaTitles).toHaveBeenCalledTimes(2);
        expect(engine.Storage.getExistingMangaTitles).toHaveBeenCalledWith(connector);
        for (const manga of mangas) {
            expect(manga.updateStatus).toHaveBeenCalledTimes(1);
        }
    });

    it('should load the list again when the kept one is empty', async () => {
        const connector = createSite();
        connector.mangaCache = [];
        await stored({ id: '/1', title: 'Bleach' });
        const { mangas } = await getMangas(connector);
        expect(titles(mangas)).toEqual(['Bleach']);
        expect(engine.Storage.loadMangaList).toHaveBeenCalledTimes(1);
    });

    it('should not mind that the directory of the connector is not there yet', async () => {
        engine.Storage.existingMangas = null;
        await stored({ id: '/1', title: 'Bleach' });
        const { error, mangas } = await getMangas(createSite());
        expect(error).toBeNull();
        expect(mangas.map(manga => manga.status)).toEqual(['available']);
    });

    it('should be empty, and warn, when no list was ever saved', async () => {
        const connector = createSite();
        const { error, mangas } = await getMangas(connector);
        expect(error).toBeNull();
        expect(mangas).toEqual([]);
        expect(connector.mangaCache).toBeUndefined();
        expect(console.warn).toHaveBeenCalledWith('_getUpdatedMangasFromFile', expect.objectContaining({ code: 'ENOENT' }));
    });

    it('should be empty when the saved list is not a list', async () => {
        await engine.Storage.saveMangaList('site', { id: '/1' });
        const { error, mangas } = await getMangas(createSite());
        expect(error).toBeNull();
        expect(mangas).toEqual([]);
    });

    it('should report the error, with the list that it has, when the status of a manga cannot be told', async () => {
        const connector = createSite();
        const broken = { updateStatus: () => {
            throw new Error('broken manga');
        } };
        connector.mangaCache = [broken];
        const callback = vi.fn();
        await expect(connector.getMangas(callback)).rejects.toThrow('broken manga');
        expect(console.warn).toHaveBeenCalledWith('getMangas', expect.objectContaining({ message: 'broken manga' }));
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ message: 'broken manga' }), [broken]);
    });

    it('should know which of the mangas have a directory on the device', async () => {
        engine.Storage.existingMangas = directoryListing('Naruto');
        await stored({ id: '/1', title: 'Bleach' }, { id: '/2', title: 'Naruto' });
        const { mangas } = await getMangas(createSite());
        expect(mangas.map(manga => [manga.title, manga.status])).toEqual([['Bleach', 'available'], ['Naruto', 'completed']]);
    });

    it('should know about the directories that appeared since the list was loaded', async () => {
        await stored({ id: '/1', title: 'Bleach' }, { id: '/2', title: 'Naruto' });
        const connector = createSite();
        await getMangas(connector);
        engine.Storage.existingMangas = directoryListing('Naruto');
        const { mangas } = await getMangas(connector);
        expect(mangas.map(manga => [manga.title, manga.status])).toEqual([['Bleach', 'available'], ['Naruto', 'completed']]);
    });
});

describe('updateMangas', () => {
    const LIST = [{ id: '/b', title: 'banana' }, { id: '/a', title: 'Apple' }, { id: '/c', title: 'Cherry' }];

    function websiteWith(connector, mangas) {
        connector._getMangas = vi.fn(async () => mangas);
        return connector;
    }

    it('should save the list that the website offers, sorted by title without regard to the case, and hand out the saved list', async () => {
        const connector = websiteWith(createSite(), LIST);
        const { error, mangas } = await updateMangas(connector);
        expect(error).toBeNull();
        expect(engine.Storage.saveMangaList).toHaveBeenCalledWith('site', [{ id: '/a', title: 'Apple' }, { id: '/b', title: 'banana' }, { id: '/c', title: 'Cherry' }]);
        expect(mangas.map(manga => [manga.id, manga.title])).toEqual([['/a', 'Apple'], ['/b', 'banana'], ['/c', 'Cherry']]);
        expect(mangas[0]).toBeInstanceOf(Manga);
        expect(connector.mangaCache).toBe(mangas);
    });

    it('should keep the first of the mangas that have the same id', async () => {
        const connector = websiteWith(createSite(), [{ id: '/b', title: 'banana' }, { id: '/a', title: 'Apple' }, { id: '/b', title: 'banana (again)' }, { id: '/a', title: 'Apple' }]);
        const { mangas } = await updateMangas(connector);
        expect(mangas.map(manga => [manga.id, manga.title])).toEqual([['/a', 'Apple'], ['/b', 'banana']]);
        expect(engine.Storage.saveMangaList.mock.calls[0][1]).toHaveLength(2);
    });

    it('should keep mangas that have the same title but not the same id', async () => {
        const connector = websiteWith(createSite(), [{ id: '/1', title: 'Love' }, { id: '/2', title: 'Love' }]);
        const { mangas } = await updateMangas(connector);
        expect(mangas.map(manga => manga.id).sort()).toEqual(['/1', '/2']);
    });

    it('should replace the list that the connector kept', async () => {
        const connector = websiteWith(createSite(), LIST);
        await stored({ id: '/old', title: 'Old' });
        const before = await getMangas(connector);
        expect(titles(before.mangas)).toEqual(['Old']);
        const { mangas } = await updateMangas(connector);
        expect(titles(mangas)).toEqual(['Apple', 'banana', 'Cherry']);
        expect(connector.mangaCache).toBe(mangas);
    });

    it('should leave the saved list and the kept list alone when the website offers no mangas', async () => {
        await stored({ id: '/old', title: 'Old' });
        const connector = websiteWith(createSite(), []);
        const kept = (await getMangas(connector)).mangas;
        const { error, mangas } = await updateMangas(connector);
        expect(error).toBeNull();
        expect(mangas).toBeUndefined();
        await expect(engine.Storage.loadMangaList('site')).resolves.toEqual([{ id: '/old', title: 'Old' }]);
        expect(connector.mangaCache).toBe(kept);
        expect(connector.isUpdating).toBe(false);
    });

    it.each([
        [ 'undefined', undefined ],
        [ 'null', null ]
    ])('should leave the saved list alone when the website offers %s as the list', async (name, list) => {
        const connector = websiteWith(createSite(), list);
        const { error, mangas } = await updateMangas(connector);
        expect(error).toBeNull();
        expect(mangas).toBeUndefined();
        expect(engine.Storage.saveMangaList).not.toHaveBeenCalled();
        expect(connector.isUpdating).toBe(false);
    });

    it('should report the error of the website and save nothing', async () => {
        const connector = createSite();
        connector._getMangas = vi.fn().mockRejectedValue(new Error('site down'));
        const { error, mangas } = await updateMangas(connector);
        expect(error).toEqual(expect.objectContaining({ message: 'site down' }));
        expect(mangas).toBeUndefined();
        expect(engine.Storage.saveMangaList).not.toHaveBeenCalled();
    });

    it('should report the error when the list cannot be saved', async () => {
        const connector = websiteWith(createSite(), LIST);
        const failure = new Error('ENOSPC: no space left on device');
        engine.Storage.saveMangaList.mockRejectedValueOnce(failure);
        const { error, mangas } = await updateMangas(connector);
        expect(error).toBe(failure);
        expect(mangas).toBeUndefined();
        expect(connector.isUpdating).toBe(false);
        expect(console.error).toHaveBeenCalledWith('ENOSPC: no space left on device');
    });

    it('should report the error when the connector cannot start', async () => {
        const connector = websiteWith(createSite(), LIST);
        connector.initialized = false;
        const failure = new Error('no window');
        connector._initializeConnector = vi.fn().mockRejectedValue(failure);
        const { error, mangas } = await updateMangas(connector);
        expect(error).toBe(failure);
        expect(mangas).toBeUndefined();
        expect(connector._getMangas).not.toHaveBeenCalled();
        expect(connector.isUpdating).toBe(false);
    });

    it('should initialize the connector before it asks the website', async () => {
        const connector = websiteWith(createSite(), LIST);
        connector.initialized = false;
        const order = [];
        connector._initializeConnector = vi.fn(async () => order.push('initialize'));
        connector._getMangas = vi.fn(async () => {
            order.push('mangas');
            return LIST;
        });
        await updateMangas(connector);
        expect(order).toEqual(['initialize', 'mangas']);
    });

    it('should use the callback style of the connectors that have not been rewritten', async () => {
        const connector = createSite();
        connector._getMangaList = vi.fn(callback => callback(null, LIST));
        const { error, mangas } = await updateMangas(connector);
        expect(error).toBeNull();
        expect(titles(mangas)).toEqual(['Apple', 'banana', 'Cherry']);
    });

    it('should fail, and end, when an entry of the list is not a manga', async () => {
        const connector = websiteWith(createSite(), [{ id: '/1', title: 'One' }, { id: '/2' }]);
        const { error, mangas } = await updateMangas(connector);
        expect(error).toBeInstanceOf(TypeError);
        expect(mangas).toBeUndefined();
        expect(connector.isUpdating).toBe(false);
        expect(engine.Storage.saveMangaList).not.toHaveBeenCalled();
    });

    it('should end when the connector throws instead of calling back', async () => {
        const connector = createSite();
        connector._getMangaList = () => {
            // what an async override returns when it throws; the test takes care that nobody has to
            const rejected = Promise.reject(new Error('broken connector'));
            rejected.catch(() => undefined);
            return rejected;
        };
        const callback = vi.fn();
        connector.updateMangas(callback);
        await settle();
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ message: 'broken connector' }), undefined);
        expect(connector.isUpdating).toBe(false);
    });

    it('should have ended, for whoever asks, by the time the callback is called', async () => {
        const succeeded = websiteWith(createSite(), LIST);
        const failed = createSite();
        failed._getMangas = vi.fn().mockRejectedValue(new Error('site down'));
        const empty = websiteWith(createSite(), []);
        const seen = [];
        for (const connector of [succeeded, failed, empty]) {
            await new Promise(resolve => connector.updateMangas(() => {
                seen.push([connector.isUpdating, connector.updateProgress]);
                resolve();
            }));
        }
        expect(seen).toEqual([[false, undefined], [false, undefined], [false, undefined]]);
    });

    it('should report that it is running from the moment it is asked for until it is over', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2030-01-01T12:00:00Z'));
        const release = deferred();
        const connector = createSite();
        connector._getMangas = vi.fn(async () => {
            await release.promise;
            return LIST;
        });
        const done = updateMangas(connector);
        expect(connector.isUpdating).toBe(true);
        expect(connector.updateProgress).toEqual({ requests: 0, startedAt: Date.UTC(2030, 0, 1, 12) });
        await settle();
        expect(connector.isUpdating).toBe(true);
        release.resolve();
        await done;
        expect(connector.isUpdating).toBe(false);
    });

    describe('while it is running', () => {
        function running(connector) {
            const release = deferred();
            connector._getMangas = vi.fn(async () => {
                await release.promise;
                return LIST;
            });
            return release;
        }

        it('should ask the website once, and leave the progress alone, when it is asked for again', async () => {
            const connector = createSite();
            const release = running(connector);
            const first = vi.fn();
            connector.updateMangas(first);
            const progress = connector.updateProgress;
            progress.requests = 7;
            expect(connector.updateMangas(vi.fn())).toBeUndefined();
            expect(connector.updateProgress).toBe(progress);
            expect(connector.updateProgress.requests).toBe(7);
            release.resolve();
            await settle();
            expect(connector._getMangas).toHaveBeenCalledTimes(1);
            expect(first).toHaveBeenCalledTimes(1);
            expect(first.mock.calls[0][0]).toBeNull();
        });

        it('should answer a call that arrives while an update runs', async () => {
            const connector = createSite();
            const release = running(connector);
            const first = vi.fn();
            const second = vi.fn();
            connector.updateMangas(first);
            connector.updateMangas(second);
            release.resolve();
            await settle();
            expect(first).toHaveBeenCalledTimes(1);
            expect(second).toHaveBeenCalledTimes(1);
        });

        it('should be possible again once it is over', async () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            const connector = websiteWith(createSite(), LIST);
            vi.setSystemTime(1000);
            await updateMangas(connector);
            vi.setSystemTime(2000);
            const second = updateMangas(connector);
            expect(connector.updateProgress.startedAt).toBe(2000);
            await expect(second).resolves.toMatchObject({ error: null });
            expect(connector._getMangas).toHaveBeenCalledTimes(2);
        });

        it('should not hold up the update of another connector', async () => {
            const [first, second] = [createSite(), createSite()];
            const release = running(first);
            websiteWith(second, [{ id: '/z', title: 'Zed' }]);
            first.updateMangas(vi.fn());
            const { error, mangas } = await updateMangas(second);
            expect(error).toBeNull();
            expect(titles(mangas)).toEqual(['Zed']);
            expect(first.isUpdating).toBe(true);
            expect(second.isUpdating).toBe(false);
            release.resolve();
            await settle();
            expect(first.isUpdating).toBe(false);
        });
    });

    it('should find the duplicates of a list in linear time', async () => {
        let reads = 0;
        const mangas = Array.from({ length: 1500 }, (unused, index) => ({
            get id() {
                reads++;
                return '/manga/' + index;
            },
            title: 'Title ' + index
        }));
        let readsAtSave = Infinity;
        engine.Storage.saveMangaList = vi.fn(async () => {
            readsAtSave = reads;
        });
        await updateMangas(websiteWith(createSite(), mangas));
        expect(readsAtSave).toBeLessThan(mangas.length * 20);
    });
});

describe('getMangaFromURI', () => {
    it('should initialize the connector and ask it for the manga', async () => {
        const connector = createSite();
        connector.initialized = false;
        const order = [];
        connector._initializeConnector = vi.fn(async () => order.push('initialize'));
        const manga = { title: 'From the website' };
        connector._getMangaFromURI = vi.fn(async uri => {
            order.push('manga');
            return { ...manga, id: uri.pathname };
        });
        const uri = new URL('https://site.test/manga/1');
        await expect(connector.getMangaFromURI(uri)).resolves.toEqual({ id: '/manga/1', title: 'From the website' });
        expect(connector._getMangaFromURI).toHaveBeenCalledWith(uri);
        expect(order).toEqual(['initialize', 'manga']);
    });

    it('should fail when the connector cannot start', async () => {
        const connector = createSite();
        connector.initialized = false;
        connector._initializeConnector = vi.fn().mockRejectedValue(new Error('no window'));
        connector._getMangaFromURI = vi.fn();
        await expect(connector.getMangaFromURI(new URL('https://site.test/manga/1'))).rejects.toThrow('no window');
        expect(connector._getMangaFromURI).not.toHaveBeenCalled();
    });

    it('should make a manga of the path and the query of the address, if the connector knows no better', async () => {
        const connector = createSite();
        const manga = await connector.getMangaFromURI(new URL('https://site.test/manga/1?lang=en#top'));
        expect(manga).toBeInstanceOf(Manga);
        expect(manga.connector).toBe(connector);
        expect(manga.id).toBe('/manga/1?lang=en');
    });

    // The title names the directory of the manga on the device: it must stay what it was
    it.each([
        [ 'https://site.test/manga/1', 'Manga #2E1' ],
        [ 'https://site.test/manga/2', 'Manga #2E2' ],
        [ 'https://site.test/manga/1?x=2', 'Manga #462' ],
        [ 'https://site.test/', 'Manga #31' ]
    ])('should title the manga of %s as %s', async (address, title) => {
        const manga = await createSite().getMangaFromURI(new URL(address));
        expect(manga.title).toBe(title);
    });

    it('should title the same address alike and different addresses differently', async () => {
        const connector = createSite();
        const addresses = ['https://site.test/manga/1', 'https://site.test/manga/2', 'https://site.test/manga/10', 'https://site.test/manga/1?page=2', 'https://site.test/漫画/第1話'];
        const first = await Promise.all(addresses.map(address => connector.getMangaFromURI(new URL(address))));
        const again = await Promise.all(addresses.map(address => connector.getMangaFromURI(new URL(address))));
        expect(titles(again)).toEqual(titles(first));
        expect(new Set(titles(first)).size).toBe(addresses.length);
        for (const title of titles(first)) {
            expect(title).toMatch(/^Manga #[0-9A-F]+$/);
        }
    });

    it('should not look at the website or the fragment of the address for the title', async () => {
        const connector = createSite();
        const [a, b] = await Promise.all([connector.getMangaFromURI(new URL('https://site.test/manga/1#a')), connector.getMangaFromURI(new URL('https://other.test/manga/1#b'))]);
        expect(a.title).toBe(b.title);
    });
});

describe('the interface that connectors implement', () => {
    it.each([
        [ '_getMangas', connector => connector._getMangas() ],
        [ '_getChapters', connector => connector._getChapters({ id: '/manga/1' }) ],
        [ '_getPages', connector => connector._getPages({ id: '/chapter/1' }) ]
    ])('should demand an implementation of %s', async (name, call) => {
        await expect(call(createSite())).rejects.toThrow(exactly('Not implemented!'));
    });

    describe('the callback style of the former interface', () => {
        it('should hand out the mangas', async () => {
            const connector = createSite();
            connector._getMangas = vi.fn(async () => [{ id: '/1', title: 'One' }]);
            const callback = vi.fn();
            await connector._getMangaList(callback);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith(null, [{ id: '/1', title: 'One' }]);
        });

        it('should hand out the chapters of the manga', async () => {
            const connector = createSite();
            const manga = { id: '/manga/1' };
            connector._getChapters = vi.fn(async () => [{ id: '/chapter/1', title: 'One' }]);
            const callback = vi.fn();
            await connector._getChapterList(manga, callback);
            expect(connector._getChapters).toHaveBeenCalledWith(manga);
            expect(callback).toHaveBeenCalledWith(null, [{ id: '/chapter/1', title: 'One' }]);
        });

        it('should hand out the pages of the chapter, which are asked for with the chapter alone', async () => {
            const connector = createSite();
            const [manga, chapter] = [{ id: '/manga/1' }, { id: '/chapter/1' }];
            connector._getPages = vi.fn(async () => ['https://cdn.test/1.jpg']);
            const callback = vi.fn();
            await connector._getPageList(manga, chapter, callback);
            expect(connector._getPages.mock.calls).toEqual([[chapter]]);
            expect(callback).toHaveBeenCalledWith(null, ['https://cdn.test/1.jpg']);
        });

        it.each([
            [ '_getMangaList', (connector, callback) => connector._getMangaList(callback) ],
            [ '_getChapterList', (connector, callback) => connector._getChapterList({ id: '/manga/1' }, callback) ],
            [ '_getPageList', (connector, callback) => connector._getPageList({ id: '/manga/1' }, { id: '/chapter/1' }, callback) ]
        ])('should hand out the error of the new interface, and log it, in %s', async (name, call) => {
            const connector = createSite();
            const callback = vi.fn();
            await call(connector, callback);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback.mock.calls[0][0]).toEqual(expect.objectContaining({ message: 'Not implemented!' }));
            expect(callback.mock.calls[0][1]).toBeUndefined();
            expect(console.error).toHaveBeenCalledTimes(1);
        });

        it('should hand out the error of the website', async () => {
            const connector = createSite();
            const failure = new Error('HTTP 503');
            connector._getChapters = vi.fn().mockRejectedValue(failure);
            const callback = vi.fn();
            await connector._getChapterList({ id: '/manga/1' }, callback);
            expect(callback).toHaveBeenCalledWith(failure, undefined);
        });
    });
});

describe('getAbsolutePath', () => {
    // [reference, base, the address]
    it.each([
        [ '/a/b?c=1#d', 'https://site.test/x/y', 'https://site.test/a/b?c=1#d' ],
        [ 'z', 'https://site.test/x/y', 'https://site.test/x/z' ],
        [ 'z', 'https://site.test/x/y/', 'https://site.test/x/y/z' ],
        [ '../z', 'https://site.test/x/y/', 'https://site.test/x/z' ],
        [ '//cdn.test/i.png', 'https://site.test/', 'https://cdn.test/i.png' ],
        [ 'https://other.test/p', 'https://site.test/', 'https://other.test/p' ],
        [ '?page=2', 'https://site.test/list?page=1', 'https://site.test/list?page=2' ],
        [ '#top', 'https://site.test/list?page=1', 'https://site.test/list?page=1#top' ],
        [ '', 'https://site.test/a', 'https://site.test/a' ],
        [ '/漫画/第1 話', 'https://site.test/', 'https://site.test/%E6%BC%AB%E7%94%BB/%E7%AC%AC1%20%E8%A9%B1' ]
    ])('should resolve "%s" against "%s" as "%s"', (reference, base, expected) => {
        expect(createSite().getAbsolutePath(reference, base)).toBe(expected);
    });

    it('should accept the base and the reference as addresses', () => {
        const connector = createSite();
        expect(connector.getAbsolutePath('rel', new URL('https://site.test/dir/'))).toBe('https://site.test/dir/rel');
        expect(connector.getAbsolutePath(new URL('https://u.test/q'), 'https://site.test/')).toBe('https://u.test/q');
    });

    it.each([
        [ 'undefined', undefined ],
        [ 'null', null ],
        [ 'a number', 42 ],
        [ 'an object', {} ]
    ])('should refuse %s as the base', (name, base) => {
        expect(() => createSite().getAbsolutePath('/a', base)).toThrow(exactly('Failed to extract relative link (parameter "base" is invalid)!'));
    });

    it.each([
        [ 'a number', 42 ],
        [ 'an object without a link', {} ],
        [ 'an object with an empty link', { href: undefined } ]
    ])('should refuse %s as the reference', (name, reference) => {
        expect(() => createSite().getAbsolutePath(reference, 'https://site.test/')).toThrow(exactly('Failed to extract relative link (parameter "reference" is invalid)!'));
    });

    it('should refuse a base that is not an address', () => {
        expect(() => createSite().getAbsolutePath('/a', 'not an address')).toThrow();
    });

    it.each([
        [ 'undefined', undefined ],
        [ 'null', null ]
    ])('should refuse %s as the reference, and say so', (name, reference) => {
        expect(() => createSite().getAbsolutePath(reference, 'https://site.test/')).toThrow(exactly('Failed to extract relative link (parameter "reference" is invalid)!'));
    });
});

describe('getRootRelativeOrAbsoluteLink', () => {
    // [reference, base, the link]: a path for the website of the base, an address for any other
    it.each([
        [ '/manga/1', 'https://site.test/', '/manga/1' ],
        [ 'chapter-2', 'https://site.test/manga/1', '/manga/chapter-2' ],
        [ 'https://site.test/manga/1?lang=en#top', 'https://site.test/', '/manga/1?lang=en#top' ],
        [ 'https://other.test/manga/1', 'https://site.test/', 'https://other.test/manga/1' ],
        [ 'https://www.site.test/manga/1', 'https://site.test/', 'https://www.site.test/manga/1' ],
        [ '//cdn.test/i.png?x=1', 'https://site.test/', 'https://cdn.test/i.png?x=1' ]
    ])('should turn "%s" on "%s" into "%s"', (reference, base, expected) => {
        expect(createSite().getRootRelativeOrAbsoluteLink(reference, base)).toBe(expected);
    });

    it('should take the base as an address as well', () => {
        expect(createSite().getRootRelativeOrAbsoluteLink('/manga/1', new URL('https://site.test/list'))).toBe('/manga/1');
    });

    it('should refuse what getAbsolutePath refuses', () => {
        expect(() => createSite().getRootRelativeOrAbsoluteLink('/a', undefined)).toThrow('parameter "base" is invalid');
    });
});

describe('the connector:// address of an image', () => {
    const PAYLOADS = [
        [ 'a link', 'https://cdn.test/a b/1.jpg?token=1&x=2#f' ],
        [ 'an object', { url: 'https://cdn.test/1.jpg', headers: { referer: 'https://site.test/' }, index: 3 } ],
        [ 'text that turns into base64 with + and /', '>>>???~~~' ],
        [ 'unicode', 'Ünïcödé 漫画 \u{1F600}' ],
        [ 'a very long link', 'https://cdn.test/' + 'x'.repeat(100000) ],
        [ 'an empty text', '' ]
    ];

    it.each(PAYLOADS)('should carry %s to the connector', async (name, payload) => {
        const connector = createSite();
        connector._handleConnectorURI = vi.fn(async () => 'answer');
        const address = connector.createConnectorURI(payload);
        await expect(connector.handleConnectorURI(new URL(address))).resolves.toBe('answer');
        expect(connector._handleConnectorURI).toHaveBeenCalledTimes(1);
        expect(connector._handleConnectorURI.mock.calls[0][0]).toEqual(payload);
    });

    it.each(['site', 'line_manga_jp', 'mangaindoMe', 'site-2'])('should name the connector %s in the host of the address', id => {
        const connector = createSite();
        connector.id = id;
        const address = new URL(connector.createConnectorURI('https://cdn.test/1.jpg'));
        expect(address.protocol).toBe('connector:');
        expect(address.hostname).toBe(id);
        expect(address.searchParams.has('payload')).toBe(true);
    });

    it('should be a different address for a different payload', () => {
        const connector = createSite();
        expect(connector.createConnectorURI('https://cdn.test/1.jpg')).not.toBe(connector.createConnectorURI('https://cdn.test/2.jpg'));
    });

    it.each([
        [ 'is missing', 'connector://site' ],
        [ 'is empty', 'connector://site?payload=' ],
        [ 'is not base64', 'connector://site?payload=!!!' ],
        [ 'is not JSON', 'connector://site?payload=bm90IGpzb24%3D' ]
    ])('should refuse an address of which the payload %s', async (name, address) => {
        const connector = createSite();
        connector._handleConnectorURI = vi.fn();
        await expect((async () => connector.handleConnectorURI(new URL(address)))()).rejects.toThrow();
        expect(connector._handleConnectorURI).not.toHaveBeenCalled();
    });

    it('should hand out what the connector answers', async () => {
        const connector = createSite();
        const answer = { mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) };
        connector._handleConnectorURI = vi.fn().mockResolvedValue(answer);
        await expect(connector.handleConnectorURI(new URL(connector.createConnectorURI('https://cdn.test/1.png')))).resolves.toBe(answer);
    });

    it('should fail with the failure of the connector', async () => {
        const connector = createSite();
        connector._handleConnectorURI = vi.fn().mockRejectedValue(new Error('404'));
        await expect(connector.handleConnectorURI(new URL(connector.createConnectorURI('x')))).rejects.toThrow('404');
    });
});

describe('the mime type of an image', () => {
    const SIGNATURES = {
        'image/webp': [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50],
        'image/jpeg': [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10],
        'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
        'image/gif': [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
        'image/bmp': [0x42, 0x4D, 0x36, 0x00]
    };

    it.each(Object.keys(SIGNATURES))('should be %s for data that starts like that, whatever the server says', real => {
        // another image type, a type of a page, an empty type and the one that servers give to what they do not know
        const said = [...Object.keys(SIGNATURES).filter(other => other !== real), 'text/html', '', 'application/octet-stream'];
        for (const mimeType of said) {
            console.warn.mockClear();
            const data = { mimeType, data: new Uint8Array(SIGNATURES[real]) };
            createSite()._applyRealMime(data);
            expect(data.mimeType).toBe(real);
            expect(console.warn).toHaveBeenCalledTimes(1);
            expect(console.warn).toHaveBeenCalledWith(`Provided mime type "${mimeType}" does not match the file signature and was replaced by "${real}"!`);
        }
    });

    it.each(Object.keys(SIGNATURES))('should stay %s for data that starts like that, without a warning', mimeType => {
        const data = { mimeType, data: new Uint8Array(SIGNATURES[mimeType]) };
        createSite()._applyRealMime(data);
        expect(data.mimeType).toBe(mimeType);
        expect(console.warn).not.toHaveBeenCalled();
    });

    it.each([
        [ 'a page', 'text/html', Array.from('<html>', character => character.charCodeAt(0)) ],
        [ 'no data', 'image/png', [] ],
        [ 'one byte of a JPEG', 'image/png', [0xFF] ],
        [ 'a truncated WEBP', 'image/png', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45] ],
        [ 'an image of a type that is not known', 'image/avif', [0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70] ]
    ])('should stay what the server says for %s', (name, mimeType, bytes) => {
        const data = { mimeType, data: new Uint8Array(bytes) };
        createSite()._applyRealMime(data);
        expect(data.mimeType).toBe(mimeType);
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('should not touch the data', () => {
        const data = { mimeType: 'text/html', data: new Uint8Array(SIGNATURES['image/png']) };
        createSite()._applyRealMime(data);
        expect(Array.from(data.data)).toEqual(SIGNATURES['image/png']);
    });

    it('should be made of a blob with its type and its bytes', async () => {
        const bytes = new Uint8Array(SIGNATURES['image/png']);
        const buffer = await createSite()._blobToBuffer(new Blob([bytes], { type: 'image/png' }));
        expect(buffer.mimeType).toBe('image/png');
        expect(buffer.data).toBeInstanceOf(Uint8Array);
        expect(Array.from(buffer.data)).toEqual(Array.from(bytes));
    });

    it('should be made of a blob without a type, and of an empty blob', async () => {
        const buffer = await createSite()._blobToBuffer(new Blob([]));
        expect(buffer).toEqual({ mimeType: '', data: new Uint8Array(0) });
    });
});

describe('the patterns for the titles of chapters', () => {
    it.each([
        [ 'Chapter 12', '12' ],
        [ 'chapter 12', '12' ],
        [ 'Ch.12', '12' ],
        [ 'ch. 12.5', '12.5' ],
        [ 'Chap 3', '3' ],
        [ 'Chapitre 4', '4' ],
        [ 'Bölüm 5', '5' ],
        [ 'Kapitel 8', '8' ],
        [ 'Capitolo 9', '9' ],
        [ 'Rozdział 10', '10' ],
        [ 'Глава 11', '11' ],
        [ 'Capítulo 12', '12' ],
        [ 'Épisode 15', '15' ],
        [ 'Ep. 17', '17' ],
        [ 'Page 18', '18' ],
        [ 'N°19', '19' ],
        [ 'DAY 21', '21' ],
        [ '#22', '22' ],
        [ '23 - Title', '23' ],
        [ 'Chapter 12-13', '12-13' ],
        [ 'Chapter 12v2', '12v2' ],
        [ 'Chapter 100: The End', '100' ],
        [ 'No numbers', null ],
        [ 'Chapter', null ]
    ])('should read the chapter of "%s" as %s', (title, expected) => {
        const match = title.match(createSite().getFormatRegex().chapterRegex);
        expect(match ? match[1] : null).toBe(expected);
    });

    it.each([
        [ 'Vol.2 Chapter 15', '2' ],
        [ 'Volume 12', '12' ],
        [ 'vol 3', '3' ],
        [ 'Tome 5', '5' ],
        [ 'Band 6', '6' ],
        [ 'Том 7', '7' ],
        [ 'Chapter 1', null ],
        [ 'Volume', null ]
    ])('should read the volume of "%s" as %s', (title, expected) => {
        const match = title.match(createSite().getFormatRegex().volumeRegex);
        expect(match ? match[1] : null).toBe(expected);
    });

    it('should be made new for every call, so that nobody inherits the state of a pattern', () => {
        const connector = createSite();
        expect(connector.getFormatRegex().chapterRegex).not.toBe(connector.getFormatRegex().chapterRegex);
    });
});
